import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import type { AreaPlugin } from "rete-area-plugin";
import { setEditorRefs, getEditor } from "./process";
import {
  setActiveGraph,
  isSubgraphActive,
  getActiveEditor,
  getOwningEditor,
  getOwningArea,
} from "./activeGraph";

// The action layer (keyboard, copy/paste, right-click, in-node socket/row edits)
// resolves through getActive*/getOwningEditor so a Composite drill-in is first-class.
// The CARDINAL SAFETY INVARIANT: persistence/serialize read process.ts getEditor()
// DIRECTLY — those must ALWAYS see the MAIN graph, never the drill-in override, or
// an autosave while drilled in would write the subgraph OVER the document. This test
// locks that split at the resolver boundary.

function fakeEditor(ids: string[]): NodeEditor<Schemes> {
  const nodes = new Map(ids.map((id) => [id, { id }]));
  return { getNode: (id: string) => nodes.get(id) } as unknown as NodeEditor<Schemes>;
}
const fakeArea = {} as unknown as AreaPlugin<Schemes, AreaExtra>;
const subArea = { sub: true } as unknown as AreaPlugin<Schemes, AreaExtra>;

const main = fakeEditor(["m1", "m2"]);
const sub = fakeEditor(["s1", "s2"]);

beforeEach(() => {
  // engine is unused by the resolver; a bare object satisfies the ref setter.
  setEditorRefs(main, {} as never, fakeArea);
  setActiveGraph(null);
});
afterEach(() => setActiveGraph(null));

describe("activeGraph resolver", () => {
  it("defaults to main with no drill-in open", () => {
    expect(isSubgraphActive()).toBe(false);
    expect(getActiveEditor()).toBe(main);
    expect(getOwningEditor("m1")).toBe(main);
  });

  it("routes the ACTION layer to the subgraph while drilled in", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    expect(isSubgraphActive()).toBe(true);
    expect(getActiveEditor()).toBe(sub);
  });

  it("CARDINAL: getEditor() (persistence source) stays MAIN even while drilled in", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    expect(getEditor()).toBe(main); // an autosave here must serialize the document, not the subgraph
  });

  it("getOwningEditor returns the graph that actually HOLDS the node", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    expect(getOwningEditor("s1")).toBe(sub); // internal node → internal editor
    expect(getOwningEditor("m1")).toBe(main); // a MAIN node is never routed to the override
  });

  it("getOwningArea mirrors getOwningEditor (per-node, not per-surface)", () => {
    expect(getOwningArea("m1")).toBe(fakeArea); // no drill-in → main area
    setActiveGraph({ editor: sub, area: subArea });
    expect(getOwningArea("s1")).toBe(subArea); // internal node → drill-in area
    // A MAIN node re-rendering BEHIND an open drill-in must still hit the main
    // area (getActiveArea() would wrongly return the drill-in here).
    expect(getOwningArea("m1")).toBe(fakeArea);
    setActiveGraph(null);
    expect(getOwningArea("s1")).toBe(fakeArea); // closed → main (s1 unresolvable)
  });

  it("clears back to main on close", () => {
    setActiveGraph({ editor: sub, area: fakeArea });
    setActiveGraph(null);
    expect(isSubgraphActive()).toBe(false);
    expect(getActiveEditor()).toBe(main);
    expect(getOwningEditor("s1")).toBe(main); // sub no longer owns anything resolvable
  });
});
