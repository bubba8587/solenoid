// [[C77]] compositeIsSubgraph, [[B10]] reactFlowView
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidConnection, SolenoidNode } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { setEditorRefs } from "../../src/graph/process";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { collapseStore } from "../../src/graph/collapseStore";
import { pinStore } from "../../src/graph/pinStore";
import { unpackComposite } from "../../src/graph/compositeLogic";
import { getDrillStack, recordNow, type DrillStack } from "../../src/graph/flow/drillStack";

let editor: NodeEditor<Schemes>;
let view: View;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { createElement: () => ({}), querySelector: () => null });
  editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  view = {
    hasNode: (id: string) => pos.has(id),
    position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, { ...p }); },
    nodeElement: () => null,
    rerenderNode: async () => {},
  } as unknown as View;
  setEditorRefs(editor, engine, view);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What the drill-in's mount and unmount do to the stack. */
const open = (s: DrillStack) => { s.open = true; s.rebuilding = false; };
const close = (s: DrillStack) => { s.open = false; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

async function setup() {
  const comp = new CompositeNode({});
  await comp.hydrate(ctorRegistry());
  const a = new NumberInputNode({ value: 1 });
  const b = new DisplayNode();
  await comp.internalEditor.addNode(a as never);
  await comp.internalEditor.addNode(b as never);
  await editor.addNode(comp as SolenoidNode);
  const s = getDrillStack(comp);
  const syncTopology = vi.fn();
  s.handlers.syncTopology = syncTopology;
  const connect = () => comp.internalEditor.addConnection(new ClassicPreset.Connection(a, "value", b, "in") as SolenoidConnection);
  return { comp, a, b, s, syncTopology, connect };
}

describe("a closed drill-in level's pipes stand down", () => {
  it("open, an inner edit syncs and records; closed, it does neither, and a reopen records it", async () => {
    const { comp, s, syncTopology, connect } = await setup();
    open(s);
    recordNow(comp, s);
    const base = s.history.stack.length;
    await connect();
    await flush();
    vi.advanceTimersByTime(450);
    expect(syncTopology).toHaveBeenCalledTimes(1);
    expect(s.history.stack.length).toBe(base + 1);

    close(s);
    syncTopology.mockClear();
    expect(s.isRebuilding()).toBe(true);
    for (const c of [...s.editor.getConnections()]) await s.editor.removeConnection(c.id);
    await flush();
    vi.advanceTimersByTime(450);
    expect(syncTopology).not.toHaveBeenCalled();
    expect(s.history.stack.length).toBe(base + 1);

    open(s);
    recordNow(comp, s);
    expect(s.history.stack.length).toBe(base + 2);
  });

  it("closed, a removal is a relocation that keeps the node's stores; open, it forgets", async () => {
    const { a, b, s } = await setup();
    collapseStore.set(b.id, true);
    open(s);
    close(s);
    await s.editor.removeNode(b.id);
    expect(collapseStore.get(b.id)).toBe(true);

    open(s);
    collapseStore.set(a.id, true);
    await s.editor.removeNode(a.id);
    expect(collapseStore.get(a.id)).toBeFalsy();
  });

  it("an Unpack after the level closed keeps the unpacked cards' stores and wakes nothing inside", async () => {
    const { comp, a, s, syncTopology, connect } = await setup();
    await connect();
    open(s);
    close(s);
    pinStore.toggle(a.id, "value");
    collapseStore.set(a.id, true);
    const history = s.history.stack.length;

    expect(await unpackComposite(editor, view, comp.id)).toBe(true);
    await flush();
    vi.advanceTimersByTime(500);
    expect(editor.getNode(a.id)).toBe(a);
    expect(pinStore.has(a.id)).toBe(true);
    expect(collapseStore.get(a.id)).toBe(true);
    expect(syncTopology).not.toHaveBeenCalled();
    expect(s.history.stack.length).toBe(history);
  });
});
