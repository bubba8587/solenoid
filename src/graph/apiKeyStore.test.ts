import { describe, it, expect } from "vitest";
import { apiKeyStore } from "./apiKeyStore";

// The node test env has no localStorage; the store degrades to in-memory (its guards
// swallow the ReferenceError), so these exercise the pure key-map logic.
describe("apiKeyStore", () => {
  it("set / get / has / remove round-trips per provider", () => {
    apiKeyStore.set("fred", "abc123");
    expect(apiKeyStore.get("fred")).toBe("abc123");
    expect(apiKeyStore.has("fred")).toBe(true);

    apiKeyStore.set("alphavantage", "XYZ");
    expect(apiKeyStore.providers().sort()).toEqual(["alphavantage", "fred"]);

    apiKeyStore.remove("fred");
    expect(apiKeyStore.has("fred")).toBe(false);
    expect(apiKeyStore.get("fred")).toBe("");
    expect(apiKeyStore.has("alphavantage")).toBe(true);
  });

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
