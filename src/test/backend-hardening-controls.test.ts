import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BACKEND_HARDENING_CONTROLS } from "@/lib/backend-hardening-controls";
import { validateServerEnv } from "@/lib/env.server";
import { buildHealthChecks } from "@/lib/health.server";

describe("backend hardening controls", () => {
  test("tracks all 17 backend hardening controls with existing artifacts", () => {
    expect(BACKEND_HARDENING_CONTROLS).toHaveLength(17);
    const ids = BACKEND_HARDENING_CONTROLS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of BACKEND_HARDENING_CONTROLS) {
      expect(control.artifacts.length).toBeGreaterThan(0);
      for (const artifact of control.artifacts) {
        expect(existsSync(resolve(process.cwd(), artifact)), `${control.id}: ${artifact}`).toBe(
          true,
        );
      }
    }
  });

  test("registers the backend audit scripts in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["backend:audit"]).toContain("npm run audit:service-role");
    expect(pkg.scripts["types:check"]).toContain("check-generated-types");
    const expectedScripts = {
      "audit:service-role": "audit-service-role-usage",
      "audit:server-auth": "audit-server-function-auth",
      "audit:idempotency": "audit-idempotency",
      "audit:transactions": "audit-transaction-boundaries",
      "audit:events": "audit-event-coverage",
      "audit:indexes": "audit-db-indexes",
      "audit:migrations": "audit-migration-safety",
      "env:validate": "validate-env",
      "load:tenant-scale": "tenant-scale-load",
      "load:tenant-db": "tenant-db-concurrency-smoke",
    };
    for (const [name, command] of Object.entries(expectedScripts)) {
      expect(pkg.scripts[name], name).toBeTruthy();
      expect(pkg.scripts[name]).toContain(command);
    }
  });

  test("validates production env as a stricter contract than development", () => {
    const dev = validateServerEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
    } as NodeJS.ProcessEnv);
    expect(dev.ok).toBe(true);

    const prod = validateServerEnv(
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        DATABASE_URL: "postgres://example",
        METRICS_WEBHOOK_URL: "https://metrics.example/ingest",
        DOCUMENT_SCAN_URL: "https://scanner.example/scan",
        EXTRACTION_WORKER_TOKEN: "worker-token",
      } as NodeJS.ProcessEnv,
      "production",
    );
    expect(prod.ok).toBe(true);

    const missingProd = validateServerEnv(
      { SUPABASE_URL: "https://example.supabase.co" } as NodeJS.ProcessEnv,
      "production",
    );
    expect(missingProd.ok).toBe(false);
    expect(missingProd.missing.join(" ")).toContain("Supabase anon key");
  });

  test("health checks expose optional backend readiness without failing critical health", () => {
    const checks = buildHealthChecks({ status: "unknown", configured: false }, {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
    } as NodeJS.ProcessEnv);
    expect(checks.supabaseUrl).toBe(true);
    expect(checks.supabaseAnonKey).toBe(true);
    expect(checks.schemaDrift).toBe(true);
    expect(checks.databaseUrlConfigured).toBe(false);
    expect(checks.metricsSinkConfigured).toBe(false);
    expect(checks.envValid).toBe(true);
  });
});
