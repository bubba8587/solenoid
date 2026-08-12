import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchText, CorsLikelyError, MAX_FETCH_BYTES } from "./httpBridge";

// First direct coverage for the CORS-bypass seam (v1.0 audit, quality). These
// run in the BROWSER-shaped branch (no __TAURI_INTERNALS__ in the vitest env),
// which is the half with the subtle behavior: CORS classification.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockResponse(body: string, init?: { ok?: boolean; status?: number; statusText?: string; contentType?: string; contentLength?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase();
        if (key === "content-type") return init?.contentType ?? "text/plain";
        if (key === "content-length") return init?.contentLength != null ? String(init.contentLength) : null;
        return null;
      },
    },
    text: async () => body,
  } as unknown as Response;
}

describe("httpBridge (browser branch)", () => {
  it("returns text + content type on success", async () => {
    globalThis.fetch = vi.fn(async () => mockResponse("hello", { contentType: "text/csv" }));
    const r = await fetchText("https://example.com/data.csv");
    expect(r.text).toBe("hello");
    expect(r.contentType).toBe("text/csv");
  });

  it("a network-level TypeError classifies as a CORS-likely error", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(fetchText("https://example.com")).rejects.toBeInstanceOf(CorsLikelyError);
  });

  it("a real HTTP error keeps its status (NOT masked as CORS)", async () => {
    globalThis.fetch = vi.fn(async () => mockResponse("", { ok: false, status: 404, statusText: "Not Found" }));
    await expect(fetchText("https://example.com/missing")).rejects.toThrow("HTTP 404 Not Found");
  });

  it("a non-TypeError failure passes through untouched", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("aborted"); });
    await expect(fetchText("https://example.com")).rejects.toThrow("aborted");
  });

  it("rejects a body whose Content-Length is over the cap (before reading it)", async () => {
    const text = vi.fn(async () => "should never be read");
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? String(MAX_FETCH_BYTES + 1) : null) },
      text,
    } as unknown as Response));
    await expect(fetchText("https://example.com/huge.csv")).rejects.toThrow(/too large/i);
    expect(text).not.toHaveBeenCalled(); // rejected on the header, never buffered
  });

  it("a body under the cap is returned normally", async () => {
    globalThis.fetch = vi.fn(async () => mockResponse("a,b\n1,2", { contentType: "text/csv", contentLength: 7 }));
    const r = await fetchText("https://example.com/small.csv");
    expect(r.text).toBe("a,b\n1,2");
  });

  it("relative URLs (bundled seed assets) use the plain fetch path", async () => {
    const spy = vi.fn(async () => mockResponse("a,b\n1,2"));
    globalThis.fetch = spy;
    await fetchText("/data/foo.csv");
    expect(spy).toHaveBeenCalledWith("/data/foo.csv");
  });
});
