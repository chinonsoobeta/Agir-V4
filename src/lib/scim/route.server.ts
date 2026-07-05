// HTTP adapter that turns a Request into a SCIM response. Used by the
// /api/scim/v2/Users[/:id] route files. Auth and protocol live in handleScim;
// this only marshals the Request and selects the workspace + token from config.
//
// Single-tenant-per-token model: one provisioning token maps to one workspace
// via env (SCIM_BEARER_TOKEN + SCIM_WORKSPACE_ID). Per-workspace hashed tokens
// (so one deployment serves many tenants) are a follow-up that needs a token
// table migration; see docs/compliance/enabler-status.md.
import { handleScim } from "./handler";
import { createSupabaseScimStore } from "./supabase-store.server";

const SCIM_CONTENT_TYPE = "application/scim+json";

const SCIM_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SCIM_WINDOW_MS = 60 * 60 * 1000;
const SCIM_MAX_WRITES = 200;
const scimRateMap = new Map<string, { count: number; windowStart: number }>();

function enforceScimRateLimit(workspaceId: string, method: string): void {
  if (!SCIM_WRITE_METHODS.has(method)) return;
  const now = Date.now();
  const entry = scimRateMap.get(workspaceId);
  if (!entry || now - entry.windowStart > SCIM_WINDOW_MS) {
    scimRateMap.set(workspaceId, { count: 1, windowStart: now });
    return;
  }
  if (entry.count >= SCIM_MAX_WRITES) {
    throw new Error("SCIM rate limit reached. Try again later.");
  }
  entry.count++;
}

export async function handleScimRoute(request: Request, segments: string[]): Promise<Response> {
  const expectedToken = process.env.SCIM_BEARER_TOKEN;
  const workspaceId = process.env.SCIM_WORKSPACE_ID;

  if (!workspaceId) {
    return Response.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "501",
        detail: "SCIM is not configured (SCIM_WORKSPACE_ID unset).",
      },
      { status: 501, headers: { "content-type": SCIM_CONTENT_TYPE } },
    );
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  let body: unknown;
  if (hasBody) {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }

  await enforceScimRateLimit(workspaceId, method);

  const res = await handleScim(
    {
      method,
      segments,
      query: { filter: url.searchParams.get("filter") ?? undefined },
      body,
      bearer: request.headers.get("authorization"),
      baseUrl: `${url.origin}/api/scim/v2`,
    },
    { store: createSupabaseScimStore(workspaceId), expectedToken },
  );

  if (res.status === 204 || res.body == null) {
    return new Response(null, { status: res.status });
  }
  return new Response(JSON.stringify(res.body), {
    status: res.status,
    headers: { "content-type": SCIM_CONTENT_TYPE, "cache-control": "no-store" },
  });
}
