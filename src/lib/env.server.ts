import { readServerConfig, resolveAgirEnvironment, type AgirEnvironment } from "./config.server";

export type DeploymentMode = AgirEnvironment;
export type EnvValidationResult = {
  mode: DeploymentMode;
  ok: boolean;
  missing: string[];
  warnings: string[];
};

/** Compatibility facade for health checks and tests. New server code uses config.server.ts. */
export function validateServerEnv(
  env: NodeJS.ProcessEnv = process.env,
  rawMode = env.AGIR_ENV ?? env.NODE_ENV ?? "development",
): EnvValidationResult {
  const config = readServerConfig({ ...env, AGIR_ENV: rawMode });
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!config.supabaseUrl) missing.push("Supabase URL (SUPABASE_URL preferred)");
  if (!config.supabaseAnonKey) missing.push("Supabase anon key (SUPABASE_ANON_KEY preferred)");
  if (config.isProductionLike) {
    if (!config.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!config.databaseUrl) missing.push("DATABASE_URL");
    if (!config.scannerUrl) missing.push("DOCUMENT_SCAN_URL");
    if (!config.workerToken) missing.push("EXTRACTION_WORKER_TOKEN");
    if (!config.errorWebhookUrl && !config.metricsWebhookUrl)
      missing.push("ERROR_WEBHOOK_URL or METRICS_WEBHOOK_URL");
  } else if (!config.errorWebhookUrl && !config.metricsWebhookUrl) {
    warnings.push(
      "production observability is not configured (ERROR_WEBHOOK_URL or METRICS_WEBHOOK_URL).",
    );
  }
  return { mode: resolveAgirEnvironment(rawMode), ok: missing.length === 0, missing, warnings };
}
