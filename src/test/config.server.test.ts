import { describe, expect, it } from "vitest";
import {
  getRedactedConfigDiagnostics,
  getServerConfig,
  readServerConfig,
} from "@/lib/config.server";

const productionBase = {
  AGIR_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  DATABASE_URL: "postgres://secret@db/agir",
  DOCUMENT_SCAN_URL: "https://scanner.internal/scan",
  EXTRACTION_WORKER_TOKEN: "worker-secret",
  ERROR_WEBHOOK_URL: "https://observe.internal/events",
} as NodeJS.ProcessEnv;

describe("server configuration boundary", () => {
  it("forces asynchronous extraction and rejects a production scanner bypass", () => {
    const config = readServerConfig({ ...productionBase, EXTRACTION_ASYNC: "0" });
    expect(config.asyncExtraction).toBe(true);
    expect(config.scannerFailOpen).toBe(false);
  });

  it("scopes production service requirements to the operation that uses them", () => {
    const env = { ...productionBase };
    delete env.DOCUMENT_SCAN_URL;
    delete env.EXTRACTION_WORKER_TOKEN;
    delete env.ERROR_WEBHOOK_URL;
    expect(() => getServerConfig(["supabase"], env)).not.toThrow();
    expect(() => getServerConfig(["scanner"], env)).toThrow(/DOCUMENT_SCAN_URL/);
    expect(() => getServerConfig(["worker"], env)).toThrow(/EXTRACTION_WORKER_TOKEN/);
    expect(() => getServerConfig(["observability"], env)).toThrow(/ERROR_WEBHOOK_URL/);
  });

  it("allows test-only scanner fail-open and redacts values from diagnostics", () => {
    const config = readServerConfig({ AGIR_ENV: "test", DOCUMENT_SCAN_FAIL_OPEN: "1" });
    expect(config.scannerFailOpen).toBe(true);
    const diagnostics = JSON.stringify(getRedactedConfigDiagnostics(productionBase));
    expect(diagnostics).not.toContain("service-secret");
    expect(diagnostics).not.toContain("worker-secret");
    expect(diagnostics).not.toContain("postgres://");
  });
});
