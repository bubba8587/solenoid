import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import type { AreaPlugin } from "rete-area-plugin";
import { setEditorRefs } from "./process";
import { setActiveGraph } from "./activeGraph";
import { isolateStore } from "./isolateStore";
import { isolateSelection, isolateNodes } from "./isolate";

// Isolate resolves through the ACTIVE editor so the focus-set works inside a
// composite drill-in too (the drill-in node cards read the same global
// isolateStore). This locks that the entry points read getActiveEditor(), not
// getEditor() (main). See activeGraph.test.ts for the persistence-side split.

type FakeNode = { id: string; selected?: boolean };

function fakeEditor(nodes: FakeNode[]): NodeEditor<Schemes> {
  const map = new Map(nodes.map((n) => [n.id, n]));
  return {
    getNode: (id: string) => map.get(id),
    getNodes: () => nodes,
    getConnections: () => [],
  } as unknown as NodeEditor<Schemes>;
}
const fakeArea = {} as unknown as AreaPlugin<Schemes, AreaExtra>;

const main = fakeEditor([{ id: "m1", selected: true }, { id: "m2" }]);
const sub = fakeEditor([{ id: "s1", selected: true }, { id: "s2", selected: true }, { id: "s3" }]);

beforeEach(() => {
  setEditorRefs(main, {} as never, fakeArea);
  setActiveGraph(null);
  isolateStore.exit();
});
afterEach(() => {
  setActiveGraph(null);
  isolateStore.exit();
});

describe("isolate resolves through the active graph", () => {
  it("isolates the MAIN selection when no drill-in is open", () => {
    expect(isolateSelection()).toBe(true);
    expect([...(isolateStore.get() ?? [])]).toEqual(["m1"]);
  });

  it("isolates the SUBGRAPH selection while drilled in", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    expect(isolateSelection()).toBe(true);
    const focus = isolateStore.get()!;
    expect(focus.has("s1")).toBe(true);
    expect(focus.has("s2")).toBe(true);
    expect(focus.has("s3")).toBe(false); // not selected
    expect(focus.has("m1")).toBe(false); // a main node never enters the subgraph focus set
  });

  it("isolateNodes targets the active editor's nodes", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    expect(isolateNodes(["s3"])).toBe(true);
    expect([...(isolateStore.get() ?? [])]).toEqual(["s3"]);
  });
});
