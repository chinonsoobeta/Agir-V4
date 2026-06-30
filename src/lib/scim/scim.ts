// SCIM 2.0 provisioning core (RFC 7643/7644). Pure protocol logic with no I/O,
// so it is exhaustively unit-testable: parsing inbound IdP user payloads,
// mapping IdP groups to Agir workspace roles, applying PATCH operations (the
// deactivate/reactivate flow every IdP drives), and shaping SCIM responses.
// The HTTP route (src/routes/api/scim/...) wires this to workspace_members.

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export type ScimEmail = { value: string; primary?: boolean; type?: string };
export type ScimName = { givenName?: string; familyName?: string; formatted?: string };

export type ScimUser = {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active?: boolean;
  groups?: { value: string; display?: string }[];
  meta?: { resourceType: "User"; created?: string; lastModified?: string; location?: string };
};

// A workspace member as this codebase models it (workspace_members + the
// user's email). The SCIM layer only needs this subset.
export type ProvisionedMember = {
  id: string;
  email: string;
  externalId?: string | null;
  role: WorkspaceRole;
  active: boolean;
  displayName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

// Map IdP group names to workspace roles. Group display names are matched
// case-insensitively; the highest-privilege matched role wins. Owners are NEVER
// assignable via SCIM (break-glass safety) -- an "owner" group maps to admin.
export function mapRoleFromGroups(
  groups: { value?: string; display?: string }[] | undefined,
  mapping: Record<string, WorkspaceRole> = DEFAULT_GROUP_MAPPING,
): WorkspaceRole {
  let best: WorkspaceRole = "viewer";
  for (const g of groups ?? []) {
    const keys = [g.display, g.value].filter(Boolean).map((s) => s!.toLowerCase());
    for (const key of keys) {
      const role = mapping[key];
      if (role && role !== "owner" && ROLE_RANK[role] > ROLE_RANK[best]) best = role;
    }
  }
  return best;
}

export const DEFAULT_GROUP_MAPPING: Record<string, WorkspaceRole> = {
  "agir-admins": "admin",
  admin: "admin",
  admins: "admin",
  "agir-members": "member",
  member: "member",
  members: "member",
  "agir-viewers": "viewer",
  viewer: "viewer",
  viewers: "viewer",
};

export type ParsedScimUser = {
  email: string;
  externalId?: string;
  displayName?: string;
  active: boolean;
  role: WorkspaceRole;
};

// Parse an inbound SCIM user into the fields the provisioning store needs.
// Throws a typed message on a malformed payload so the route can 400.
export function parseScimUser(
  body: unknown,
  mapping?: Record<string, WorkspaceRole>,
): ParsedScimUser {
  if (!body || typeof body !== "object")
    throw new ScimParseError("Request body must be a JSON object.");
  const u = body as Partial<ScimUser>;
  const email = primaryEmail(u);
  if (!email) throw new ScimParseError("A userName or primary email is required.");
  return {
    email: email.toLowerCase(),
    externalId: u.externalId,
    displayName: u.displayName ?? u.name?.formatted ?? joinName(u.name),
    active: u.active ?? true,
    role: mapRoleFromGroups(u.groups, mapping),
  };
}

export class ScimParseError extends Error {}

function primaryEmail(u: Partial<ScimUser>): string | undefined {
  const emails = u.emails ?? [];
  const primary = emails.find((e) => e.primary)?.value ?? emails[0]?.value;
  // userName is canonically an email/UPN in enterprise IdPs.
  const candidate = primary ?? u.userName;
  return candidate && candidate.includes("@") ? candidate : (u.userName ?? primary);
}

function joinName(name?: ScimName): string | undefined {
  if (!name) return undefined;
  const parts = [name.givenName, name.familyName].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

// Render a stored member as a SCIM User resource.
export function memberToScimUser(m: ProvisionedMember, baseUrl?: string): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: m.id,
    externalId: m.externalId ?? undefined,
    userName: m.email,
    displayName: m.displayName ?? undefined,
    emails: [{ value: m.email, primary: true, type: "work" }],
    active: m.active,
    groups: [{ value: m.role, display: m.role }],
    meta: {
      resourceType: "User",
      created: m.createdAt ?? undefined,
      lastModified: m.updatedAt ?? undefined,
      location: baseUrl ? `${baseUrl.replace(/\/$/, "")}/Users/${m.id}` : undefined,
    },
  };
}

export type ScimPatchOp = { op: string; path?: string; value?: unknown };

// Apply a SCIM PATCH (RFC 7644 §3.5.2) to a member. Supports the operations
// IdPs actually send: deactivation (`active=false`), reactivation, and role
// changes via a groups replace. Returns a NEW member; never mutates input.
export function applyScimPatch(member: ProvisionedMember, body: unknown): ProvisionedMember {
  const ops = patchOperations(body);
  let next: ProvisionedMember = { ...member };
  for (const op of ops) {
    const verb = op.op.toLowerCase();
    if (verb !== "replace" && verb !== "add") continue;
    const path = (op.path ?? "").toLowerCase();
    if (path === "active") {
      next = { ...next, active: toBool(op.value) };
    } else if (path === "" && op.value && typeof op.value === "object") {
      // Pathless replace: a map of attributes.
      const v = op.value as Record<string, unknown>;
      if ("active" in v) next = { ...next, active: toBool(v.active) };
      if (Array.isArray(v.groups)) {
        next = { ...next, role: mapRoleFromGroups(v.groups as { value?: string }[]) };
      }
    } else if (path === "groups" && Array.isArray(op.value)) {
      next = { ...next, role: mapRoleFromGroups(op.value as { value?: string }[]) };
    }
  }
  return next;
}

function patchOperations(body: unknown): ScimPatchOp[] {
  if (!body || typeof body !== "object") return [];
  const ops = (body as { Operations?: unknown }).Operations;
  if (!Array.isArray(ops)) return [];
  return ops.filter((o): o is ScimPatchOp => !!o && typeof o === "object" && "op" in o);
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return Boolean(v);
}

export function scimListResponse(members: ProvisionedMember[], baseUrl?: string, startIndex = 1) {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: members.length,
    startIndex,
    itemsPerPage: members.length,
    Resources: members.map((m) => memberToScimUser(m, baseUrl)),
  };
}

export function scimError(status: number, detail: string) {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail };
}

// Parse the SCIM `filter` query (only the common `userName eq "x"` form IdPs
// use for de-duplication is supported; anything else returns null = unfiltered).
export function parseUserNameFilter(filter: string | null | undefined): string | null {
  if (!filter) return null;
  const m = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
  return m ? m[1].toLowerCase() : null;
}
