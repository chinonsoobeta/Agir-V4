#!/usr/bin/env node
// Stable, intentionally small operator interface. Granular scripts remain the
// implementation detail and can still be used for diagnosis.
import { spawnSync } from "node:child_process";

const operation = process.argv[2];
const destructive = process.argv.includes("--confirm-remediation");
const json = (event) => console.log(JSON.stringify({ component: "agir-ops", ...event }));

export function classifyResult(label, result, blocked = false) {
  if (blocked) return { label, status: "blocked", code: result?.status ?? 1 };
  return { label, status: result?.status === 0 ? "passed" : "failed", code: result?.status ?? 1 };
}

function run(label, command, args, options = {}) {
  json({ event: "check.started", label });
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: options.env ?? process.env,
  });
  const outcome = classifyResult(label, result, options.blocked === true);
  json({ event: "check.finished", ...outcome });
  return outcome;
}

function has(...keys) {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function finish(operationName, outcomes) {
  const counts = Object.fromEntries(
    ["passed", "failed", "skipped", "blocked"].map((status) => [
      status,
      outcomes.filter((outcome) => outcome.status === status).length,
    ]),
  );
  json({ event: "operation.finished", operation: operationName, counts });
  // A blocked mandatory proof is intentionally non-zero; it must never look
  // like release confidence just because static checks happened to pass.
  process.exitCode = counts.failed || counts.blocked ? 1 : 0;
}

function check() {
  const outcomes = [];
  outcomes.push(
    run("environment validation", "npm", ["run", "env:validate"], {
      blocked: !has("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    }),
  );
  for (const [label, args] of [
    ["migration safety", ["run", "audit:migrations"]],
    ["server-auth audit", ["run", "audit:server-auth"]],
    ["service-role audit", ["run", "audit:service-role"]],
    ["backend audit", ["run", "backend:audit"]],
    ["lint", ["run", "lint"]],
    ["typecheck", ["run", "typecheck"]],
    ["unit tests", ["run", "test"]],
    ["production build", ["run", "build"]],
    ["bundle audit", ["run", "bundle:audit"]],
  ])
    outcomes.push(run(label, "npm", args));
  finish("check", outcomes);
}

function release() {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    json({ event: "check.finished", label: "release infrastructure", status: "blocked", missing });
    finish("release", [{ label: "release infrastructure", status: "blocked" }]);
    return;
  }
  const env = {
    ...process.env,
    AGIR_ENV: process.env.AGIR_ENV ?? "test",
    SCHEMA_DRIFT_DATABASE_URL: process.env.SCHEMA_DRIFT_DATABASE_URL ?? process.env.DATABASE_URL,
    AUDIT_CHAIN_DATABASE_URL: process.env.AUDIT_CHAIN_DATABASE_URL ?? process.env.DATABASE_URL,
  };
  const outcomes = [];
  for (const [label, args] of [
    ["migrations", ["run", "migrate"]],
    ["migration safety", ["run", "audit:migrations"]],
    ["generated database types", ["run", "types:check"]],
    ["schema drift", ["run", "drift:check"]],
    ["live RLS and concurrency", ["run", "test:rls"]],
    ["audit-chain verification", ["run", "audit:verify-chains"]],
    ["extraction worker contract", ["run", "worker:extraction", "--", "--dry-run"]],
    ["browser workflows", ["run", "test:e2e"]],
  ])
    outcomes.push(run(label, "npm", args, { env }));
  finish("release", outcomes);
}

function cleanup() {
  const outcomes = [run("expired pending upload cleanup", "npm", ["run", "uploads:cleanup"])];
  finish("cleanup", outcomes);
}

function recover() {
  const outcomes = [];
  outcomes.push(run("migration safety", "npm", ["run", "audit:migrations"]));
  outcomes.push(
    run("audit-chain verification", "npm", ["run", "audit:verify-chains"], {
      blocked: !has("DATABASE_URL", "AUDIT_CHAIN_DATABASE_URL"),
    }),
  );
  outcomes.push(
    run("extraction worker contract", "npm", ["run", "worker:extraction", "--", "--dry-run"]),
  );
  outcomes.push(
    run("pending-upload report", "npm", ["run", "uploads:cleanup", "--", "--report-only"], {
      blocked: !has("SUPABASE_URL", "VITE_SUPABASE_URL") || !has("SUPABASE_SERVICE_ROLE_KEY"),
    }),
  );
  if (destructive) {
    json({
      event: "remediation.refused",
      reason:
        "No destructive remediation is implemented by ops:recover; run ops:cleanup separately after review.",
    });
  }
  finish("recover", outcomes);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (operation === "check") check();
  else if (operation === "release") release();
  else if (operation === "cleanup") cleanup();
  else if (operation === "recover") recover();
  else {
    console.error(
      "Usage: node scripts/ops.mjs <check|release|cleanup|recover> [--confirm-remediation]",
    );
    process.exitCode = 2;
  }
}
