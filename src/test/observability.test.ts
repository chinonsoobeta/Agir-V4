import { afterEach, describe, expect, test, vi } from "vitest";
import { buildErrorEvent, captureServerError } from "@/lib/observability.server";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ERROR_WEBHOOK_URL;
});

describe("captureServerError", () => {
  test("emits a single structured [agir-error] JSON line to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureServerError(new Error("boom"), { path: "/api/x", kind: "fetch" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line.startsWith("[agir-error] ")).toBe(true);
    const event = JSON.parse(line.replace("[agir-error] ", ""));
    expect(event.level).toBe("error");
    expect(event.service).toBe("agir");
    expect(event.path).toBe("/api/x");
    expect(event.kind).toBe("fetch");
    expect(event.error.message).toBe("boom");
    expect(typeof event.timestamp).toBe("string");
  });

  test("never throws on non-Error / unserializable input", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => captureServerError("a string error")).not.toThrow();
    expect(() => captureServerError(null)).not.toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => captureServerError(circular)).not.toThrow();
  });

  test("does NOT call the webhook when no sink is configured", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    captureServerError(new Error("x"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("POSTs the event to ERROR_WEBHOOK_URL when configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ERROR_WEBHOOK_URL = "https://sink.example/ingest";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    captureServerError(new Error("boom"), { kind: "fetch" });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://sink.example/ingest");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.error.message).toBe("boom");
    expect(body.kind).toBe("fetch");
  });

  test("a webhook failure is swallowed (reporting never throws)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ERROR_WEBHOOK_URL = "https://sink.example/ingest";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect(() => captureServerError(new Error("boom"))).not.toThrow();
  });

  test("buildErrorEvent captures name, message, and stack of an Error", () => {
    const event = buildErrorEvent(new TypeError("bad type"), { deal: "abc" });
    expect(event.error.name).toBe("TypeError");
    expect(event.error.message).toBe("bad type");
    expect(typeof event.error.stack).toBe("string");
    expect((event as Record<string, unknown>).deal).toBe("abc");
  });
});
