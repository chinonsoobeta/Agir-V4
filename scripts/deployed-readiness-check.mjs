#!/usr/bin/env node
// Pre-demo gate for a DEPLOYED environment: verifies the health endpoint and
// the sign-in page of the live app, not localhost. Run it the morning of any
// unsupervised demo:
//
//   npm run readiness:deployed -- https://app.example.com
//   (or APP_URL=https://app.example.com npm run readiness:deployed)
//
// Exit code 0 = ready; 1 = at least one hard check failed.

const rawUrl = process.argv[2] ?? process.env.APP_URL;
if (!rawUrl) {
  console.error("Usage: npm run readiness:deployed -- <deployed-app-url>");
  process.exit(1);
}
const base = rawUrl.replace(/\/+$/, "");
let failed = false;

function report(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[readiness] ${mark}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed = true;
}

function warn(name, ok) {
  console.log(`[readiness] ${ok ? "PASS" : "WARN"}  ${name}`);
}

// The same required set /api/health derives its overall status from; every
// other flag is operational posture worth seeing but not a demo blocker.
const REQUIRED_CHECKS = new Set(["supabaseUrl", "supabaseAnonKey", "schemaDrift", "envValid"]);

async function fetchWithTimeout(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

// 1. Health endpoint: overall status plus each required check.
try {
  const res = await fetchWithTimeout(`${base}/api/health`);
  const body = await res.json();
  report("health endpoint reachable", res.status === 200 || res.status === 503);
  report("health status ok", body.status === "ok", `status=${body.status}`);
  for (const [check, ok] of Object.entries(body.checks ?? {})) {
    if (REQUIRED_CHECKS.has(check)) report(`health check: ${check}`, Boolean(ok));
    else warn(`health check: ${check}`, Boolean(ok));
  }
} catch (err) {
  report("health endpoint reachable", false, err instanceof Error ? err.message : String(err));
}

// 2. Sign-in page renders (the first thing an evaluator sees).
try {
  const res = await fetchWithTimeout(`${base}/auth`);
  const html = await res.text();
  report("sign-in page responds 200", res.status === 200, `HTTP ${res.status}`);
  report("sign-in page renders the form shell", /sign in/i.test(html));
} catch (err) {
  report("sign-in page responds 200", false, err instanceof Error ? err.message : String(err));
}

console.log(
  failed
    ? "\n[readiness] NOT READY - fix the failing checks before an unsupervised demo."
    : "\n[readiness] READY - deployed environment passes the pre-demo gate.",
);
process.exit(failed ? 1 : 0);
