import { describe, it, expect } from "vitest";
import { writeTextForm, readTextForm } from "../../src/graph/textForm";
import type { SavedGraph } from "../../src/graph/persistence";
import { RecordNode } from "../../src/graph/nodes/visual";
import { titleIndexFor, type RecordPayload } from "../../src/graph/chartValue";
import type { FrameValue } from "../../src/graph/frame";

// Record 1.4 B1 (trimmed): the List op + the `cardsize` gallery preset.

const frame: FrameValue = {
  __frame: true,
  columns: [
    { name: "Item", type: "string", values: ["Bolt M4", "Nut M4"] },
    { name: "Qty", type: "number", values: [40, 120] },
    { name: "Price", type: "number", values: [0.35, 0.12] },
  ],
};

describe("Record op + option round-trip through the text form", () => {
  it("op=list and the cardsize option survive a write→read→write", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [{
        id: "r", type: "RecordNode", name: "Parts", x: 0, y: 0,
        init: { label: "Parts", op: "list" },
        stringLiterals: { options: "cardsize=l" },
      }],
      connections: [],
    };
    const t1 = writeTextForm(g);
    const reloaded = readTextForm(t1);
    const rn = reloaded.nodes.find((n) => n.type === "RecordNode");
    expect(rn?.init?.op).toBe("list");
    expect(rn?.stringLiterals?.options).toContain("cardsize=l");
    expect(writeTextForm(reloaded)).toBe(t1); // idempotent
  });
});

describe("Record List op — indented outline", () => {
  it("draws every row, view=list, first field is the title", async () => {
    const rec = new RecordNode({ op: "list" });
    const { chart } = await rec.data({ frame: [frame] });
    const p = chart.payload as RecordPayload;
    expect(p.view).toBe("list");
    expect(p.cards.length).toBe(2);          // one block per record
    expect(titleIndexFor(p.cards[0])).toBe(0); // the ONE title seam → first field
    expect(p.cards[0][0].label).toBe("Item");  // title field
    expect(p.cards[0].length).toBe(3);         // title + two trailing fields
  });
});

describe("Record gallery — cardsize preset", () => {
  it("carries the size onto the gallery payload; other sizes read s/m/l", async () => {
    const rec = new RecordNode({ op: "gallery" });
    rec.stringLiterals.options = "cardsize=l";
    const p = (await rec.data({ frame: [frame] })).chart.payload as RecordPayload;
    expect(p.view).toBe("gallery");
    expect(p.size).toBe("l");
  });

  it("no cardsize option leaves size unset (medium default in the renderer)", async () => {
    const rec = new RecordNode({ op: "gallery" });
    const p = (await rec.data({ frame: [frame] })).chart.payload as RecordPayload;
    expect(p.size).toBeUndefined();
  });
});
