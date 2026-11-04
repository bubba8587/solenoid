// [[A1]], [[B3]], [[react-flow-surface-contract#One surface for both canvases]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphNode } from "../../src/graph/graphModel";
import type { Schemes } from "../../src/graph/schemes";
import { setDeleteSelected, deleteSelected, swapDeleteSlot, setRepositionDocked, repositionDockedNodes, swapRepositionDockedSlot } from "../../src/graph/canvasCommands";


function emptier(editor: GraphEditor<Schemes>) {
  return async () => {
    for (const n of editor.getNodes()) await editor.removeNode(n.id);
  };
}
async function withNode(editor: GraphEditor<Schemes>) {
  const n = new GraphNode("N") as unknown as Schemes["Node"];
  await editor.addNode(n);
  return n.id;
}

describe("swapDeleteSlot — the delete verb follows the active surface", () => {
  it("deleteSelected() targets the drill-in editor while swapped, MAIN again after restore", async () => {
    const main = new GraphEditor<Schemes>();
    const drill = new GraphEditor<Schemes>();
    await withNode(main);
    await withNode(drill);
    setDeleteSelected(emptier(main)); // main FlowCanvas registers its editor

    const restore = swapDeleteSlot(emptier(drill)); // the drill-in swaps in on open
    await deleteSelected(); // the mobile button verb
    expect(drill.getNodes().length).toBe(0); // deleted from the drill-in
    expect(main.getNodes().length).toBe(1);  // MAIN untouched

    restore(); // drill-in closes
    await deleteSelected();
    expect(main.getNodes().length).toBe(0); // the verb is back on MAIN
  });
});

describe("swapRepositionDockedSlot — docked-FC reposition follows the active surface", () => {
  it("routes to the drill-in reposition while swapped, MAIN again after restore", () => {
    const seen: string[] = [];
    setRepositionDocked((id) => seen.push(`main:${id}`)); // main FlowCanvas registers

    repositionDockedNodes("host1");
    expect(seen).toEqual(["main:host1"]);

    const restore = swapRepositionDockedSlot((id) => seen.push(`drill:${id}`)); // drill-in opens
    repositionDockedNodes("host2");
    expect(seen).toEqual(["main:host1", "drill:host2"]); // the drill-in level handled it

    restore(); // drill-in closes
    repositionDockedNodes("host3");
    expect(seen).toEqual(["main:host1", "drill:host2", "main:host3"]); // back on MAIN
  });
});
