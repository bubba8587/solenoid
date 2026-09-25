// [[C43]] oneFlowSurface, [[D16]] retypeReconciles
import type { View } from "../../src/graph/view";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes, SolenoidConnection } from "../../src/graph/schemes";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { installCableSettlePipe, type CableEnds, type CableSettleStack } from "../../src/graph/cableSettle";
import { beginGraphRebuild, endGraphRebuild } from "../../src/graph/process";

beforeEach(() => { vi.stubGlobal("requestAnimationFrame", () => 0); });
afterEach(() => { vi.unstubAllGlobals(); });

const view = { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View;

async function scene(stack: Partial<CableSettleStack>) {
  const editor = new NodeEditor<Schemes>();
  const s: CableSettleStack = { editor, view, ...stack };
  installCableSettlePipe(s);
  const num = new NumberInputNode({ value: 2 });
  const fc = new FormatControllerNode();
  await editor.addNode(num);
  await editor.addNode(fc);
  const wire = () => editor.addConnection(new ClassicPreset.Connection(num, "value", fc, "in") as SolenoidConnection);
  return { fc, wire };
}

describe("the cable-settle pipe every surface stack installs", () => {
  it("settles FC types on a live cable change, then hands the cable to the host's recompute", async () => {
    const seen: CableEnds[] = [];
    const { fc, wire } = await scene({ afterCableChange: (c) => seen.push(c), isRebuilding: () => false });
    await wire();
    expect(fc.socketDataType).toBe("number");
    expect(seen.map((c) => c.target)).toEqual([fc.id]);
  });

  it("holds while the stack's own rebuild gate is up, as a drill-in's is during a bulk edit", async () => {
    const seen: CableEnds[] = [];
    const { fc, wire } = await scene({ afterCableChange: (c) => seen.push(c), isRebuilding: () => true });
    await wire();
    expect(fc.socketDataType).toBe("trueany");
    expect(seen).toEqual([]);
  });

  it("holds under the main rebuild gate", async () => {
    const seen: CableEnds[] = [];
    const { fc, wire } = await scene({ afterCableChange: (c) => seen.push(c) });
    beginGraphRebuild();
    try { await wire(); } finally { endGraphRebuild(); }
    expect(fc.socketDataType).toBe("trueany");
    expect(seen).toEqual([]);
  });

  it("installs nothing on a stack with no recompute", async () => {
    const { fc, wire } = await scene({});
    await wire();
    expect(fc.socketDataType).toBe("trueany");
  });
});
