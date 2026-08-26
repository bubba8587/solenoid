import { describe, it, expect, afterEach } from "vitest";
import { zoomSettleMs, DEFAULT_ZOOM_SETTLE_MS } from "./zoomSettle";

// The console override is the whole point of the module (A/B a deployed preview with
// no redeploy), so the guard around it is what's worth pinning: a garbage value must
// fall back to the default rather than set a nonsense timer.

const g = globalThis as { __zoomSettle?: unknown };

afterEach(() => { delete g.__zoomSettle; });

describe("zoomSettleMs", () => {
  it("returns the default when nothing is set", () => {
    expect(zoomSettleMs()).toBe(DEFAULT_ZOOM_SETTLE_MS);
  });

  it("honours a finite non-negative override", () => {
    g.__zoomSettle = 420;
    expect(zoomSettleMs()).toBe(420);
    g.__zoomSettle = 0;
    expect(zoomSettleMs()).toBe(0);
  });

  it("falls back to the default for junk values", () => {
    for (const junk of ["420", -1, NaN, Infinity, null, {}, true]) {
      g.__zoomSettle = junk;
      expect(zoomSettleMs(), `${String(junk)} should not be accepted`).toBe(DEFAULT_ZOOM_SETTLE_MS);
    }
  });

  it("is read per call, so an override applies to the next gesture", () => {
    expect(zoomSettleMs()).toBe(DEFAULT_ZOOM_SETTLE_MS);
    g.__zoomSettle = 900;
    expect(zoomSettleMs()).toBe(900);
  });
});
