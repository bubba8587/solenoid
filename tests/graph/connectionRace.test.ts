// [[D32]] refreshOutsideRebuild
import { describe, it, expect, vi, afterEach } from "vitest";
import { FxNode, WeatherNode } from "../../src/graph/nodes/connection";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function json(body: unknown): Response {
  return {
    ok: true, status: 200, statusText: "OK",
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Each request waits until the test releases it, so responses can land out of order. */
function heldFetch() {
  const held: { url: string; release: (body: unknown) => void }[] = [];
  globalThis.fetch = vi.fn((url: string | URL) => new Promise<Response>((resolve) => {
    held.push({ url: String(url), release: (body) => resolve(json(body)) });
  })) as unknown as typeof fetch;
  return held;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a connection card answers for its current reference only", () => {
  it("a Currency response that lands after a newer one is dropped", async () => {
    const held = heldFetch();
    const fx = new FxNode();
    fx.stringLiterals.from = "USD";
    fx.stringLiterals.to = "EUR";
    fx.data({});
    fx.stringLiterals.to = "GBP";
    fx.data({});
    expect(held).toHaveLength(2);
    held[1].release({ base: "USD", date: "2026-09-01", rates: { GBP: 0.75 } });
    await settle();
    held[0].release({ base: "USD", date: "2026-09-01", rates: { EUR: 0.9 } });
    await settle();
    expect(fx.data({}).rate).toBe(0.75);
  });

  it("a Weather response for an old place never replaces the new one's", async () => {
    const held = heldFetch();
    const w = new WeatherNode();
    w.data({ lat: [1], lon: [1] });
    w.data({ lat: [2], lon: [2] });
    expect(held).toHaveLength(2);
    const body = (t: number) => ({ current: { temperature_2m: t, weather_code: 0 }, daily: { time: [], weather_code: [] } });
    held[1].release(body(20));
    await settle();
    held[0].release(body(5));
    await settle();
    expect(w.cached?.nowTemp).toBe(20);
  });
});
