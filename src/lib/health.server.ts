import type { SchemaDriftCheck } from "./schema-drift.server";
import { validateServerEnv } from "./env.server";
import { hasAiProvider } from "./ai-gateway.server";

const hasAny = (env: NodeJS.ProcessEnv, keys: readonly string[]) =>
  keys.some((key) => Boolean(env[key]?.trim()));

export type HealthChecks = {
  supabaseUrl: boolean;
  supabaseAnonKey: boolean;
  schemaDrift: boolean;
  databaseUrlConfigured: boolean;
  serviceRoleConfigured: boolean;
  workerQueueConfigured: boolean;
  scannerConfigured: boolean;
  metricsSinkConfigured: boolean;
  auditVerifierConfigured: boolean;
  governanceConfigured: boolean;
  aiProviderConfigured: boolean;
  envValid: boolean;
};

export function buildHealthChecks(
  schema: Pick<SchemaDriftCheck, "status" | "configured">,
  env: NodeJS.ProcessEnv = process.env,
): HealthChecks {
  const envValidation = validateServerEnv(env, env.AGIR_ENV ?? env.NODE_ENV ?? "development");
  return {
    supabaseUrl: hasAny(env, ["SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    supabaseAnonKey: hasAny(env, [
      "SUPABASE_ANON_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ]),
    schemaDrift: schema.status !== "drift",
    databaseUrlConfigured: hasAny(env, [
      "POSTGRES_URL",
      "DATABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
    ]),
    serviceRoleConfigured: hasAny(env, ["SUPABASE_SERVICE_ROLE_KEY"]),
    workerQueueConfigured: hasAny(env, [
      "WORKER_DATABASE_URL",
      "SUPABASE_SERVICE_DATABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
    ]),
    scannerConfigured: hasAny(env, ["DOCUMENT_SCAN_URL"]),
    metricsSinkConfigured: hasAny(env, ["METRICS_WEBHOOK_URL", "ERROR_WEBHOOK_URL"]),
    auditVerifierConfigured: schema.configured,
    governanceConfigured: hasAny(env, ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL"]),
    aiProviderConfigured: hasAiProvider(env),
    envValid: envValidation.ok,
  };
}
