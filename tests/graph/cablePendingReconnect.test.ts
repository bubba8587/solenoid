import { describe, it, expect, beforeEach } from "vitest";
import { cablePendingStore } from "../../src/graph/cableState";
import { reattachPending } from "../../src/graph/cablePendingReconnect";
import { SolenoidSocket } from "../../src/graph/sockets";

// A minimal editor stub: the subset reattachPending touches. Nodes carry id + typed
// input/output sockets; connections are plain endpoint records.
type Conn = { id: string; source: string; sourceOutput: string; target: string; targetInput: string };
function stubEditor(nodes: Record<string, { id: string; inputs: Record<string, { socket: SolenoidSocket; label: string }>; outputs: Record<string, { socket: SolenoidSocket }> }>) {
  const conns: Conn[] = [];
  return {
    getNode: (id: string) => nodes[id],
    getConnections: () => conns,
    addConnection: async (c: { id?: string; source: string; sourceOutput: string; target: string; targetInput: string }) => {
      conns.push({ id: c.id ?? `${c.source}-${c.target}`, source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput });
      return true;
    },
    _conns: conns,
  };
}
const inputSock = (dt: string, label: string) => ({ socket: new SolenoidSocket(dt as never), label });

beforeEach(() => cablePendingStore.clear());

describe("cablePendingStore — mark / drop rules", () => {
  it("mark is idempotent by the four endpoint fields, and forSource filters", () => {
    const id = cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    const again = cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    expect(again).toBe(id);
    expect(cablePendingStore.all()).toHaveLength(1);
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "e", targetInput: "in", label: "In" });
    expect(cablePendingStore.forSource("sw")).toHaveLength(2);
    expect(cablePendingStore.forSource("other")).toHaveLength(0);
  });

  it("drop removes one; dropForNode removes ghosts on EITHER end", () => {
    const id = cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "e", targetInput: "in", label: "In" });
    cablePendingStore.drop(id);
    expect(cablePendingStore.all()).toHaveLength(1);
    cablePendingStore.mark({ source: "x", sourceOutput: "out", target: "e", targetInput: "in", label: "In" }); // e is a TARGET here
    cablePendingStore.dropForNode("e"); // drops both the source-e and target-e ghosts
    expect(cablePendingStore.all()).toHaveLength(0);
  });
});

describe("reattachPending — same key, then same label, only when compatible", () => {
  it("re-materializes when the output type fits the same-key socket again", async () => {
    const ed = stubEditor({
      sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("trueany") } } }, // flipped back to One
      d: { id: "d", inputs: { in: inputSock("number", "In") }, outputs: {} },
    });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(1);            // trueany fits number → reattached
    expect(cablePendingStore.all()).toHaveLength(0);
  });

  it("leaves the ghost when the output type still can't feed the socket", async () => {
    const ed = stubEditor({
      sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("cube") } } }, // still Many
      d: { id: "d", inputs: { in: inputSock("number", "In") }, outputs: {} },
    });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(0);            // cube can't feed number → still ghosted
    expect(cablePendingStore.all()).toHaveLength(1);
  });

  it("falls back to the same LABEL when the original key is gone", async () => {
    const ed = stubEditor({
      sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("trueany") } } },
      d: { id: "d", inputs: { in2: inputSock("number", "Value") }, outputs: {} }, // key changed, label kept
    });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "Value" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(1);
    expect(ed._conns[0].targetInput).toBe("in2");  // matched by label
  });

  it("drops the ghost when the target node is gone", async () => {
    const ed = stubEditor({ sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("trueany") } } } });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "gone", targetInput: "in", label: "In" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(0);
    expect(cablePendingStore.all()).toHaveLength(0); // target vanished → ghost dies
  });

  it("drops the ghost when another source took the single-cable input meanwhile", async () => {
    const ed = stubEditor({
      sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("trueany") } } },
      other: { id: "other", inputs: {}, outputs: { out: { socket: new SolenoidSocket("number") } } },
      d: { id: "d", inputs: { in: inputSock("number", "In") }, outputs: {} },
    });
    await ed.addConnection({ source: "other", sourceOutput: "out", target: "d", targetInput: "in" });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "in", label: "In" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(1);                 // never a second cable on the input
    expect(ed._conns[0].source).toBe("other");         // the user's rewire wins
    expect(cablePendingStore.all()).toHaveLength(0);
  });

  it("an ambiguous label (two inputs share it) keeps the ghost waiting", async () => {
    const ed = stubEditor({
      sw: { id: "sw", inputs: {}, outputs: { out: { socket: new SolenoidSocket("trueany") } } },
      d: { id: "d", inputs: { a: inputSock("number", "Value"), b: inputSock("number", "Value") }, outputs: {} },
    });
    cablePendingStore.mark({ source: "sw", sourceOutput: "out", target: "d", targetInput: "gone", label: "Value" });
    await reattachPending(ed as never, null, "sw", "out");
    expect(ed._conns).toHaveLength(0);
    expect(cablePendingStore.all()).toHaveLength(1);
  });
});
