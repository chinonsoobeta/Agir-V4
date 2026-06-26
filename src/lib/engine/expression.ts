// Sandboxed expression evaluator for analyst-defined custom line items
// (Workstream 1, additive and opt-in). Pure and deterministic.
//
// THE TRUST RULE: a custom line item can never mint a value from nothing. The
// evaluator only understands numeric literals the analyst typed, references to
// node values the engine explicitly supplies, and a tiny whitelist of operators
// and functions. There is NO property access, NO assignment, NO function
// definition, and NO host access of any kind, so it is impossible to reach a
// global, a Date, or any source of nondeterminism. Anything the tokenizer does
// not recognize is rejected (fail-closed), and a reference the engine did not
// supply throws rather than resolving to zero.
//
// Because the expression string itself is shown to the analyst as the formula
// (see schedule.ts), every number it produces stays provenance-checkable: each
// token is either a referenced node value, an analyst-approved literal, or the
// computed result.

export type ExprNode =
  | { kind: "num"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "unary"; op: "-"; operand: ExprNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: ExprNode; right: ExprNode }
  | { kind: "call"; fn: WhitelistFn; args: ExprNode[] };

export type WhitelistFn = "min" | "max" | "abs";

const WHITELIST_FNS: Record<WhitelistFn, { minArgs: number; maxArgs: number }> = {
  min: { minArgs: 1, maxArgs: Infinity },
  max: { minArgs: 1, maxArgs: Infinity },
  abs: { minArgs: 1, maxArgs: 1 },
};

// A typed error so callers can distinguish a malformed/unsafe expression from a
// genuine runtime fault and fail closed (surface a warning, never a fabricated
// number).
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ---- Tokenizer ------------------------------------------------------------

type Token =
  | { type: "num"; value: number }
  | { type: "id"; name: string }
  | { type: "op"; op: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ type: "op", op: c });
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma" });
      i += 1;
      continue;
    }
    // Number: digits with an optional single decimal point. A leading point
    // (".5") is accepted. No exponent syntax, so "1e9" is never mistaken for a
    // number (the "e9" would parse as an unknown identifier and fail closed).
    if ((c >= "0" && c <= "9") || (c === "." && i + 1 < n && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i;
      let seenDot = false;
      while (j < n) {
        const d = src[j];
        if (d >= "0" && d <= "9") {
          j += 1;
        } else if (d === "." && !seenDot) {
          seenDot = true;
          j += 1;
        } else {
          break;
        }
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number '${text}'.`);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    // Identifier: a reference or a whitelisted function name. Underscores and
    // digits are allowed after the first letter; nothing else.
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i;
      while (j < n) {
        const d = src[j];
        if ((d >= "a" && d <= "z") || (d >= "A" && d <= "Z") || (d >= "0" && d <= "9") || d === "_") {
          j += 1;
        } else {
          break;
        }
      }
      tokens.push({ type: "id", name: src.slice(i, j) });
      i = j;
      continue;
    }
    // Anything else (a dot outside a number, '.', '[', '%', '=', a quote, ...)
    // is rejected. This is what blocks member access and every host escape.
    throw new ExpressionError(`Unexpected character '${c}' at position ${i}.`);
  }
  return tokens;
}

// ---- Parser (recursive descent) -------------------------------------------
//
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := '-' factor | primary
//   primary:= number | call | reference | '(' expr ')'
//   call   := identifier '(' (expr (',' expr)*)? ')'

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    if (this.tokens.length === 0) throw new ExpressionError("Empty expression.");
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new ExpressionError("Unexpected trailing tokens.");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseExpr(): ExprNode {
    let left = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (t && t.type === "op" && (t.op === "+" || t.op === "-")) {
        this.pos += 1;
        const right = this.parseTerm();
        left = { kind: "binary", op: t.op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): ExprNode {
    let left = this.parseFactor();
    while (true) {
      const t = this.peek();
      if (t && t.type === "op" && (t.op === "*" || t.op === "/")) {
        this.pos += 1;
        const right = this.parseFactor();
        left = { kind: "binary", op: t.op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): ExprNode {
    const t = this.peek();
    if (t && t.type === "op" && t.op === "-") {
      this.pos += 1;
      return { kind: "unary", op: "-", operand: this.parseFactor() };
    }
    if (t && t.type === "op" && t.op === "+") {
      // Unary plus is a no-op; consume and continue.
      this.pos += 1;
      return this.parseFactor();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (!t) throw new ExpressionError("Unexpected end of expression.");
    if (t.type === "num") {
      this.pos += 1;
      return { kind: "num", value: t.value };
    }
    if (t.type === "lparen") {
      this.pos += 1;
      const inner = this.parseExpr();
      const close = this.peek();
      if (!close || close.type !== "rparen") throw new ExpressionError("Expected ')'.");
      this.pos += 1;
      return inner;
    }
    if (t.type === "id") {
      this.pos += 1;
      const next = this.peek();
      if (next && next.type === "lparen") {
        // Function call. Only whitelisted names are callable.
        if (!(t.name in WHITELIST_FNS)) throw new ExpressionError(`Unknown function '${t.name}'.`);
        const fn = t.name as WhitelistFn;
        this.pos += 1; // consume '('
        const args: ExprNode[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek()?.type === "comma") {
            this.pos += 1;
            args.push(this.parseExpr());
          }
        }
        const close = this.peek();
        if (!close || close.type !== "rparen") throw new ExpressionError("Expected ')'.");
        this.pos += 1;
        const arity = WHITELIST_FNS[fn];
        if (args.length < arity.minArgs || args.length > arity.maxArgs) {
          throw new ExpressionError(`Function '${fn}' got ${args.length} argument(s).`);
        }
        return { kind: "call", fn, args };
      }
      // A whitelisted function name used without a call is not a value.
      if (t.name in WHITELIST_FNS) throw new ExpressionError(`'${t.name}' is a function and must be called.`);
      return { kind: "ref", name: t.name };
    }
    throw new ExpressionError("Unexpected token.");
  }
}

// Parse an expression string into a typed AST. Throws ExpressionError on any
// malformed or unsafe input.
export function parseExpression(src: string): ExprNode {
  return new Parser(tokenize(src)).parse();
}

// Every reference (identifier) the expression depends on, de-duplicated in first
// -seen order. Used to validate against the allowed node set and to build the
// evaluation context.
export function collectReferences(node: ExprNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: ExprNode) => {
    switch (n.kind) {
      case "ref":
        if (!seen.has(n.name)) {
          seen.add(n.name);
          out.push(n.name);
        }
        break;
      case "unary":
        walk(n.operand);
        break;
      case "binary":
        walk(n.left);
        walk(n.right);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(node);
  return out;
}

// Every numeric literal the analyst wrote into the expression. These are the
// approved coefficients; the caller feeds them into the provenance allowed set
// so the rendered formula stays orphan-free.
export function collectLiterals(node: ExprNode): number[] {
  const out: number[] = [];
  const walk = (n: ExprNode) => {
    switch (n.kind) {
      case "num":
        out.push(n.value);
        break;
      case "unary":
        walk(n.operand);
        break;
      case "binary":
        walk(n.left);
        walk(n.right);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(node);
  return out;
}

// Evaluate the AST against a context of node values. A reference absent from the
// context throws (fail-closed). Division by zero and any non-finite result throw
// rather than letting NaN/Infinity leak into a displayed figure.
export function evaluate(node: ExprNode, context: Map<string, number>): number {
  const result = evalNode(node, context);
  if (!Number.isFinite(result)) throw new ExpressionError("Expression did not produce a finite number.");
  return result;
}

function evalNode(node: ExprNode, ctx: Map<string, number>): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "ref": {
      const v = ctx.get(node.name);
      if (v == null) throw new ExpressionError(`Unknown reference '${node.name}'.`);
      if (!Number.isFinite(v)) throw new ExpressionError(`Reference '${node.name}' is not a finite number.`);
      return v;
    }
    case "unary":
      return -evalNode(node.operand, ctx);
    case "binary": {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new ExpressionError("Division by zero.");
          return l / r;
        default:
          throw new ExpressionError("Unknown operator.");
      }
    }
    case "call": {
      const args = node.args.map((a) => evalNode(a, ctx));
      switch (node.fn) {
        case "min":
          return Math.min(...args);
        case "max":
          return Math.max(...args);
        case "abs":
          return Math.abs(args[0]);
        default:
          throw new ExpressionError("Unknown function.");
      }
    }
    default:
      throw new ExpressionError("Unknown node.");
  }
}

// Parse, validate references against an allowed set, and evaluate in one call.
// `allowedRefs`, when supplied, restricts which node names the expression may
// reference (a name outside the set throws even before evaluation). Pure.
export function evaluateExpression(
  src: string,
  context: Map<string, number>,
  allowedRefs?: Iterable<string>,
): number {
  const ast = parseExpression(src);
  if (allowedRefs) {
    const allowed = new Set(allowedRefs);
    for (const ref of collectReferences(ast)) {
      if (!allowed.has(ref)) throw new ExpressionError(`Reference '${ref}' is not an allowed node.`);
    }
  }
  return evaluate(ast, context);
}
