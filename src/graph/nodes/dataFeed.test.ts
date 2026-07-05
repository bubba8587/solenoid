import { describe, it, expect, beforeEach } from "vitest";
import { DataFeedNode } from "./dataFeed";
import { apiKeyStore } from "../apiKeyStore";
import { connectionStore } from "../connectionStore";

// These exercise ONLY the non-network branches of data() (empty input, needs-key) so
// no real fetch fires — the actual FRED/Stooq round-trip is verified live by the author.
describe("DataFeedNode gating", () => {
  beforeEach(() => {
    apiKeyStore.remove("fred");
    apiKeyStore.remove("alphavantage");
  });

  it("defaults to FRED and reports needs-key when no key is stored", () => {
    const n = new DataFeedNode();
    expect(n.provider).toBe("fred");
    expect(n.preset().id).toBe("fred");
    expect(n.needsKey()).toBe(true);
  });

  it("empty input → idle, no frame (no fetch)", () => {
    const n = new DataFeedNode();
    const out = n.data();
    expect(out.frame).toBeNull();
    expect(connectionStore.getState(n.id).status).toBe("idle");
  });

  it("keyed provider with input but no key → error state pointing at Settings, no fetch", () => {
    const n = new DataFeedNode();
    n.stringLiterals.input = "GDP";
    const out = n.data();
    expect(out.frame).toBeNull();
    const st = connectionStore.getState(n.id);
    expect(st.status).toBe("error");
    expect(st.message).toMatch(/Settings/);
  });

  it("storing the key clears needs-key; a keyless provider (Stooq) never needs one", () => {
    const n = new DataFeedNode();
    apiKeyStore.set("fred", "abc");
    expect(n.needsKey()).toBe(false);

    const stooq = new DataFeedNode({ provider: "stooq" });
    expect(stooq.needsKey()).toBe(false);
  });
});
