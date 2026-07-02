// Staged-deployment safety: newer code may briefly run against an older schema
// (a migration not yet applied). Demo/test schemas may intentionally lag, but
// production-like environments must fail loudly instead of silently degrading.
// Shared by server functions that intentionally support compatibility fallback.

export type SchemaCompatMode = "strict" | "demo" | "test";

const MODES = new Set<SchemaCompatMode>(["strict", "demo", "test"]);

type CompatError = { code?: string; message?: string } | null | undefined;

export function getSchemaCompatMode(env: NodeJS.ProcessEnv = process.env): SchemaCompatMode {
  const appEnv = (env.AGIR_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  if (appEnv === "production" || appEnv === "staging") return "strict";

  const explicit = env.AGIR_SCHEMA_COMPAT_MODE?.trim().toLowerCase();
  if (MODES.has(explicit as SchemaCompatMode)) return explicit as SchemaCompatMode;

  if (appEnv === "test") return "test";
  return "demo";
}

export function shouldAllowSchemaFallback(
  _featureName: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return getSchemaCompatMode(env) !== "strict";
}

function errorMessage(error: CompatError) {
  return error?.message ?? error?.code ?? "unknown schema error";
}

export function schemaCompatibilityError(
  error: CompatError,
  opts: {
    featureName: string;
    table?: string;
    column?: string;
    operation?: string;
  },
) {
  const target = [opts.table, opts.column].filter(Boolean).join(".") || "schema";
  return new Error(
    `Required database schema is missing for ${opts.featureName} (${target}) during ${opts.operation ?? "operation"}: ${errorMessage(error)}`,
  );
}

export function handleSchemaCompatibilityFallback<T>(
  error: CompatError,
  opts: {
    featureName: string;
    table?: string;
    column?: string;
    operation?: string;
    fallback: T;
    env?: NodeJS.ProcessEnv;
  },
): T {
  if (!shouldAllowSchemaFallback(opts.featureName, opts.env)) {
    throw schemaCompatibilityError(error, opts);
  }

  const event = {
    level: "warn",
    event: "schema_compatibility_fallback",
    mode: getSchemaCompatMode(opts.env),
    feature: opts.featureName,
    table: opts.table ?? null,
    column: opts.column ?? null,
    operation: opts.operation ?? null,
    error_code: error?.code ?? null,
    error_message: error?.message ?? null,
  };
  console.warn(JSON.stringify(event));
  return opts.fallback;
}

export function isMissingRelation(error: CompatError) {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST205" ||
      error.code === "42P01" ||
      /could not find the table ['"][^'"]+['"]/i.test(message) ||
      /could not find the table ['"][^'"]+['"] in the schema cache/i.test(message) ||
      /relation ['"]?[\w.]+['"]? does not exist/i.test(message)),
  );
}

// A column the code writes does not exist yet on the deployed schema (a later
// ALTER TABLE migration has not run). PostgREST reports this as PGRST204 with a
// "Could not find the 'x' column of 'y' in the schema cache" message. Callers
// strip the newer columns and retry so the write still succeeds on old schemas.
export function isMissingColumn(error: CompatError) {
  return Boolean(
    error &&
    (error.code === "PGRST204" || /could not find the '.*' column/i.test(error.message ?? "")),
  );
}
