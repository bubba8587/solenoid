// [[A1]] visualGraphCalculator, [[group-expand-push#Who is a member]], [[save-format#A save loses nothing quietly]]
// A deleted card leaves every group that held it, so neither the group nor the save written from it names a card
// that is gone (the save had carried the dead card's per-load id where a name belongs).
import { it, expect, vi } from "vitest";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { serializeGraph } from "../../src/graph/persistence";
import { deleteSelection } from "../../src/graph/canvasActions";
import { GroupNode, ValueInputNode } from "../../src/graph/nodeClasses";
import { nodeNameStore } from "../../src/graph/nodeNameStore";

it("a deleted member leaves its group and the save", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  const view = {
    hasNode: () => true, position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, p); },
    nodeElement: () => null, measured: () => ({ w: 100, h: 60 }), container: { clientWidth: 800, clientHeight: 600 },
    setCamera: async () => {}, rerenderNode: async () => {}, transform: { x: 0, y: 0, k: 1 },
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  const a = new ValueInputNode({ value: "1" });
  const b = new ValueInputNode({ value: "2" });
  await editor.addNode(a as SolenoidNode);
  await editor.addNode(b as SolenoidNode);
  const g = new GroupNode({ members: [a.id, b.id] } as never);
  await editor.addNode(g as SolenoidNode);
  (a as { selected?: boolean }).selected = true;
  await deleteSelection(editor, view);
  expect(g.members).toEqual([b.id]);
  expect(serializeGraph()!.nodes.find((n) => n.type === "GroupNode")!.init.members).toEqual([nodeNameStore.get(b.id)]);
});
