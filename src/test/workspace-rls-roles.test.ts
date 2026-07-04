// Role-matrix coverage for the workspace write-hardening policies
// (20260626000100 + 20260626000200). The SQL policies are the real enforcement;
// these tests pin the ACCESS RULE (read for all members, write for non-viewers,
// project delete + member management for owner/admin, owner-only ownership) so a
// regression that re-opens viewer writes (the bug this hardening closed) fails CI
// without needing a live Postgres. Mirrors src/lib/workspace-access.ts.

import { describe, expect, test } from "vitest";
import {
  canReadDealChild,
  canWriteDealChild,
  canManageProject,
  canCastIcVote,
  canWriteIcCondition,
  canManageMember,
  canRunUnderwriting,
  canGenerateMemo,
  canRecordDecision,
  canExportAuditPackage,
  canManageWorkspace,
  FIRM_ROLE_WORKSPACE_ROLE,
  type RoleViewer,
  type ParentProject,
  type WorkspaceRole,
} from "@/lib/workspace-access";
import { computeReadiness, type ProjectInputRows } from "@/lib/engine";
import { validatePersistedAssumptionUnits } from "@/lib/unit-contracts";

const WS = "ws-A";
const project: ParentProject = { owner_id: "creator", workspace_id: WS };
const viewerWith = (role: WorkspaceRole): RoleViewer => ({
  userId: `u-${role}`,
  roles: { [WS]: role },
});

const owner = viewerWith("owner");
const admin = viewerWith("admin");
const member = viewerWith("member");
const viewer = viewerWith("viewer");
const outsider: RoleViewer = { userId: "u-out", roles: { "ws-B": "owner" } };

describe("workspace role matrix: deal-child rows", () => {
  test("every member role (including viewer) can READ a shared deal-child row", () => {
    for (const v of [owner, admin, member, viewer]) {
      expect(canReadDealChild(project, v)).toBe(true);
    }
    expect(canReadDealChild(project, outsider)).toBe(false); // cross-tenant isolation
  });

  test("owner/admin/member can WRITE a deal-child row; a VIEWER cannot", () => {
    expect(canWriteDealChild(project, owner)).toBe(true);
    expect(canWriteDealChild(project, admin)).toBe(true);
    expect(canWriteDealChild(project, member)).toBe(true);
    expect(canWriteDealChild(project, viewer)).toBe(false); // the bug this closes
    expect(canWriteDealChild(project, outsider)).toBe(false);
  });

  test("only owner/admin can manage (update/delete) the project; member & viewer cannot", () => {
    expect(canManageProject(project, owner)).toBe(true);
    expect(canManageProject(project, admin)).toBe(true);
    expect(canManageProject(project, member)).toBe(false);
    expect(canManageProject(project, viewer)).toBe(false);
  });

  test("a personal (workspace-less) project is writable/manageable only by its owner", () => {
    const personal: ParentProject = { owner_id: "u-member", workspace_id: null };
    expect(canWriteDealChild(personal, member)).toBe(true); // u-member owns it
    expect(canManageProject(personal, member)).toBe(true);
    expect(canWriteDealChild(personal, owner)).toBe(false); // different user, no workspace
  });

  test("institutional role helpers map to existing workspace enforcement", () => {
    expect(FIRM_ROLE_WORKSPACE_ROLE).toEqual({
      analyst: "member",
      associate: "member",
      vp: "admin",
      ic_member: "member",
      admin: "admin",
      auditor: "viewer",
    });
    expect(canRunUnderwriting(project, member)).toBe(true);
    expect(canGenerateMemo(project, member)).toBe(true);
    expect(canRecordDecision(project, member)).toBe(true);
    expect(canExportAuditPackage(project, viewer)).toBe(true);
    expect(canRunUnderwriting(project, viewer)).toBe(false);
    expect(canGenerateMemo(project, viewer)).toBe(false);
    expect(canRecordDecision(project, viewer)).toBe(false);
    expect(canManageWorkspace(project, admin)).toBe(true);
    expect(canManageWorkspace(project, member)).toBe(false);
  });
});

describe("workspace role matrix: IC governance (the tables 20260626000100 missed)", () => {
  test("a VIEWER cannot cast an IC vote or write an IC condition", () => {
    expect(canCastIcVote(project, viewer.userId, viewer)).toBe(false);
    expect(canWriteIcCondition(project, viewer)).toBe(false);
  });

  test("a member/admin/owner can write an IC condition", () => {
    expect(canWriteIcCondition(project, member)).toBe(true);
    expect(canWriteIcCondition(project, admin)).toBe(true);
    expect(canWriteIcCondition(project, owner)).toBe(true);
  });

  test("a member may cast only their OWN vote, never another member's", () => {
    expect(canCastIcVote(project, member.userId, member)).toBe(true);
    expect(canCastIcVote(project, "someone-else", member)).toBe(false);
  });
});

describe("workspace member management: owner protection", () => {
  test("an admin can manage non-owner members but NOT demote/remove an owner", () => {
    expect(canManageMember("admin", "member")).toBe(true);
    expect(canManageMember("admin", "viewer")).toBe(true);
    expect(canManageMember("admin", "owner")).toBe(false); // cannot act on an owner
    expect(canManageMember("admin", "member", "owner")).toBe(false); // cannot grant ownership
  });

  test("an owner can manage owners and grant ownership", () => {
    expect(canManageMember("owner", "owner")).toBe(true);
    expect(canManageMember("owner", "member", "owner")).toBe(true);
  });

  test("a member or viewer can never manage members", () => {
    expect(canManageMember("member", "viewer")).toBe(false);
    expect(canManageMember("viewer", "viewer")).toBe(false);
    expect(canManageMember(null, "member")).toBe(false);
  });
});

describe("workspace + engine readiness integration contract", () => {
  test("only writable members can submit unit-valid approved assumptions for engine readiness", () => {
    const approvedAssumptions = [
      { field_key: "debt_amount", unit: "$" },
      { field_key: "interest_rate", unit: "%" },
      { field_key: "min_all_in_dscr", unit: "x" },
    ];
    expect(validatePersistedAssumptionUnits(approvedAssumptions)).toEqual([]);
    expect(canWriteDealChild(project, member)).toBe(true);
    expect(canWriteDealChild(project, viewer)).toBe(false);

    const rows: ProjectInputRows = {
      scalars: [
        { key: "loan_amount", value_numeric: 60, status: "approved", source: "assumption" },
        { key: "equity_amount", value_numeric: 40, status: "approved", source: "assumption" },
        { key: "interest_rate_pct", value_numeric: 6, status: "approved", source: "assumption" },
        { key: "amort_years", value_numeric: 30, status: "approved", source: "assumption" },
        { key: "exit_cap_rate_pct", value_numeric: 5, status: "approved", source: "assumption" },
        {
          key: "stabilized_occupancy_pct",
          value_numeric: 95,
          status: "approved",
          source: "assumption",
        },
        { key: "expense_ratio_pct", value_numeric: 35, status: "approved", source: "assumption" },
        { key: "hold_years", value_numeric: 5, status: "approved", source: "assumption" },
        { key: "selling_costs_pct", value_numeric: 2, status: "approved", source: "assumption" },
        { key: "rent_growth_pct", value_numeric: 3, status: "approved", source: "assumption" },
        { key: "lease_up_months", value_numeric: 12, status: "approved", source: "assumption" },
      ],
      budget: [
        { category: "land", amount: 10, status: "approved" },
        { category: "hard", amount: 50, status: "approved" },
        { category: "soft", amount: 10, status: "approved" },
        { category: "contingency", amount: 5, status: "approved" },
        { category: "financing_interest", amount: 5, status: "approved" },
      ],
      revenue: [
        {
          unit_type: "Residential",
          unit_count: 10,
          avg_sf: null,
          rent: 2,
          rent_basis: "per_unit",
          occupancy_pct: 95,
          status: "approved",
        },
      ],
    };

    expect(computeReadiness(rows).status).toBe("ready");
    expect(
      validatePersistedAssumptionUnits([{ field_key: "min_all_in_dscr", unit: "%" }])[0].message,
    ).toContain("requires x");
  });
});
