import process from "node:process";

/** The only server-side environment boundary. Never import this from browser code. */
export type AgirEnvironment = "development" | "demo" | "test" | "staging" | "production";

export type ServerConfig = Readonly<{
  nodeEnv?: string;
  environment: AgirEnvironment;
  isProductionLike: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  serviceRoleKey?: string;
  databaseUrl?: string;
  scannerUrl?: string;
  scannerFormat: "raw" | "multipart";
  scannerTimeoutMs: number;
  scannerFailOpen: boolean;
  asyncExtraction: boolean;
  workerToken?: string;
  errorWebhookUrl?: string;
  metricsWebhookUrl?: string;
  aiModel: string;
  anthropicApiKey?: string;
  anthropicApiKeyCandidates: readonly string[];
  scimBearerToken?: string;
  scimWorkspaceId?: string;
  maxOcrPages: number;
  extractionTextScanCharLimit: number;
  auditPackageSigningSecret?: string;
}>;

export type ConfigRequirement =
  | "supabase"
  | "serviceRole"
  | "database"
  | "scanner"
  | "worker"
  | "observability";

const value = (env: NodeJS.ProcessEnv, ...names: string[]) => {
  for (const name of names) {
    const candidate = env[name]?.trim();
    if (candidate) return candidate;
  }
  return undefined;
};

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveAgirEnvironment(
  raw = process.env.AGIR_ENV ?? process.env.NODE_ENV,
): AgirEnvironment {
  switch (raw?.trim().toLowerCase()) {
    case "production":
    case "staging":
    case "test":
    case "demo":
    case "development":
      return raw.trim().toLowerCase() as AgirEnvironment;
    default:
      return "development";
  }
}

/**
 * Resolves aliases once. Preferred names are SUPABASE_URL,
 * SUPABASE_ANON_KEY, DATABASE_URL, and DOCUMENT_SCAN_URL. VITE/NEXT aliases
 * remain supported only for backwards-compatible host integration.
 */
export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const environment = resolveAgirEnvironment(env.AGIR_ENV ?? env.NODE_ENV);
  const isProductionLike = environment === "production" || environment === "staging";
  const scannerFormat =
    value(env, "DOCUMENT_SCAN_FORMAT")?.toLowerCase() === "multipart" ? "multipart" : "raw";
  return {
    nodeEnv: value(env, "NODE_ENV"),
    environment,
    isProductionLike,
    supabaseUrl: value(env, "SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: value(
      env,
      "SUPABASE_ANON_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    serviceRoleKey: value(env, "SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: value(
      env,
      "DATABASE_URL",
      "POSTGRES_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_POSTGRES_URL",
      "SUPABASE_SERVICE_DATABASE_URL",
    ),
    scannerUrl: value(env, "DOCUMENT_SCAN_URL"),
    scannerFormat,
    scannerTimeoutMs: positiveInteger(value(env, "DOCUMENT_SCAN_TIMEOUT_MS"), 30_000),
    // This escape hatch is deliberately impossible in staging/production.
    scannerFailOpen: !isProductionLike && value(env, "DOCUMENT_SCAN_FAIL_OPEN") === "1",
    // Production/staging are always asynchronous; a false flag cannot weaken it.
    asyncExtraction: isProductionLike || value(env, "EXTRACTION_ASYNC") === "1",
    workerToken: value(env, "EXTRACTION_WORKER_TOKEN"),
    errorWebhookUrl: value(env, "ERROR_WEBHOOK_URL"),
    metricsWebhookUrl: value(env, "METRICS_WEBHOOK_URL"),
    aiModel: value(env, "AGIR_AI_MODEL") ?? "claude-sonnet-4-6",
    // API_KEY remains the preferred local alias; diagnostics never expose it.
    // Preserve both aliases so the AI boundary can skip a malformed preferred
    // value and safely use a valid compatibility alias. Never expose either
    // candidate through diagnostics.
    anthropicApiKey: value(env, "API_KEY", "ANTHROPIC_API_KEY"),
    anthropicApiKeyCandidates: [value(env, "API_KEY"), value(env, "ANTHROPIC_API_KEY")].filter(
      (candidate): candidate is string => Boolean(candidate),
    ),
    scimBearerToken: value(env, "SCIM_BEARER_TOKEN"),
    scimWorkspaceId: value(env, "SCIM_WORKSPACE_ID"),
    maxOcrPages: positiveInteger(value(env, "MAX_OCR_PAGES"), 10),
    extractionTextScanCharLimit: positiveInteger(
      value(env, "EXTRACTION_TEXT_SCAN_CHAR_LIMIT"),
      5_000_000,
    ),
    auditPackageSigningSecret: value(env, "AUDIT_PACKAGE_SIGNING_SECRET"),
  };
}

function missingRequirements(config: ServerConfig, requirements: readonly ConfigRequirement[]) {
  const missing: string[] = [];
  for (const requirement of requirements) {
    if (requirement === "supabase" && (!config.supabaseUrl || !config.supabaseAnonKey))
      missing.push("Supabase URL and anon/publishable key");
    if (requirement === "serviceRole" && !config.serviceRoleKey)
      missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (requirement === "database" && !config.databaseUrl) missing.push("DATABASE_URL");
    if (requirement === "scanner" && !config.scannerUrl) missing.push("DOCUMENT_SCAN_URL");
    if (requirement === "worker" && (!config.workerToken || !config.asyncExtraction))
      missing.push("EXTRACTION_WORKER_TOKEN with asynchronous extraction");
    if (requirement === "observability" && !config.errorWebhookUrl && !config.metricsWebhookUrl)
      missing.push("ERROR_WEBHOOK_URL or METRICS_WEBHOOK_URL");
  }
  return missing;
}

/** Fails without echoing values, secrets, URLs, or tokens. */
export function getServerConfig(
  requirements: readonly ConfigRequirement[] = [],
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const config = readServerConfig(env);
  // Callers declare only the services their operation uses. Production-wide
  // readiness is enforced by scripts/validate-env.mjs at deployment time;
  // requiring document infrastructure here would block unrelated actions such
  // as authentication and Permit case creation.
  const missing = missingRequirements(config, [...new Set(requirements)]);
  if (missing.length) throw new Error(`Server configuration is incomplete: ${missing.join("; ")}.`);
  return config;
}

/** Safe for health endpoints and diagnostics; deliberately contains no values. */
export function getRedactedConfigDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const config = readServerConfig(env);
  return {
    environment: config.environment,
    productionLike: config.isProductionLike,
    supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
    serviceRoleConfigured: Boolean(config.serviceRoleKey),
    databaseConfigured: Boolean(config.databaseUrl),
    scannerConfigured: Boolean(config.scannerUrl),
    asyncExtraction: config.asyncExtraction,
    workerConfigured: Boolean(config.workerToken),
    observabilityConfigured: Boolean(config.errorWebhookUrl || config.metricsWebhookUrl),
  };
}
