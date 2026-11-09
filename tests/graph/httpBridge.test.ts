// [[C23]] calcModes, [[B18]] safeToShare, [[live-connections#HTTP]]
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchText, fetchJson, CorsLikelyError, MAX_FETCH_BYTES } from "../../src/graph/httpBridge";
import { docMetaStore } from "../../src/graph/docMetaStore";

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

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("httpBridge (desktop branch)", () => {
  const w = globalThis as unknown as { window?: Record<string, unknown> };
  let hadWindow = false;
  beforeEach(() => {
    hadWindow = w.window !== undefined;
    w.window = { ...(w.window ?? {}), __TAURI_INTERNALS__: {} };
    docMetaStore.setDocMeta(null);
    invoke.mockReset();
  });
  afterEach(() => {
    if (hadWindow) delete w.window!.__TAURI_INTERNALS__; else delete w.window;
    docMetaStore.setDocMeta(null);
  });

  it("the user's own document may reach the local network; a foreign one may not", async () => {
    invoke.mockResolvedValue({ status: 200, status_text: "OK", headers: [["content-type", "text/csv"]], body: "a\n1" });
    const r = await fetchText("http://localhost:8080/api/tasks", { headers: { Authorization: "Bearer x" } });
    expect(r).toEqual({ text: "a\n1", contentType: "text/csv" });
    expect(invoke.mock.calls[0][1].req).toMatchObject({ url: "http://localhost:8080/api/tasks", local: true });
    expect(invoke.mock.calls[0][1].req.headers).toContainEqual(["Authorization", "Bearer x"]);
    docMetaStore.markForeign();
    await fetchText("https://example.com/data.csv");
    expect(invoke.mock.calls[1][1].req.local).toBe(false);
  });

  it("the shell's refusal reads as what it is", async () => {
    docMetaStore.markForeign();
    invoke.mockRejectedValue("local-network-refused: 127.0.0.1");
    await expect(fetchText("http://127.0.0.1/")).rejects.toThrow(/someone else wrote doesn't fetch from this computer/);
  });

  it("a non-OK reply keeps its status, and a 204 reads as empty", async () => {
    invoke.mockResolvedValue({ status: 404, status_text: "Not Found", headers: [], body: "" });
    await expect(fetchText("https://example.com/missing")).rejects.toThrow("HTTP 404 Not Found");
    invoke.mockResolvedValue({ status: 204, status_text: "No Content", headers: [], body: "" });
    await expect(fetchJson("https://example.com/x", { method: "PUT", body: { a: 1 } })).resolves.toEqual({ text: "", contentType: "" });
    expect(invoke.mock.calls[1][1].req).toMatchObject({ method: "PUT", body: '{"a":1}' });
  });
});
