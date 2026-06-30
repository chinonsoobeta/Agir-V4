import { describe, expect, it } from "vitest";
import {
  parseScimUser,
  ScimParseError,
  mapRoleFromGroups,
  applyScimPatch,
  memberToScimUser,
  scimListResponse,
  parseUserNameFilter,
  type ProvisionedMember,
} from "@/lib/scim/scim";

const member: ProvisionedMember = {
  id: "m-1",
  email: "jane@acme.com",
  externalId: "ext-9",
  role: "member",
  active: true,
  displayName: "Jane Doe",
};

describe("SCIM user parsing", () => {
  it("extracts email, externalId, active and role from an IdP payload", () => {
    const parsed = parseScimUser({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "jane@acme.com",
      externalId: "ext-9",
      name: { givenName: "Jane", familyName: "Doe" },
      emails: [{ value: "jane@acme.com", primary: true }],
      groups: [{ display: "agir-admins" }],
      active: true,
    });
    expect(parsed.email).toBe("jane@acme.com");
    expect(parsed.externalId).toBe("ext-9");
    expect(parsed.role).toBe("admin");
    expect(parsed.displayName).toBe("Jane Doe");
    expect(parsed.active).toBe(true);
  });

  it("defaults active to true and role to viewer when unspecified", () => {
    const parsed = parseScimUser({ userName: "bob@acme.com" });
    expect(parsed.active).toBe(true);
    expect(parsed.role).toBe("viewer");
  });

  it("rejects a payload with no resolvable email", () => {
    expect(() => parseScimUser({ name: { givenName: "x" } })).toThrow(ScimParseError);
    expect(() => parseScimUser("nope")).toThrow(ScimParseError);
  });
});

describe("role mapping", () => {
  it("picks the highest-privilege matched role", () => {
    expect(mapRoleFromGroups([{ display: "viewers" }, { display: "agir-admins" }])).toBe("admin");
    expect(mapRoleFromGroups([{ display: "members" }])).toBe("member");
    expect(mapRoleFromGroups([])).toBe("viewer");
  });

  it("never grants owner via SCIM (break-glass safety)", () => {
    expect(mapRoleFromGroups([{ display: "owner" }], { owner: "owner", admin: "admin" })).toBe(
      "viewer",
    );
  });
});

describe("SCIM PATCH", () => {
  it("deactivates via the active=false op IdPs send and never mutates input", () => {
    const patched = applyScimPatch(member, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(patched.active).toBe(false);
    expect(member.active).toBe(true); // input untouched
  });

  it("handles a pathless replace map (Azure-style) for active and groups", () => {
    const patched = applyScimPatch(member, {
      Operations: [{ op: "Replace", value: { active: false, groups: [{ value: "agir-admins" }] } }],
    });
    expect(patched.active).toBe(false);
    expect(patched.role).toBe("admin");
  });

  it("ignores unsupported ops without throwing", () => {
    const patched = applyScimPatch(member, { Operations: [{ op: "remove", path: "nickName" }] });
    expect(patched).toEqual(member);
  });
});

describe("SCIM responses", () => {
  it("renders a member as a SCIM User resource with a location", () => {
    const u = memberToScimUser(member, "https://app/api/scim/v2");
    expect(u.userName).toBe("jane@acme.com");
    expect(u.active).toBe(true);
    expect(u.emails?.[0]?.value).toBe("jane@acme.com");
    expect(u.meta?.location).toBe("https://app/api/scim/v2/Users/m-1");
  });

  it("builds a ListResponse envelope", () => {
    const list = scimListResponse([member]);
    expect(list.schemas[0]).toContain("ListResponse");
    expect(list.totalResults).toBe(1);
    expect(list.Resources).toHaveLength(1);
  });

  it("parses the userName eq filter IdPs use for de-duplication", () => {
    expect(parseUserNameFilter('userName eq "Jane@Acme.com"')).toBe("jane@acme.com");
    expect(parseUserNameFilter('displayName co "x"')).toBeNull();
    expect(parseUserNameFilter(null)).toBeNull();
  });
});
