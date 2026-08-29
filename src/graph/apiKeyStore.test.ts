import { describe, it, expect } from "vitest";
import { apiKeyStore } from "./apiKeyStore";

// The node test env has no localStorage; the store degrades to in-memory (its guards
// swallow the ReferenceError), so these exercise the pure key-map logic.
describe("apiKeyStore", () => {
  // The plain set/get/has/remove round-trip is exercised for real by aiService.test.ts,
  // aiKey.test.ts and nodes/dataFeed.test.ts; only the normalization and observer
  // contracts are pinned here.
  it("trims whitespace and treats a blank value as a clear", () => {
    apiKeyStore.set("prov", "  keyed  ");
    expect(apiKeyStore.get("prov")).toBe("keyed");
    apiKeyStore.set("prov", "   ");
    expect(apiKeyStore.has("prov")).toBe(false);
  });

  it("notifies subscribers on a change and bumps the version", () => {
    const before = apiKeyStore.version();
    let fired = 0;
    const unsub = apiKeyStore.subscribe(() => { fired++; });
    apiKeyStore.set("notify-test", "v");
    expect(fired).toBe(1);
    expect(apiKeyStore.version()).toBeGreaterThan(before);
    unsub();
    apiKeyStore.remove("notify-test");
    expect(fired).toBe(1); // no more callbacks after unsubscribe
  });
});
