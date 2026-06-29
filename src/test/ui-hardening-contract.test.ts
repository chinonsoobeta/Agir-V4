import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CONNECTOR_REGISTRY } from "@/lib/integrations/connector";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("UI hardening contract", () => {
  test("auth form forces visible black input text", () => {
    const source = read("src/routes/auth.tsx");

    expect(source).toContain("const authInputClass");
    expect(source).toContain("text-black");
    expect(source).toContain("caret-black");
  });

  test("integration catalog providers have explicit registry entries and setup flow", () => {
    const source = read("src/routes/_authenticated/integrations.tsx");
    const providers = ["salesforce", "dealcloud", "snowflake", "microsoft-365"];

    for (const provider of providers) {
      expect(CONNECTOR_REGISTRY.find((item) => item.provider === provider)?.status).toBe("planned");
      expect(source).toContain(`case "${provider}"`);
    }
    expect(source).toContain("Mark setup requested");
    expect(source).toContain("Setup pending");
  });

  test("authenticated menu routes have a crash fallback and memo snapshots are migration-safe", () => {
    const route = read("src/routes/_authenticated/route.tsx");
    const snapshots = read("src/lib/memo-snapshot.functions.ts");

    expect(route).toContain("errorComponent");
    expect(route).toContain("This section did not load");
    expect(snapshots).toContain("isMissingRelation(error)) return []");
    expect(snapshots).toContain("Memo snapshots need the latest database migration.");
  });

  test("CI enforces the pilot readiness audit", () => {
    const ci = read(".github/workflows/ci.yml");

    expect(ci).toContain("npm run pilot:audit");
  });

  test("branding and dashboard navigation use the approved product language", () => {
    const shell = read("src/components/app-shell.tsx");
    const auth = read("src/routes/auth.tsx");
    const dashboard = read("src/routes/_authenticated/dashboard.tsx");
    const landing = read("src/routes/index.tsx");
    const i18n = read("src/lib/i18n.ts");

    expect(i18n).toContain('"nav.home": "Dashboard"');
    expect(i18n).toContain('"shell.workspace": "Investment workspace"');
    expect(i18n).toContain('"nav.home": "Tableau de bord"');
    expect(i18n).toContain('"shell.workspace": "Espace d’investissement"');
    expect(dashboard).toContain("Dashboard | Agir");
    expect(dashboard).not.toContain('eyebrow={t("dash.eyebrow")}');
    for (const source of [shell, auth, landing, dashboard, i18n]) {
      expect(source).not.toContain("Command center");
      expect(source).not.toContain("Investment OS");
      expect(source).not.toContain("Investment overview");
    }
    for (const source of [shell, auth, landing]) {
      expect(source).toContain("Building2");
      expect(source).not.toMatch(/>\s*A\s*</);
    }
  });
});
