// [[A1]] visualGraphCalculator, [[command-palette#AI mode]]
import { describe, it, expect, afterEach } from "vitest";
import { apiKeyStore } from "../../src/graph/apiKeyStore";
import { AI_PROVIDER, aiConnected } from "../../src/graph/aiKey";

afterEach(() => { apiKeyStore.remove(AI_PROVIDER); });

describe("aiConnected", () => {
  it("stays disconnected while AI_ENABLED is down, key or no key", () => {
    expect(aiConnected()).toBe(false);
    apiKeyStore.set(AI_PROVIDER, "sk-test-key");
    expect(aiConnected()).toBe(false);
  });
});
