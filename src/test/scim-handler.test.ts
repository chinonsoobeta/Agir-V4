import { describe, expect, it } from "vitest";
import { handleScim, type ScimStore } from "@/lib/scim/handler";
import type { ProvisionedMember, ParsedScimUser } from "@/lib/scim/scim";

// In-memory store so the whole handler (auth, routing, CRUD) is testable
// without the framework or a database.
function memoryStore(): ScimStore & { rows: Map<string, ProvisionedMember> } {
  const rows = new Map<string, ProvisionedMember>();
  let seq = 1;
  return {
    rows,
    async findByEmail(email) {
      return [...rows.values()].find((m) => m.email === email.toLowerCase()) ?? null;
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(parsed: ParsedScimUser) {
      const m: ProvisionedMember = {
        id: `m-${seq++}`,
        email: parsed.email,
        externalId: parsed.externalId ?? null,
        role: parsed.role,
        active: parsed.active,
        displayName: parsed.displayName ?? null,
      };
      rows.set(m.id, m);
      return m;
    },
    async update(id, patch) {
      const cur = rows.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return next;
    },
    async remove(id) {
      return rows.delete(id);
    },
  };
}

const TOKEN = "secret-provisioning-token";
const auth = (store: ScimStore) => ({ store, expectedToken: TOKEN });
const bearer = `Bearer ${TOKEN}`;

describe("SCIM handler auth", () => {
  it("401s without a valid bearer token", async () => {
    const store = memoryStore();
    const res = await handleScim(
      { method: "GET", segments: ["Users"], bearer: "Bearer wrong" },
      auth(store),
    );
    expect(res.status).toBe(401);
    const noToken = await handleScim({ method: "GET", segments: ["Users"] }, auth(store));
    expect(noToken.status).toBe(401);
  });

  it("401s when no token is configured on the server", async () => {
    const store = memoryStore();
    const res = await handleScim(
      { method: "GET", segments: ["Users"], bearer },
      { store, expectedToken: undefined },
    );
    expect(res.status).toBe(401);
  });
});

describe("SCIM handler provisioning lifecycle", () => {
  it("creates, de-duplicates, filters, gets, deactivates, and deletes a user", async () => {
    const store = memoryStore();

    // CREATE
    const created = await handleScim(
      {
        method: "POST",
        segments: ["Users"],
        bearer,
        body: {
          userName: "jane@acme.com",
          emails: [{ value: "jane@acme.com", primary: true }],
          groups: [{ display: "agir-admins" }],
          active: true,
        },
      },
      auth(store),
    );
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect((created.body as { active: boolean }).active).toBe(true);

    // DUPLICATE CREATE -> 409
    const dup = await handleScim(
      { method: "POST", segments: ["Users"], bearer, body: { userName: "jane@acme.com" } },
      auth(store),
    );
    expect(dup.status).toBe(409);

    // FILTER (Okta de-dup probe)
    const filtered = await handleScim(
      {
        method: "GET",
        segments: ["Users"],
        bearer,
        query: { filter: 'userName eq "jane@acme.com"' },
      },
      auth(store),
    );
    expect((filtered.body as { totalResults: number }).totalResults).toBe(1);

    // GET by id
    const got = await handleScim({ method: "GET", segments: ["Users", id], bearer }, auth(store));
    expect(got.status).toBe(200);

    // PATCH deactivate
    const patched = await handleScim(
      {
        method: "PATCH",
        segments: ["Users", id],
        bearer,
        body: { Operations: [{ op: "replace", path: "active", value: false }] },
      },
      auth(store),
    );
    expect((patched.body as { active: boolean }).active).toBe(false);

    // DELETE
    const deleted = await handleScim(
      { method: "DELETE", segments: ["Users", id], bearer },
      auth(store),
    );
    expect(deleted.status).toBe(204);
    const after = await handleScim({ method: "GET", segments: ["Users", id], bearer }, auth(store));
    expect(after.status).toBe(404);
  });

  it("400s a malformed create and 405s an unsupported method", async () => {
    const store = memoryStore();
    const bad = await handleScim(
      { method: "POST", segments: ["Users"], bearer, body: { name: { givenName: "x" } } },
      auth(store),
    );
    expect(bad.status).toBe(400);
    const wrongMethod = await handleScim(
      { method: "DELETE", segments: ["Users"], bearer },
      auth(store),
    );
    expect(wrongMethod.status).toBe(405);
  });
});
