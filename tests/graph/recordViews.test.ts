// [[B11]] maximalMerge
import { describe, it, expect } from "vitest";
import { writeTextForm, readTextForm } from "../../src/graph/textForm";
import type { SavedGraph } from "../../src/graph/persistence";
import { RecordNode, parseRecordLayout } from "../../src/graph/nodes/visual";
import { recordFieldText, recordLaneText, titleIndexFor, type RecordPayload } from "../../src/graph/chartValue";
import type { FrameValue } from "../../src/graph/frame";
import { settingsStore } from "../../src/graph/settingsStore";

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

describe("Record title-row #field marker", () => {
  it("parses a leading # as the title flag, name stripped", () => {
    const placed = parseRecordLayout("#SKU | Qty");
    expect(placed.find((p) => p.name === "SKU")?.title).toBe(true);
    expect(placed.find((p) => p.name === "Qty")?.title).toBeFalsy();
    expect(placed.some((p) => p.name === "#SKU")).toBe(false); // the # is not part of the name
  });

  it("a marked field (even non-first) is the title titleIndexFor points at", async () => {
    const rec = new RecordNode({ op: "list" });
    rec.stringLiterals.layout = "Qty | #Item"; // Item marked though it is second
    const p = (await rec.data({ frame: [frame] })).chart.payload as RecordPayload;
    const ti = titleIndexFor(p.cards[0]);
    expect(p.cards[0][ti].label).toBe("Item");
    expect(p.cards[0][ti].isTitle).toBe(true);
  });
});

describe("Record clamp option", () => {
  it("clamp=on sets payload.clamp on a gallery", async () => {
    const rec = new RecordNode({ op: "gallery" });
    rec.stringLiterals.options = "clamp=on";
    const p = (await rec.data({ frame: [frame] })).chart.payload as RecordPayload;
    expect(p.clamp).toBe(true);
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

describe("Record views read a cell as the Cards view does", () => {
  const formatted: FrameValue = {
    __frame: true,
    columns: [
      { name: "Due", type: "date", values: [45000], format: { format: "date_custom", customPattern: "YYYY-MM-DD", unit: "none" } },
      { name: "Share", type: "number", values: [0.256], format: { format: "percent", decimalDigits: 1, unit: "none" } },
      { name: "Lane", type: "number", values: [0.5], format: { format: "percent", decimalDigits: 0, unit: "none" } },
    ],
  };
  const text = (f: RecordPayload["cards"][number][number]) => recordFieldText(f);

  for (const op of ["detail", "gallery", "list", "board"] as const) {
    it(`${op} honors the column formats`, async () => {
      const rec = new RecordNode({ op });
      if (op === "board") rec.stringLiterals.by = "Lane";
      const p = (await rec.data({ frame: [formatted] })).chart.payload as RecordPayload;
      const fields = p.cards[0];
      expect(text(fields.find((f) => f.label === "Due")!)).toBe("2023-03-15");
      expect(text(fields.find((f) => f.label === "Share")!)).toBe("25.6%");
      if (op === "board") expect(recordLaneText(p.lanes![0])).toBe("50%");
    });
  }
});

describe("a board's number lanes", () => {
  it("keep their number, so a Decimal places change shows on the heading without a recompute ([[D94]] oneNumberDisplay)", async () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "Lane", type: "number", values: [1.23456, 1.23456, 2] }] };
    const rec = new RecordNode({ op: "board" });
    rec.stringLiterals.by = "Lane";
    const p = (await rec.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p.lanes?.map((l) => l.cards)).toEqual([[0, 1], [2]]);
    try {
      settingsStore.set("numberDecimals", "2");
      expect(p.lanes?.map(recordLaneText)).toEqual(["1.23", "2"]);
    } finally {
      settingsStore.set("numberDecimals", "4");
    }
    expect(recordLaneText(p.lanes![0])).toBe("1.2346");
  });
});
