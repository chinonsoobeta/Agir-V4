#!/usr/bin/env node
// Stable, intentionally small operator interface. Granular scripts remain the
// implementation detail and can still be used for diagnosis.
import { spawn, spawnSync } from "node:child_process";

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

function runBrowserReleaseWithWorker(env) {
  const label = "browser and accessibility workflows with verification worker";
  json({ event: "check.started", label });
  const worker = spawn("npm", ["run", "worker:extraction"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...env,
      WORKER_DATABASE_URL: env.DATABASE_URL,
      EXTRACTION_WORKER_HANDLER_URL: "http://127.0.0.1:8081/api/extraction/worker",
      EXTRACTION_WORKER_POLL_MS: "1000",
    },
  });
  let result;
  try {
    // A release proof always executes the complete browser suite. Focused
    // specs are developer diagnostics and never alter this command.
    result = spawnSync("npm", ["run", "test:e2e"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env,
    });
  } finally {
    worker.kill("SIGTERM");
  }
  const outcome = classifyResult(label, result);
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
    ["format", ["run", "format:check"]],
    ["migration safety", ["run", "audit:migrations"]],
    ["server-auth audit", ["run", "audit:server-auth"]],
    ["service-role audit", ["run", "audit:service-role"]],
    ["backend audit", ["run", "backend:audit"]],
    ["lint", ["run", "lint"]],
    ["typecheck", ["run", "typecheck"]],
    ["unit tests", ["run", "test"]],
    ["production build", ["run", "build"]],
    ["bundle audit", ["run", "bundle:audit"]],
    ["secret scan", ["run", "scan:secrets"]],
    ["dependency scan", ["run", "scan:dependencies"]],
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
    // Explicit test-only token: production/staging must be configured through
    // deployment secrets, while the release gate must exercise the protected
    // handler and worker rather than silently running inline verification.
    EXTRACTION_WORKER_TOKEN: process.env.EXTRACTION_WORKER_TOKEN ?? "release-test-worker-token",
    EXTRACTION_ASYNC: "1",
    E2E_REUSE_EXISTING_SERVER: "0",
    // The release database is freshly provisioned by CI/local Supabase and is
    // therefore the explicit disposable target for the RLS suite.
    RLS_ALLOW_DESTRUCTIVE: "1",
  };
  const outcomes = [];
  for (const [label, args] of [
    ["format", ["run", "format:check"]],
    ["lint", ["run", "lint"]],
    ["typecheck", ["run", "typecheck"]],
    ["permit and underwriting unit regression", ["run", "test"]],
    ["production build", ["run", "build"]],
    ["bundle audit", ["run", "bundle:audit"]],
    ["pilot readiness artifacts", ["run", "pilot:audit"]],
    ["secret scan", ["run", "scan:secrets"]],
    ["dependency scan", ["run", "scan:dependencies"]],
    ["migrations", ["run", "migrate"]],
    ["migration safety", ["run", "audit:migrations"]],
    ["generated database types", ["run", "types:check"]],
    ["schema drift", ["run", "drift:check"]],
    ["fresh browser demo identity", ["run", "demo:user"]],
    ["extraction worker contract", ["run", "worker:extraction", "--", "--dry-run"]],
  ])
    outcomes.push(run(label, "npm", args, { env }));
  outcomes.push(runBrowserReleaseWithWorker(env));
  // RLS deliberately truncates auth fixtures and changes function-resolution
  // scaffolding, so it runs after browser proof. Audit-chain validation is
  // last, against the final post-test database state.
  outcomes.push(run("live RLS and concurrency", "npm", ["run", "test:rls"], { env }));
  outcomes.push(run("audit-chain verification", "npm", ["run", "audit:verify-chains"], { env }));
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
    run("document lifecycle recovery", "npm", ["run", "uploads:recover"], {
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
