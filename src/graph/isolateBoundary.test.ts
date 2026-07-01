import { describe, it, expect } from "vitest";
import { boundaryCrossings } from "./isolateBoundary";

const c = (id: string, source: string, sourceOutput: string, target: string, targetInput: string) =>
  ({ id, source, sourceOutput, target, targetInput });

describe("boundaryCrossings", () => {
  const conns = [
    c("c1", "ext1", "out", "a", "in"),   // entry: ext1 → a
    c("c2", "a", "out", "b", "in"),       // internal: a → b
    c("c3", "b", "out", "ext2", "in"),    // exit: b → ext2
    c("c4", "ext3", "out", "ext4", "in"), // fully external
  ];
  const focus = new Set(["a", "b"]);

  it("splits crossings into entry (inbound) and exit (outbound)", () => {
    const r = boundaryCrossings(focus, conns);
    expect(r.entry).toEqual([
      { connId: "c1", focusNodeId: "a", focusSocket: "in", externalNodeId: "ext1", externalSocket: "out" },
    ]);
    expect(r.exit).toEqual([
      { connId: "c3", focusNodeId: "b", focusSocket: "out", externalNodeId: "ext2", externalSocket: "in" },
    ]);
  });

  it("ignores internal and fully-external connections", () => {
    const r = boundaryCrossings(focus, conns);
    const ids = [...r.entry, ...r.exit].map((x) => x.connId);
    expect(ids).not.toContain("c2"); // internal
    expect(ids).not.toContain("c4"); // fully external
  });

  it("collects multiple lanes per side (→ a Conduit endpoint; one → a single socket)", () => {
    const multi = [
      c("e1", "x", "o", "a", "i0"),
      c("e2", "y", "o", "a", "i1"),
      c("e3", "a", "o", "z", "i"),
    ];
    const r = boundaryCrossings(new Set(["a"]), multi);
    expect(r.entry.map((x) => x.connId).sort()).toEqual(["e1", "e2"]); // 2 → conduit
    expect(r.exit.map((x) => x.connId)).toEqual(["e3"]);               // 1 → single socket
  });

  it("returns empty boundary for a fully self-contained focus set", () => {
    const r = boundaryCrossings(new Set(["a", "b"]), [c("c2", "a", "out", "b", "in")]);
    expect(r).toEqual({ entry: [], exit: [] });
  });
});
