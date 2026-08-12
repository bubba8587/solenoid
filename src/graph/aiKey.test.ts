import { describe, it, expect, afterEach } from "vitest";
import { apiKeyStore } from "./apiKeyStore";
import { AI_PROVIDER, aiConnected } from "./aiKey";

// `aiConnected()` is what reveals the command palette's sparkle, so the thing worth
// pinning is that it is driven by a STORED KEY and nothing else — no separate
// "connected" flag that could drift out of sync with the key actually present.

afterEach(() => { apiKeyStore.remove(AI_PROVIDER); });

describe("aiConnected", () => {
  it("is false with no key stored", () => {
    expect(aiConnected()).toBe(false);
  });

  it("is true once a key is stored, false again once cleared", () => {
    apiKeyStore.set(AI_PROVIDER, "sk-test-key");
    expect(aiConnected()).toBe(true);
    apiKeyStore.remove(AI_PROVIDER);
    expect(aiConnected()).toBe(false);
  });

  it("treats a blank / whitespace-only key as not connected", () => {
    apiKeyStore.set(AI_PROVIDER, "   ");
    expect(aiConnected()).toBe(false);
  });

  it("is not confused by another provider's key", () => {
    apiKeyStore.set("fred", "some-other-key");
    expect(aiConnected()).toBe(false);
    apiKeyStore.remove("fred");
  });
});
