import { describe, it, expect, afterEach } from "vitest";
import { apiKeyStore } from "./apiKeyStore";
import { AI_PROVIDER, aiConnected } from "./aiKey";

// `aiConnected()` is what reveals the command palette's sparkle, so the thing worth
// pinning is that it is driven by the STORED KEY for OUR provider and nothing else —
// no separate "connected" flag that could drift out of sync with the key present.

afterEach(() => { apiKeyStore.remove(AI_PROVIDER); });

describe("aiConnected", () => {
  it("tracks the stored key for AI_PROVIDER only", () => {
    expect(aiConnected()).toBe(false);
    apiKeyStore.set("fred", "some-other-key"); // another provider's key is not ours
    expect(aiConnected()).toBe(false);
    apiKeyStore.remove("fred");
    apiKeyStore.set(AI_PROVIDER, "sk-test-key");
    expect(aiConnected()).toBe(true);
    apiKeyStore.remove(AI_PROVIDER);
    expect(aiConnected()).toBe(false);
    apiKeyStore.set(AI_PROVIDER, "   "); // blank is a clear, not a connection
    expect(aiConnected()).toBe(false);
  });
});
