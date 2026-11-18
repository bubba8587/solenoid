// [[A1]], [[B3]], [[react-flow-surface-contract#The flow model]]
import { describe, it, expect } from "vitest";
import {
  buildModel,
  canConnect,
  connect,
  type SavedGraphLite,
} from "../../../src/graph/flow/flowModel";
import { computeAll } from "../../../src/graph/graphCompute";

const FIXTURE: SavedGraphLite = {
  v: 2,
  nodes: [
    { id: "a", type: "ValueInputNode", name: "A", x: 0, y: 0, init: { value: "2" } },
    { id: "b", type: "ValueInputNode", name: "B", x: 0, y: 120, init: { value: "3" } },
    { id: "sum", type: "ArithmeticNode", name: "Sum", x: 240, y: 60, init: { op: "add" } },
    { id: "txt", type: "ValueInputNode", name: "Txt", x: 0, y: 240, init: { op: "string", value: "hi" } },
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

  it("an unwired input falls back to its literal", async () => {
    const { m, a, sum } = await build();
    const cable = m.editor.getConnections().find((c) => c.source === a)!;
    await m.editor.removeConnection(cable.id);
    expect(m.editor.getConnection(cable.id)).toBeUndefined();
    // WIRED-blank rule: the unwired input reads its literal (0), so 0 + 3.
    const values = await computeAll(m.editor, m.engine, sum);
    expect(values.get(sum)).toMatchObject({ result: 3 });

  });
});
