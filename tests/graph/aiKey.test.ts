import { describe, it, expect, afterEach } from "vitest";
import { apiKeyStore } from "../../src/graph/apiKeyStore";
import { AI_PROVIDER, AI_ENABLED, aiConnected } from "../../src/graph/aiKey";

// `aiConnected()` is what reveals the command palette's sparkle. 1.3 ships with the
// assistant OFF (`AI_ENABLED = false` — author, 2026-08-30): with the flag down the
// whole surface stays hidden even when a key is stored. When the flag flips back on,
// the pin to restore (git 2026-08 has it): connected is driven by the STORED KEY for
// OUR provider and nothing else — no separate flag that drifts from the key present.

afterEach(() => { apiKeyStore.remove(AI_PROVIDER); });

describe("aiConnected", () => {
  it("stays disconnected while AI_ENABLED is down, key or no key", () => {
    expect(AI_ENABLED).toBe(false);
    expect(aiConnected()).toBe(false);
    apiKeyStore.set(AI_PROVIDER, "sk-test-key");
    expect(aiConnected()).toBe(false);
  });
});
