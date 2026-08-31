import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs, getEditor } from "../../src/graph/process";
import {
  setActiveGraph,
  isSubgraphActive,
  getActiveEditor,
  getOwningEditor,
  getOwningView,
} from "../../src/graph/activeGraph";

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
const fakeView = {} as unknown as View;
const subView = { sub: true } as unknown as View;

const main = fakeEditor(["m1", "m2"]);
const sub = fakeEditor(["s1", "s2"]);

beforeEach(() => {
  // engine is unused by the resolver; a bare object satisfies the ref setter.
  setEditorRefs(main, {} as never, fakeView);
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
    setActiveGraph({ editor: sub, view: fakeView });
    expect(isSubgraphActive()).toBe(true);
    expect(getActiveEditor()).toBe(sub);
  });

  it("CARDINAL: getEditor() (persistence source) stays MAIN even while drilled in", () => {
    setActiveGraph({ editor: sub, view: fakeView });
    expect(getEditor()).toBe(main); // an autosave here must serialize the document, not the subgraph
  });

  it("getOwningEditor returns the graph that actually HOLDS the node", () => {
    setActiveGraph({ editor: sub, view: fakeView });
    expect(getOwningEditor("s1")).toBe(sub); // internal node → internal editor
    expect(getOwningEditor("m1")).toBe(main); // a MAIN node is never routed to the override
  });

  it("getOwningView mirrors getOwningEditor (per-node, not per-surface)", () => {
    expect(getOwningView("m1")).toBe(fakeView); // no drill-in → main view
    setActiveGraph({ editor: sub, view: subView });
    expect(getOwningView("s1")).toBe(subView); // internal node → drill-in view
    // A MAIN node re-rendering BEHIND an open drill-in must still hit the main
    // view (getActiveView() would wrongly return the drill-in here).
    expect(getOwningView("m1")).toBe(fakeView);
    setActiveGraph(null);
    expect(getOwningView("s1")).toBe(fakeView); // closed → main (s1 unresolvable)
  });

  it("clears back to main on close", () => {
    setActiveGraph({ editor: sub, view: fakeView });
    setActiveGraph(null);
    expect(isSubgraphActive()).toBe(false);
    expect(getActiveEditor()).toBe(main);
    expect(getOwningEditor("s1")).toBe(main); // sub no longer owns anything resolvable
  });
});
