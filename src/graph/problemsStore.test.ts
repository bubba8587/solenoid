import { describe, it, expect, beforeEach } from "vitest";
import { problemsStore } from "./problemsStore";
import { solError, type SolError } from "./errorValue";

// The Problems log's edge-detect contract: one row per failure at its origin,
// no duplicate for a continuously-failing node — but a failure that CLEARS and
// later RECURS is a new occurrence and logs again (the audit-found suppression:
// _lastLiveCode was never reset on a clean pass).

const err = (code: Parameters<typeof solError>[0], nodeId: string): SolError => {
  const e = solError(code, "x");
  e.origin = { nodeId, nodeName: nodeId };
  return e;
};

describe("problemsStore live edge-detect", () => {
  beforeEach(() => problemsStore.clear());

  it("logs once for a continuously-failing node", () => {
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    expect(problemsStore.list()).toHaveLength(1);
  });

  it("logs only at the error's origin, not relay nodes", () => {
    const e = err("#DIV/0!", "n1");
    problemsStore.reportLive("n1", e);
    problemsStore.reportLive("n2", e); // pass-through site
    problemsStore.reportLive("n3", e);
    expect(problemsStore.list()).toHaveLength(1);
    expect(problemsStore.list()[0].nodeId).toBe("n1");
  });

  it("a relapse after a clean pass logs again", () => {
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    problemsStore.clearLive("n1"); // the node computed clean
    problemsStore.reportLive("n1", err("#DIV/0!", "n1")); // same code recurs
    expect(problemsStore.list()).toHaveLength(2);
  });

  it("failing a DIFFERENT way logs without needing a clean pass", () => {
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    problemsStore.reportLive("n1", err("#VALUE!", "n1"));
    expect(problemsStore.list()).toHaveLength(2);
  });

  it("removeForNode drops the node's rows and detection state", () => {
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    problemsStore.removeForNode("n1");
    expect(problemsStore.list()).toHaveLength(0);
    problemsStore.reportLive("n1", err("#DIV/0!", "n1"));
    expect(problemsStore.list()).toHaveLength(1);
  });
});
