#!/usr/bin/env node
const hasAny = (env, keys) => keys.some((key) => Boolean(env[key]?.trim()));
const normalizeMode = (mode) =>
  mode === "production" || mode === "staging" || mode === "test" ? mode : "development";

function validate(env, rawMode) {
  const mode = normalizeMode(rawMode);
  const missing = [];
  const warnings = [];
  const requireAny = (label, keys) => {
    if (!hasAny(env, keys)) missing.push(`${label} (${keys.join(" or ")})`);
  };
  const warnAny = (label, keys) => {
    if (!hasAny(env, keys)) warnings.push(`${label} is not configured (${keys.join(" or ")}).`);
  };

  requireAny("Supabase URL", ["SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  requireAny("Supabase anon key", [
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);

  if (mode === "production" || mode === "staging") {
    requireAny("Supabase service role key", ["SUPABASE_SERVICE_ROLE_KEY"]);
    requireAny("Postgres URL", [
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
    ]);
    requireAny("observability sink", ["METRICS_WEBHOOK_URL", "ERROR_WEBHOOK_URL"]);
    warnAny("document scanning", ["DOCUMENT_SCAN_URL"]);
    warnAny("audit package signing", ["AUDIT_PACKAGE_SIGNING_SECRET"]);
    warnAny("SCIM provisioning", ["SCIM_BEARER_TOKEN", "SCIM_WORKSPACE_ID"]);
  } else {
    warnAny("production observability", ["METRICS_WEBHOOK_URL", "ERROR_WEBHOOK_URL"]);
  }

  return { mode, ok: missing.length === 0, missing, warnings };
}

const result = validate(process.env, process.env.AGIR_ENV ?? process.env.NODE_ENV ?? "development");
for (const warning of result.warnings) console.warn(`[env:validate] ${warning}`);
if (!result.ok) {
  for (const missing of result.missing) console.error(`[env:validate] missing ${missing}`);
  process.exit(1);
}
console.log(`[env:validate] ${result.mode} environment contract satisfied.`);
