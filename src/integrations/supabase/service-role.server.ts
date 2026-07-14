import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getServerConfig } from "@/lib/config.server";

export const SERVICE_ROLE_CAPABILITIES = {
  audit_chain_verification: "Verify append-only audit chains and write evidence rows.",
  compliance_enforcement: "Run retention/deletion governance checks and record evidence.",
  demo_seed: "Seed isolated demo data and demo documents.",
  document_storage_recovery: "Recover storage objects after authenticated download denial.",
  document_upload_finalization: "Finalize server-verified staged document uploads.",
  document_ingestion_worker:
    "Verify pending upload bytes and atomically finalize or reject them under a live queue lease.",
  extraction_worker: "Claim and heartbeat durable extraction jobs.",
  permit_research_worker: "Write review-only Permit evidence derived from verified documents.",
  run_history_write: "Persist immutable normalized underwriting run history rows.",
  scim_provisioning: "Provision users and workspace memberships from enterprise IdP events.",
  schema_maintenance: "Refresh schema cache and run schema drift maintenance.",
} as const;

export type ServiceRoleCapability = keyof typeof SERVICE_ROLE_CAPABILITIES;

function createServiceRoleClient(capability: ServiceRoleCapability) {
  const config = getServerConfig(["serviceRole"]);
  if (!config.supabaseUrl || !config.serviceRoleKey)
    throw new Error(
      "Server configuration is incomplete: Supabase service-role client unavailable.",
    );

  return createClient<Database>(config.supabaseUrl, config.serviceRoleKey, {
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
