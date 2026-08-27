import { describe, it, expect } from "vitest";
import {
  buildModel,
  canConnect,
  connect,
  disconnect,
  removeNodes,
  addNode,
  moveNode,
} from "./flowModel";
import type { SavedGraphLite } from "./flowModel";
import { computeAll } from "../graphCompute";
import { isSolError } from "../errorValue";

// The model's edit verbs write through the editor under the socket lattice, and
// the shared pass recomputes targeted.

const FIXTURE: SavedGraphLite = {
  v: 2,
  nodes: [
    { id: "a", type: "NumberInputNode", name: "A", x: 0, y: 0, init: { value: 2 } },
    { id: "b", type: "NumberInputNode", name: "B", x: 0, y: 120, init: { value: 3 } },
    { id: "sum", type: "ArithmeticNode", name: "Sum", x: 240, y: 60, init: { op: "add" } },
    { id: "txt", type: "TextInputNode", name: "Txt", x: 0, y: 240, init: { value: "hi" } },
  ],
  connections: [
    { source: "a", sourceOutput: "value", target: "sum", targetInput: "a" },
    { source: "b", sourceOutput: "value", target: "sum", targetInput: "b" },
  ],
};

/** Live ids in fixture order (editor preserves insertion order). */
async function build() {
  const m = await buildModel(FIXTURE);
  const [a, b, sum, txt] = m.editor.getNodes().map((n) => n.id);
  return { m, a, b, sum, txt };
}

describe("flow controller (React Flow port C1)", () => {
  it("computes through wired inputs", async () => {
    const { m, sum } = await build();
    const values = await computeAll(m.editor, m.engine);
    expect(values.get(sum)).toMatchObject({ result: 5 });
  });

  it("refuses lattice-invalid and self connections, accepts valid ones", async () => {
    const { m, a, sum, txt } = await build();
    // string output → number-list input: the lattice refuses.
    expect(canConnect(m, txt, "value", sum, "a")).toBe(false);
    // self-loop refused.
    expect(canConnect(m, sum, "result", sum, "a")).toBe(false);
    // number → numlist accepted.
    expect(canConnect(m, a, "value", sum, "a")).toBe(true);
    // connect() enforces the same gate.
    expect(await connect(m, txt, "value", sum, "a")).toBe(false);
  });

  it("evicts the existing cable on a single-connection input", async () => {
    const { m, a, sum } = await build();
    const before = m.editor.getConnections().length;
    // b already feeds sum.b; rewire a → sum.b. The old cable must go.
    expect(await connect(m, a, "value", sum, "b")).toBe(true);
    expect(m.editor.getConnections().length).toBe(before);
    const intoB = m.editor.getConnections().filter((c) => c.target === sum && c.targetInput === "b");
    expect(intoB.length).toBe(1);
    expect(intoB[0].source).toBe(a);
    const values = await computeAll(m.editor, m.engine, sum);
    expect(values.get(sum)).toMatchObject({ result: 4 }); // 2 + 2
  });

  it("disconnect falls back to the input literal; delete removes cables too", async () => {
    const { m, a, sum } = await build();
    const cable = m.editor.getConnections().find((c) => c.source === a)!;
    await disconnect(m, cable.id);
    expect(m.editor.getConnection(cable.id)).toBeUndefined();
    // WIRED-blank rule: the unwired input reads its literal (0), so 0 + 3.
    const values = await computeAll(m.editor, m.engine, sum);
    expect(values.get(sum)).toMatchObject({ result: 3 });

    await removeNodes(m, [sum]);
    expect(m.editor.getNode(sum)).toBeUndefined();
    expect(m.editor.getConnections().every((c) => c.source !== sum && c.target !== sum)).toBe(true);
    expect(m.positions.has(sum)).toBe(false);
  });

  it("addNode places a catalog entry and it computes", async () => {
    const { m } = await build();
    const node = await addNode(m, "number-input", { x: 500, y: 500 });
    expect(node).not.toBeNull();
    expect(m.positions.get(node!.id)).toEqual({ x: 500, y: 500 });
    moveNode(m, node!.id, { x: 10, y: 20 });
    expect(m.positions.get(node!.id)).toEqual({ x: 10, y: 20 });
    const values = await computeAll(m.editor, m.engine, node!.id);
    expect(values.get(node!.id)).toMatchObject({ value: 0 });
  });

  it("a cycle seeds #CIRC! instead of overflowing", async () => {
    const { m, sum } = await build();
    const other = await addNode(m, "arith-add", { x: 480, y: 60 });
    expect(await connect(m, sum, "result", other!.id, "a")).toBe(true);
    expect(await connect(m, other!.id, "result", sum, "a")).toBe(true);
    const values = await computeAll(m.editor, m.engine);
    const out = (values.get(sum) ?? {}).result;
    expect(isSolError(out) && (out as { code?: string }).code === "#CIRC!").toBe(true);
  });
});
