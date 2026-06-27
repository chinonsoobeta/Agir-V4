// Sandboxed custom-line expression evaluator (Workstream 1). Proves the trust
// rule: the evaluator is deterministic, references only nodes the engine
// supplies, rejects everything outside the whitelist (fail-closed), and renders
// a formula string that passes the numeric-provenance verifier.

import { describe, expect, test } from "vitest";
import {
  collectLiterals,
  collectReferences,
  evaluate,
  evaluateExpression,
  ExpressionError,
  parseExpression,
} from "@/lib/engine/expression";
import { buildAllowedValues, verifyNumericProvenance } from "@/lib/engine";

const ctx = (obj: Record<string, number>) => new Map(Object.entries(obj));

describe("expression evaluator: arithmetic and precedence", () => {
  test("operator precedence and parentheses", () => {
    expect(evaluate(parseExpression("2 + 3 * 4"), ctx({}))).toBe(14);
    expect(evaluate(parseExpression("(2 + 3) * 4"), ctx({}))).toBe(20);
    expect(evaluate(parseExpression("10 / 4"), ctx({}))).toBe(2.5);
    expect(evaluate(parseExpression("10 - 3 - 2"), ctx({}))).toBe(5); // left-associative
  });

  test("unary minus and unary plus", () => {
    expect(evaluate(parseExpression("-5 + 2"), ctx({}))).toBe(-3);
    expect(evaluate(parseExpression("-(3 * 2)"), ctx({}))).toBe(-6);
    expect(evaluate(parseExpression("+7"), ctx({}))).toBe(7);
    expect(evaluate(parseExpression("3 * -2"), ctx({}))).toBe(-6);
  });

  test("decimal and leading-dot literals", () => {
    expect(evaluate(parseExpression("0.5 * 8"), ctx({}))).toBe(4);
    expect(evaluate(parseExpression(".25 * 8"), ctx({}))).toBe(2);
  });

  test("whitelisted functions min / max / abs", () => {
    expect(evaluate(parseExpression("min(3, 7)"), ctx({}))).toBe(3);
    expect(evaluate(parseExpression("max(3, 7, 5)"), ctx({}))).toBe(7);
    expect(evaluate(parseExpression("abs(-9)"), ctx({}))).toBe(9);
    expect(
      evaluate(parseExpression("max(noi - reserve, 0)"), ctx({ noi: 100, reserve: 130 })),
    ).toBe(0);
  });
});

describe("expression evaluator: references resolve only from the supplied context", () => {
  test("a reference resolves to its node value", () => {
    expect(evaluate(parseExpression("noi * 0.03"), ctx({ noi: 1_000_000 }))).toBe(30_000);
    expect(evaluate(parseExpression("gpr - opex"), ctx({ gpr: 500, opex: 175 }))).toBe(325);
  });

  test("a reference the engine did not supply throws (fail-closed, never zero)", () => {
    expect(() => evaluate(parseExpression("noi + ghost"), ctx({ noi: 10 }))).toThrow(
      ExpressionError,
    );
  });

  test("allowedRefs restricts which nodes may be referenced", () => {
    expect(() => evaluateExpression("noi + secret", ctx({ noi: 1, secret: 9 }), ["noi"])).toThrow(
      /not an allowed node/,
    );
    expect(evaluateExpression("noi * 2", ctx({ noi: 5 }), ["noi"])).toBe(10);
  });

  test("collectReferences and collectLiterals report dependencies and coefficients", () => {
    const ast = parseExpression("noi * 0.03 + max(gpr, noi) - 1000");
    expect(collectReferences(ast)).toEqual(["noi", "gpr"]); // de-duplicated, first-seen order
    expect(collectLiterals(ast)).toEqual([0.03, 1000]);
  });
});

describe("expression evaluator: fail-closed safety (no host escape, no minted values)", () => {
  test("member access, indexing, assignment, and comparison are rejected at tokenize time", () => {
    expect(() => parseExpression("noi.toString")).toThrow(ExpressionError);
    expect(() => parseExpression("noi[0]")).toThrow(ExpressionError);
    expect(() => parseExpression("a = 1")).toThrow(ExpressionError);
    expect(() => parseExpression("noi == 5")).toThrow(ExpressionError);
    expect(() => parseExpression("noi % 3")).toThrow(ExpressionError);
  });

  test("a non-whitelisted function call is rejected at parse time", () => {
    expect(() => parseExpression("eval(1)")).toThrow(/Unknown function/);
    expect(() => parseExpression("fetch(noi)")).toThrow(/Unknown function/);
  });

  test("global-like identifiers are inert references, not host objects", () => {
    // `process` parses as an ordinary reference; with no such node supplied it
    // fails closed rather than reaching the real Node global.
    expect(() => evaluate(parseExpression("process"), ctx({}))).toThrow(ExpressionError);
  });

  test("division by zero and non-finite results throw", () => {
    expect(() => evaluate(parseExpression("noi / 0"), ctx({ noi: 5 }))).toThrow(/Division by zero/);
    expect(() => evaluate(parseExpression("x / y"), ctx({ x: 1, y: 0 }))).toThrow(
      /Division by zero/,
    );
  });

  test("empty and malformed expressions throw", () => {
    expect(() => parseExpression("")).toThrow(ExpressionError);
    expect(() => parseExpression("2 +")).toThrow(ExpressionError);
    expect(() => parseExpression("(2 + 3")).toThrow(ExpressionError);
    expect(() => parseExpression("2 3")).toThrow(ExpressionError);
  });
});

describe("expression evaluator: determinism", () => {
  test("identical inputs always yield identical output", () => {
    const src = "max(noi - debt_service, 0) * 0.95";
    const c = ctx({ noi: 1_234_567, debt_service: 800_000 });
    const a = evaluate(parseExpression(src), c);
    const b = evaluate(parseExpression(src), c);
    expect(a).toBe(b);
    expect(a).toBe((1_234_567 - 800_000) * 0.95);
  });
});

describe("expression evaluator: rendered formula is provenance-clean", () => {
  test("every token in the substituted formula traces to a node, a literal, or the result", () => {
    const src = "noi * 0.03";
    const refValues = { noi: 1_000_000 };
    const ast = parseExpression(src);
    const result = evaluate(ast, ctx(refValues));

    // The formula string the engine would render for this custom line.
    const money = (n: number) =>
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
    const formula = `custom reserve = noi * 0.03 [noi = ${money(refValues.noi)}] = ${money(result)}`;

    // Allowed set = referenced node values + analyst literals + the result.
    const allowed = buildAllowedValues(
      collectReferences(ast).map((r) => refValues[r as keyof typeof refValues]),
      collectLiterals(ast),
      [result],
    );
    expect(verifyNumericProvenance(formula, allowed).pass).toBe(true);

    // Drop the analyst literal from the allowed set and the coefficient is now
    // an orphan, proving literals must be admitted (they are never free).
    const withoutLiteral = buildAllowedValues([refValues.noi], [result]);
    expect(verifyNumericProvenance(formula, withoutLiteral).pass).toBe(false);
  });
});
