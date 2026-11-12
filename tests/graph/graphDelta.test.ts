// [[save-format#A save loses nothing quietly]], [[react-flow-surface-contract#Undo history]]
// Undo moves the live canvas to a step by its delta: the canvas it lands on is the one a whole load of that step
// builds, the same save and the same answers, and a card the change doesn't reach is never computed again.
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { nodeNameStore } from "../../src/graph/nodeNameStore";
import { serializeGraph, loadGraph, type SavedGraph, type SavedNode } from "../../src/graph/persistence";
import { applyGraphDelta, diffGraphs } from "../../src/graph/graphDelta";
import { sameLanding } from "../../src/graph/flow/flowHistoryDigest";
import { SEEDS } from "../../src/graph/seeds";
import { readTextForm } from "../../src/graph/textForm";
import { deleteSelection } from "../../src/graph/canvasActions";
import { createCompositeFromSelection, unpackComposite } from "../../src/graph/compositeLogic";
import { calcModeStore } from "../../src/graph/calcModeStore";


let editor: GraphEditor<Schemes>;
let engine: DataflowEngine<Schemes>;
let view: View;

beforeEach(() => {
  forgetAllNodes();
  editor = new GraphEditor<Schemes>();
  engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  view = {
    hasNode: (id: string) => pos.has(id),
    position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, { ...p }); },
    nodeElement: () => null,
    measured: () => ({ w: 100, h: 60 }),
    container: { clientWidth: 800, clientHeight: 600 },
    pan: async () => {},
    zoom: async () => {},
    setCamera: async () => {},
    rerenderNode: async () => {},
    rerenderCables: async () => {},
    transform: { x: 0, y: 0, k: 1 },
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

const canon = (g: SavedGraph): string => JSON.stringify(g);
/** A save as the history hands a step back: its top-level fields first, then `nodes`. */
const asStep = (g: SavedGraph): SavedGraph => { const { nodes, ...head } = structuredClone(g); return { ...head, nodes }; };

/** Every output each card landed, by card name. */
function answers(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of editor.getNodes()) {
    const name = nodeNameStore.get(n.id) ?? n.id;
    for (const key of Object.keys(n.outputs)) {
      let v: unknown;
      try { v = engine.landed(n.id, key); } catch { v = "<unreadable>"; }
      out[`${name}.${key}`] = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x)) ?? "undefined";
    }
  }
  return out;
}

/** The save a whole load of `g` gives, and the answers it lands. */
async function whole(g: SavedGraph): Promise<{ save: SavedGraph; answers: Record<string, string> }> {
  expect(await loadGraph(structuredClone(g), { curtain: false })).toBe(true);
  return { save: serializeGraph()!, answers: answers() };
}

/** Three edits a person makes, each a step undo goes back over: a card deleted with its cables, one moved, a cable cut. */
function edited(g: SavedGraph, k: number): SavedGraph {
  const out = structuredClone(g);
  if (out.nodes.length === 0) return out;
  const victim = out.nodes[k % out.nodes.length];
  out.nodes = out.nodes.filter((n) => n !== victim);
  out.connections = out.connections.filter((c) => c.source !== victim.id && c.target !== victim.id);
  const mover = out.nodes[(k + 1) % Math.max(1, out.nodes.length)];
  if (mover) { mover.x += 40; mover.y -= 25; }
  if (out.connections.length > 1) out.connections.splice((k + 2) % out.connections.length, 1);
  return out;
}

/** The edits that change no cable: a card renamed, one folded, an input's value typed over, a pin and a comment. */
function restyled(g: SavedGraph, k: number): SavedGraph {
  const out = structuredClone(g);
  if (out.nodes.length < 2) return out;
  const renamed = out.nodes[k % out.nodes.length];
  const to = `${renamed.id}_x`;
  for (const c of out.connections) {
    if (c.source === renamed.id) c.source = to;
    if (c.target === renamed.id) c.target = to;
  }
  for (const side of [out.pins, out.comments, out.frameFormats] as Array<Array<{ nodeId: string }> | undefined>)
    for (const e of side ?? []) if (e.nodeId === renamed.id) e.nodeId = to;
  for (const st of out.standoffs ?? []) for (const end of [st.a, st.b]) if (end.nodeId === renamed.id) end.nodeId = to;
  renamed.id = to;
  renamed.name = to;
  const folded = out.nodes[(k + 1) % out.nodes.length];
  folded.collapsed = !folded.collapsed;
  const input = out.nodes.find((n) => n.type === "ValueInputNode");
  if (input) input.init = { ...input.init, value: "7" };
  const pinned = out.nodes[(k + 2) % out.nodes.length];
  out.pins = [...(out.pins ?? []).filter((p) => p.nodeId !== pinned.id), { nodeId: pinned.id, outputKey: "value" }];
  out.comments = [...(out.comments ?? []), { id: "cm900", nodeId: pinned.id, author: "Ann", text: "check", resolved: false, time: 1 }];
  return out;
}

describe("the delta between two saves", () => {
  const node = (id: string, init: Record<string, unknown>, x = 0): SavedNode => ({ id, name: id, type: "ValueInputNode", x, y: 0, init });
  const g = (nodes: SavedNode[], connections: SavedGraph["connections"] = []): SavedGraph => ({ v: 2, nodes, connections });

  it("sorts each card into added, removed, patched or moved, and a moved card's cables stay", () => {
    const a = g([node("a", { value: "1" }), node("b", { value: "2" }), node("c", { value: "3" })]);
    const b = g([node("a", { value: "1" }, 50), node("b", { value: "9" }), node("d", { value: "4" })]);
    const d = diffGraphs(a, b)!;
    expect(d.removed).toEqual(["c"]);
    expect(d.added.map((n) => n.id)).toEqual(["d"]);
    expect(d.rebuilt).toEqual([]);
    expect(d.patched.map((n) => n.id)).toEqual(["b"]);
    expect(d.moved.map((n) => n.id)).toEqual(["a"]);
  });

  it("a typed value is set in place; anything else a card's edit changes rebuilds it", () => {
    const ar = (init: Record<string, unknown>, literals?: Record<string, number>): SavedNode =>
      ({ id: "f", name: "f", type: "ArithmeticNode", x: 0, y: 0, init, ...(literals ? { literals } : {}) });
    const typed = diffGraphs(g([ar({ op: "mul" }, { a: 0, b: 2 })]), g([ar({ op: "mul" }, { a: 0, b: 9 })]))!;
    expect([typed.patched.length, typed.rebuilt.length]).toEqual([1, 0]);
    const titled = diffGraphs(g([ar({ op: "mul", label: "x" })]), g([ar({ op: "mul", label: "y" })]))!;
    expect([titled.patched.length, titled.rebuilt.length]).toEqual([1, 0]);
    const op = diffGraphs(g([ar({ op: "mul" })]), g([ar({ op: "add" })]))!;
    expect([op.patched.length, op.rebuilt.length]).toEqual([0, 1]);
    // A field the save leaves out has no value to set back, so it rebuilds.
    const dropped = diffGraphs(g([ar({ op: "mul", label: "x" })]), g([ar({ op: "mul" })]))!;
    expect([dropped.patched.length, dropped.rebuilt.length]).toEqual([0, 1]);
  });

  it("a measured width alone is no edit, and another pack set is a whole load", () => {
    const a = g([node("a", { value: "1", width: 120 })]);
    const b = g([node("a", { value: "1", width: 180 })]);
    expect(diffGraphs(a, b)!.rebuilt).toEqual([]);
    expect(diffGraphs(a, { ...b, packs: ["finance"] })).toBeNull();
  });
});

describe("undo by delta lands where a whole load does", () => {
  for (const [id, seed] of Object.entries(SEEDS)) {
    if (!Array.isArray(seed.graph.nodes)) continue;

    for (const [how, edit] of [["deleted, moved, cut", edited], ["renamed, folded, typed, pinned", restyled]] as const)
    it(`seed ${id}: ${how}`, async () => {
      const a = await whole(seed.graph);
      const b = await whole(edit(a.save, id.length));
      const twice = await whole(a.save);
      // An example whose whole load doesn't land the same answers twice (a random draw, the clock) is checked by its save alone.
      const steady = JSON.stringify(twice.answers) === JSON.stringify(a.answers);

      // Undo: from the edited canvas back to the original, then redo forward again.
      await whole(b.save);
      expect(await applyGraphDelta(asStep(a.save))).not.toBeNull();
      expect(sameLanding(serializeGraph()!, a.save)).toBe(true);
      if (steady) expect(answers()).toEqual(a.answers);

      expect(await applyGraphDelta(asStep(b.save))).not.toBeNull();
      expect(sameLanding(serializeGraph()!, b.save)).toBe(true);
      if (steady) expect(answers()).toEqual(b.answers);
    });
  }
});

describe("what the change doesn't reach keeps its value", () => {
  const TEXT = [
    'A: ValueInputNode value="2"',
    'B: ValueInputNode value="5"',
    'F: ArithmeticNode op="mul" a<-A.value lit:b=10',
    'G: ArithmeticNode op="add" a<-B.value lit:b=1',
    "---",
    '{ "v": 2 }',
  ].join("\n");

  it("undoing an edit to one input computes only its chain", async () => {
    const first = await whole(readTextForm(TEXT));
    const edit = structuredClone(first.save);
    const a = edit.nodes.find((n) => n.id === "A")!;
    a.init = { ...a.init, value: "3" };
    await whole(edit);

    // The pass the undo asks for: an additive one (nothing cleared beyond what the reset reached) over A's chain.
    const passes: Array<string[] | undefined> = [];
    const resets: string[] = [];
    const pass = engine.pass.bind(engine);
    const reset = engine.reset.bind(engine);
    engine.pass = (changed, renderOnly, topology) => { passes.push(renderOnly && [...renderOnly].map((id) => nodeNameStore.get(id)!).sort()); return pass(changed, renderOnly, topology); };
    engine.reset = (id) => { resets.push(id ? nodeNameStore.get(id)! : "<every cache>"); reset(id); };
    const liveG = nodeNameStore.byName("G");
    const liveA = nodeNameStore.byName("A");
    expect(await applyGraphDelta(asStep(first.save))).not.toBeNull();
    expect(canon(serializeGraph()!)).toBe(canon(first.save));
    expect(nodeNameStore.byName("G")).toBe(liveG);
    // The typed value is set on A's live card: no new node, no cable taken down and put back.
    expect(nodeNameStore.byName("A")).toBe(liveA);
    expect(passes).toEqual([["A", "F"]]);
    expect(resets).toEqual(["A"]);
    expect(answers()).toEqual(first.answers);
  });

  it("a delete computes only what lost a cable, and lands the answers a fresh load of what's left gives", async () => {
    await whole(readTextForm(TEXT));
    const passes: Array<string[] | undefined> = [];
    const pass = engine.pass.bind(engine);
    engine.pass = (changed, renderOnly, topology) => { passes.push(renderOnly && [...renderOnly].map((id) => nodeNameStore.get(id)!).sort()); return pass(changed, renderOnly, topology); };
    for (const n of editor.getNodes()) (n as { selected?: boolean }).selected = nodeNameStore.get(n.id) === "A";
    await deleteSelection(editor, null);
    expect(passes).toEqual([["F"]]);
    const left = answers();
    engine.pass = pass;
    expect((await whole(serializeGraph()!)).answers).toEqual(left);
  });


  it("in Manual an undo still computes what it changed, as the whole load it replaces did", async () => {
    const first = await whole(readTextForm(TEXT));
    const edit = structuredClone(first.save);
    edit.nodes.find((n) => n.id === "A")!.init.value = "3";
    await whole(edit);
    calcModeStore.setMode("manual");
    try {
      expect(await applyGraphDelta(asStep(first.save))).not.toBeNull();
      expect(answers()).toEqual(first.answers);
    } finally {
      calcModeStore.setMode("auto");
    }
  });


  it("wrapping a card as a composite, and unpacking it, each compute only what they reach", async () => {
    const before = await whole(readTextForm(TEXT));
    const passes: Array<string[] | undefined> = [];
    const pass = engine.pass.bind(engine);
    const name = (id: string) => nodeNameStore.get(id) ?? editor.getNode(id)?.constructor.name ?? id;
    engine.pass = (changed, renderOnly, topology) => { passes.push(renderOnly && [...renderOnly].map(name).sort()); return pass(changed, renderOnly, topology); };
    for (const n of editor.getNodes()) (n as { selected?: boolean }).selected = nodeNameStore.get(n.id) === "F";
    const id = await createCompositeFromSelection(editor, view);
    expect(id).not.toBeNull();
    expect(passes).toEqual([[name(id!)]]);
    const wrapped = answers();
    engine.pass = pass;
    const wrappedSave = serializeGraph()!;
    // Undo the wrap and redo it by delta: the composite goes and its card comes back, then the other way.
    expect(await applyGraphDelta(asStep(before.save))).not.toBeNull();
    expect(answers()).toEqual(before.answers);
    expect(await applyGraphDelta(asStep(wrappedSave))).not.toBeNull();
    expect(answers()).toEqual(wrapped);
    expect((await whole(wrappedSave)).answers).toEqual(wrapped);

    const comp = editor.getNodes().find((n) => n.constructor.name === "CompositeNode")!;
    engine.pass = (changed, renderOnly, topology) => { passes.push(renderOnly && [...renderOnly].map(name).sort()); return pass(changed, renderOnly, topology); };
    passes.length = 0;
    const inner = (comp as unknown as { internalEditor: GraphEditor<Schemes> }).internalEditor.getNodes()
      .filter((n) => n.constructor.name === "ArithmeticNode").map((n) => n.id);
    expect(await unpackComposite(editor, view, comp.id)).toBe(true);
    // The one card the composite held (it keeps no name inside a composite yet: the backlog's composite names).
    expect(passes).toEqual([inner.map(name)]);
    const save = serializeGraph()!;
    const unpacked = answers();
    engine.pass = pass;
    expect((await whole(save)).answers).toEqual(unpacked);
  });

});
