import { describe, it, expect, beforeEach } from "vitest";
import { DataFeedNode } from "../../../src/graph/nodes/dataFeed";
import { apiKeyStore } from "../../../src/graph/apiKeyStore";
import { connectionStore } from "../../../src/graph/connectionStore";

// These exercise ONLY the non-network branches of data() (empty input, needs-key) so
// no real fetch fires — the actual FRED/Stooq round-trip is verified live by the author.
describe("DataFeedNode gating", () => {
  beforeEach(() => {
    apiKeyStore.remove("fred");
    apiKeyStore.remove("alphavantage");
  });

  it("defaults to FRED, which is KEYLESS (no key needed)", () => {
    const n = new DataFeedNode();
    expect(n.provider).toBe("fred");
    expect(n.preset().id).toBe("fred");
    expect(n.needsKey()).toBe(false);
  });

  it("empty input → idle, no frame (no fetch)", () => {
    const n = new DataFeedNode();
    const out = n.data();
    expect(out.frame).toBeNull();
    expect(connectionStore.getState(n.id).status).toBe("idle");
  });

  it("KEYED provider with input but no key → error state pointing at Settings, no fetch", () => {
    const n = new DataFeedNode({ provider: "alphavantage" });
    n.stringLiterals.input = "AAPL";
    const out = n.data();
    expect(out.frame).toBeNull();
    const st = connectionStore.getState(n.id);
    expect(st.status).toBe("error");
    expect(st.message).toMatch(/Settings/);
  });

  it("storing the key clears needs-key; keyless FRED never needs one", () => {
    const av = new DataFeedNode({ provider: "alphavantage" });
    expect(av.needsKey()).toBe(true);
    apiKeyStore.set("alphavantage", "abc");
    expect(av.needsKey()).toBe(false);

    expect(new DataFeedNode({ provider: "fred" }).needsKey()).toBe(false);
  });
});
