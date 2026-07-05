// SCIM 2.0 request handler: a pure dispatcher over an injectable store, so the
// whole surface (bearer auth, routing, CRUD, error shapes) is unit-testable
// with an in-memory store and the HTTP route (src/routes/api/scim/...) is a
// thin adapter. Implements the subset of RFC 7644 that Okta / Entra ID / OneLogin
// drive: POST/GET/PATCH/PUT/DELETE /Users and GET /Users?filter=userName eq "x".

import {
  parseScimUser,
  ScimParseError,
  applyScimPatch,
  memberToScimUser,
  scimListResponse,
  scimError,
  parseUserNameFilter,
  type ProvisionedMember,
  type ParsedScimUser,
  type WorkspaceRole,
} from "./scim";

export interface ScimStore {
  findByEmail(email: string): Promise<ProvisionedMember | null>;
  getById(id: string): Promise<ProvisionedMember | null>;
  list(): Promise<ProvisionedMember[]>;
  create(parsed: ParsedScimUser): Promise<ProvisionedMember>;
  update(id: string, patch: Partial<ProvisionedMember>): Promise<ProvisionedMember | null>;
  remove(id: string): Promise<boolean>;
}

export type ScimRequest = {
  method: string;
  /** Path segments AFTER the SCIM base, e.g. ["Users"] or ["Users", "m-1"]. */
  segments: string[];
  query?: Record<string, string | undefined>;
  body?: unknown;
  bearer?: string | null;
  baseUrl?: string;
};

export type ScimResponse = { status: number; body: unknown };

// Constant-time string compare so a configured provisioning token can't be
// recovered by timing the 401.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown): ScimResponse => ({ status, body });

export async function handleScim(
  req: ScimRequest,
  opts: {
    store: ScimStore;
    expectedToken: string | undefined;
    roleMapping?: Record<string, WorkspaceRole>;
  },
): Promise<ScimResponse> {
  // ----- Auth: a provisioning bearer token must be configured AND match. -----
  const presented = (req.bearer ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!opts.expectedToken || !presented || !safeEqual(presented, opts.expectedToken)) {
    return json(401, scimError(401, "Invalid or missing SCIM bearer token."));
  }

  const [resource, id] = req.segments;
  if (resource !== "Users") {
    return json(404, scimError(404, `Unsupported SCIM resource: ${resource ?? "(none)"}.`));
  }

  const method = req.method.toUpperCase();
  const { store } = opts;
  const { baseUrl } = req;

  try {
    // ----- Collection: /Users -----
    if (!id) {
      if (method === "GET") {
        const wanted = parseUserNameFilter(req.query?.filter);
        if (wanted) {
          const found = await store.findByEmail(wanted);
          return json(200, scimListResponse(found ? [found] : [], baseUrl));
        }
        return json(200, scimListResponse(await store.list(), baseUrl));
      }
      if (method === "POST") {
        const parsed = parseScimUser(req.body, opts.roleMapping);
        const existing = await store.findByEmail(parsed.email);
        if (existing) {
          // Idempotent provisioning: IdPs expect 409 on duplicate create.
          return json(409, scimError(409, "User already provisioned."));
        }
        const created = await store.create(parsed);
        return json(201, memberToScimUser(created, baseUrl));
      }
      return json(405, scimError(405, `Method ${method} not allowed on /Users.`));
    }

    // ----- Member: /Users/:id -----
    const member = await store.getById(id);
    if (!member) return json(404, scimError(404, "User not found."));

    if (method === "GET") return json(200, memberToScimUser(member, baseUrl));

    if (method === "PATCH") {
      const next = applyScimPatch(member, req.body);
      const saved = await store.update(id, { active: next.active, role: next.role });
      return json(200, memberToScimUser(saved ?? next, baseUrl));
    }

    if (method === "PUT") {
      const parsed = parseScimUser(req.body, opts.roleMapping);
      const saved = await store.update(id, {
        active: parsed.active,
        role: parsed.role,
        displayName: parsed.displayName ?? null,
        externalId: parsed.externalId ?? null,
      });
      return json(200, memberToScimUser(saved ?? member, baseUrl));
    }

    if (method === "DELETE") {
      await store.remove(id);
      return json(204, null);
    }

    return json(405, scimError(405, `Method ${method} not allowed on /Users/:id.`));
  } catch (e) {
    if (e instanceof ScimParseError) return json(400, scimError(400, e.message));
    return json(500, scimError(500, "SCIM request failed."));
  }
}
