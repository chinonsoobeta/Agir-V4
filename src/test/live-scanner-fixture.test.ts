import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { scanDocument } from "@/lib/upload-guards.server";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]).buffer;
let server: Server;
let url = "";
let response: "clean" | "infected" | "malformed" | "timeout" = "clean";
const original = {
  url: process.env.DOCUMENT_SCAN_URL,
  timeout: process.env.DOCUMENT_SCAN_TIMEOUT_MS,
  environment: process.env.AGIR_ENV,
};

beforeAll(async () => {
  server = createServer((_request, res) => {
    if (response === "timeout") {
      setTimeout(() => res.end('{"clean":true}'), 100).unref();
      return;
    }
    if (response === "infected") {
      res.end('{"clean":false,"detail":"fixture-infected"}');
      return;
    }
    if (response === "malformed") {
      res.end("fixture completed without verdict");
      return;
    }
    res.end('{"clean":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Scanner fixture did not bind TCP.");
  url = `http://127.0.0.1:${address.port}/scan`;
});

afterEach(() => {
  process.env.DOCUMENT_SCAN_URL = original.url;
  process.env.DOCUMENT_SCAN_TIMEOUT_MS = original.timeout;
  process.env.AGIR_ENV = original.environment;
});

afterAll(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("live scanner fixture", () => {
  it("accepts a clean explicit verdict", async () => {
    response = "clean";
    process.env.DOCUMENT_SCAN_URL = url;
    await expect(scanDocument("fixture.pdf", PDF_HEADER)).resolves.toMatchObject({
      ok: true,
      engine: "external",
    });
  });

  it("rejects an infected scanner verdict", async () => {
    response = "infected";
    process.env.DOCUMENT_SCAN_URL = url;
    await expect(scanDocument("fixture.pdf", PDF_HEADER)).resolves.toMatchObject({
      ok: false,
      engine: "external",
    });
  });

  it("rejects a malformed scanner response", async () => {
    response = "malformed";
    process.env.DOCUMENT_SCAN_URL = url;
    await expect(scanDocument("fixture.pdf", PDF_HEADER)).resolves.toMatchObject({
      ok: false,
      engine: "external",
    });
  });

  it("rejects a scanner timeout", async () => {
    response = "timeout";
    process.env.DOCUMENT_SCAN_URL = url;
    process.env.DOCUMENT_SCAN_TIMEOUT_MS = "25";
    await expect(scanDocument("fixture.pdf", PDF_HEADER)).resolves.toMatchObject({
      ok: false,
      engine: "external",
    });
  });
});
