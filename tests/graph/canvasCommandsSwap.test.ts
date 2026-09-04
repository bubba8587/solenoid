import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { setDeleteSelected, deleteSelected, swapDeleteSlot } from "../../src/graph/canvasCommands";

// The mobile / tablet Delete BUTTON goes through the canvasCommands.deleteSelected() slot
// (not RF's per-surface Delete key), so a drill-in must swap that slot to its own editor or
// the button deletes from MAIN. This pins the swap + restore, mirroring swapArrangeSlots /
// swapSelectionSlots. (E2 — compositeToolbarReroute.)

function emptier(editor: NodeEditor<Schemes>) {
  return async () => {
    for (const n of editor.getNodes()) await editor.removeNode(n.id);
  };
}
async function withNode(editor: NodeEditor<Schemes>) {
  const n = new ClassicPreset.Node("N") as unknown as Schemes["Node"];
  await editor.addNode(n);
  return n.id;
}

describe("swapDeleteSlot — the delete verb follows the active surface", () => {
  it("deleteSelected() targets the drill-in editor while swapped, MAIN again after restore", async () => {
    const main = new NodeEditor<Schemes>();
    const drill = new NodeEditor<Schemes>();
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
