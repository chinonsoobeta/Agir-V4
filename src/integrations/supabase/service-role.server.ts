import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const SERVICE_ROLE_CAPABILITIES = {
  audit_chain_verification: "Verify append-only audit chains and write evidence rows.",
  compliance_enforcement: "Run retention/deletion governance checks and record evidence.",
  demo_seed: "Seed isolated demo data and demo documents.",
  document_storage_recovery: "Recover storage objects after authenticated download denial.",
  document_upload_finalization: "Finalize server-verified staged document uploads.",
  extraction_worker: "Claim and heartbeat durable extraction jobs.",
  run_history_write: "Persist immutable normalized underwriting run history rows.",
  scim_provisioning: "Provision users and workspace memberships from enterprise IdP events.",
  schema_maintenance: "Refresh schema cache and run schema drift maintenance.",
} as const;

export type ServiceRoleCapability = keyof typeof SERVICE_ROLE_CAPABILITIES;

function createServiceRoleClient(capability: ServiceRoleCapability) {
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
    console.error(`[Supabase:${capability}] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        "x-agir-service-role-capability": capability,
      },
    },
  });
}

const clients = new Map<ServiceRoleCapability, ReturnType<typeof createServiceRoleClient>>();

export function getServiceRoleClient(capability: ServiceRoleCapability) {
  const existing = clients.get(capability);
  if (existing) return existing;
  const client = createServiceRoleClient(capability);
  clients.set(capability, client);
  return client;
}
