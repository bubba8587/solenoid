import { describe, it, expect } from "vitest";
import {
  inferColumn,
  getColumn,
  frameFromCells,
  frameFromInputText,
  frameColumnsToInputText,
  parseFrameSource,
  frameSourceToText,
  deriveFrame,
  type FrameSource,
  frameRowCount,
  isFrameValue,
  makeHeaders,
  buildFrame,
  buildFrameTyped,
  typedColumn,
  colTypeForSocket,
  addColumn,
  frameHasTextColumns,
} from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/date";
import { BuildFrameNode, FrameFromListsNode } from "../../src/graph/nodes/frame";
import { MutableSocket } from "../../src/graph/sockets";
import { solError } from "../../src/graph/errorValue";

// ─── isFrameValue ─────────────────────────────────────────────────────────────

describe("isFrameValue", () => {
  it("true for a built frame", () => {
    const f = frameFromCells(["A"], [[1], [2]]);
    expect(isFrameValue(f)).toBe(true);
  });

  it("false for non-frames", () => {
    expect(isFrameValue(null)).toBe(false);
    expect(isFrameValue(undefined)).toBe(false);
    expect(isFrameValue(42)).toBe(false);
    expect(isFrameValue("hello")).toBe(false);
    expect(isFrameValue([1, 2, 3])).toBe(false);
    expect(isFrameValue({})).toBe(false);
    expect(isFrameValue({ __frame: false })).toBe(false);
  });
});

// ─── inferColumn ──────────────────────────────────────────────────────────────

describe("inferColumn", () => {
  it("infers number for all-numeric cells", () => {
    const col = inferColumn("Score", [1, 2, 3]);
    expect(col.type).toBe("number");
    expect(col.values).toEqual([1, 2, 3]);
  });

  it("infers number for numeric strings", () => {
    const col = inferColumn("Price", ["10", "20.5", "1,234"]);
    expect(col.type).toBe("number");
    expect(col.values[0]).toBe(10);
    expect(col.values[1]).toBe(20.5);
    expect(col.values[2]).toBe(1234);
  });

  it("keeps thousands-grouped numbers numeric but NOT the European decimal comma (audit P0-7)", () => {
    const grouped = inferColumn("Big", ["1,234", "12,345.6", "1,234,567"]);
    expect(grouped.type).toBe("number");
    expect(grouped.values).toEqual([1234, 12345.6, 1234567]);
    // "3,5" is ambiguous (3.5 to half the world) — it must stay TEXT, never 35.
    const euro = inferColumn("Euro", ["3,5", "12,75"]);
    expect(euro.type).toBe("string");
    expect(euro.values).toEqual(["3,5", "12,75"]);
    // malformed grouping is not a number either
    expect(inferColumn("Bad", ["12,34"]).type).toBe("string");
  });

  it("infers date for ISO date strings; stores as serials", () => {
    const dates = ["2026-01-03", "2026-06-15", "2025-12-31"];
    const col = inferColumn("Date", dates);
    expect(col.type).toBe("date");
    expect(col.values).toHaveLength(3);
    // Values must be finite numbers (serials), matching parseDateToSerial
    for (let i = 0; i < dates.length; i++) {
      expect(typeof col.values[i]).toBe("number");
      expect(Number.isFinite(col.values[i])).toBe(true);
      expect(col.values[i]).toBe(parseDateToSerial(dates[i]));
    }
  });

  it("infers string for free text", () => {
    const col = inferColumn("Name", ["Alice", "Bob", "Carol"]);
    expect(col.type).toBe("string");
    expect(col.values).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("infers string for mixed numeric + text", () => {
    const col = inferColumn("Mixed", [1, "hello", 3]);
    expect(col.type).toBe("string");
  });

  it("maps blank/null cells to null in all types", () => {
    const numCol = inferColumn("N", [1, null, 3, ""]);
    expect(numCol.type).toBe("number");
    expect(numCol.values[1]).toBe(null);
    expect(numCol.values[3]).toBe(null);

    const strCol = inferColumn("S", ["a", null, "c", ""]);
    expect(strCol.type).toBe("string");
    expect(strCol.values[1]).toBe(null);
    expect(strCol.values[3]).toBe(null);

    const dateCol = inferColumn("D", ["2026-01-03", null, "2026-06-15", ""]);
    expect(dateCol.type).toBe("date");
    expect(dateCol.values[1]).toBe(null);
    expect(dateCol.values[3]).toBe(null);
  });

  it("all-blank column infers string (no non-blank cells to detect numeric)", () => {
    const col = inferColumn("Empty", [null, null, ""]);
    // No non-blank cells → not numeric → not date → string
    expect(col.type).toBe("string");
  });

  it("does NOT infer date for ambiguous formats (bare years, locale dates)", () => {
    const col = inferColumn("Ambiguous", ["1/2/26", "2026", "Jan 3 2026"]);
    // Conservative ISO-only detection — none of these match YYYY-MM-DD
    expect(col.type).not.toBe("date");
  });

  it("preserves the column name", () => {
    const col = inferColumn("Revenue", [100, 200]);
    expect(col.name).toBe("Revenue");
  });
});

// ─── getColumn ────────────────────────────────────────────────────────────────

describe("getColumn", () => {
  const f = frameFromCells(["Alpha", "Beta", "Gamma"], [
    [1, 2, 3],
    [4, 5, 6],
  ]);

  it("looks up by exact name (trimmed, case-sensitive), null on a miss", () => {
    const col = getColumn(f, "Beta");
    expect(col!.name).toBe("Beta");
    expect(col!.values).toEqual([2, 5]);
    expect(getColumn(f, " Beta ")).not.toBeNull(); // key is trimmed
    expect(getColumn(f, "Delta")).toBeNull();
    expect(getColumn(f, "")).toBeNull();
    expect(getColumn(f, "alpha")).toBeNull(); // case-sensitive
  });

  it("looks up by 1-based index string, null out of range", () => {
    expect(getColumn(f, "1")!.name).toBe("Alpha");
    expect(getColumn(f, "3")!.name).toBe("Gamma");
    expect(getColumn(f, "0")).toBeNull();
    expect(getColumn(f, "4")).toBeNull();
  });
});

// ─── frameFromCells ───────────────────────────────────────────────────────────

describe("frameFromCells", () => {
  it("produces the right column count and names", () => {
    const f = frameFromCells(["X", "Y", "Z"], [[1, 2, 3]]);
    expect(f.columns).toHaveLength(3);
    expect(f.columns.map((c) => c.name)).toEqual(["X", "Y", "Z"]);
  });

  it("frameRowCount matches the row count", () => {
    const f = frameFromCells(["A", "B"], [[1, 2], [3, 4], [5, 6]]);
    expect(frameRowCount(f)).toBe(3);
  });

  it("column types come from inferColumn (numeric → number, dates → date)", () => {
    const f = frameFromCells(
      ["Num", "Label", "Date"],
      [
        [42, "foo", "2026-01-03"],
        [99, "bar", "2026-06-15"],
      ],
    );
    expect(f.columns[0].type).toBe("number");
    expect(f.columns[1].type).toBe("string");
    expect(f.columns[2].type).toBe("date");
  });

  it("date column values are serials", () => {
    const f = frameFromCells(["D"], [["2026-01-03"], ["2026-06-15"]]);
    expect(typeof f.columns[0].values[0]).toBe("number");
    expect(f.columns[0].values[0]).toBe(parseDateToSerial("2026-01-03"));
    expect(f.columns[0].values[1]).toBe(parseDateToSerial("2026-06-15"));
  });

  it("is a valid FrameValue", () => {
    const f = frameFromCells(["A"], [[1]]);
    expect(isFrameValue(f)).toBe(true);
  });

  it("handles empty rows (zero-row frame)", () => {
    const f = frameFromCells(["A", "B"], []);
    expect(f.columns).toHaveLength(2);
    expect(frameRowCount(f)).toBe(0);
  });
});

// ─── makeHeaders ─────────────────────────────────────────────────────────────

describe("makeHeaders", () => {
  it("uses provided names", () => {
    expect(makeHeaders(["A", "B", "C"], 3)).toEqual(["A", "B", "C"]);
  });

  it("fills blanks with Col{i+1}", () => {
    expect(makeHeaders(["A", "", "C"], 3)).toEqual(["A", "Col2", "C"]);
    expect(makeHeaders(undefined, 3)).toEqual(["Col1", "Col2", "Col3"]);
  });

  it("de-dupes duplicate names left to right", () => {
    expect(makeHeaders(["Date", "Name", "Date"], 3)).toEqual(["Date", "Name", "Date2"]);
    expect(makeHeaders(["X", "X", "X"], 3)).toEqual(["X", "X2", "X3"]);
  });
});

// ─── frameRowCount ────────────────────────────────────────────────────────────

describe("frameRowCount", () => {
  it("returns 0 for a frame with no rows", () => {
    const f = buildFrame([], ["A"]);
    expect(frameRowCount(f)).toBe(0);
  });

  it("returns the max column length (handles ragged columns)", () => {
    const f = frameFromCells(["A", "B"], [[1, 2], [3, 4], [5, 6]]);
    expect(frameRowCount(f)).toBe(3);
  });
});

// ─── addColumn ───────────────────────────────────────────────────────────────

describe("addColumn", () => {
  it("appends a new column", () => {
    const f = frameFromCells(["A"], [[1], [2]]);
    const f2 = addColumn(f, "B", [10, 20]);
    expect(f2.columns).toHaveLength(2);
    expect(f2.columns[1].name).toBe("B");
    expect(f2.columns[1].values).toEqual([10, 20]);
  });

  it("replaces an existing column when name matches", () => {
    const f = frameFromCells(["A"], [[1], [2]]);
    const f2 = addColumn(f, "A", [99, 88]);
    expect(f2.columns).toHaveLength(1);
    expect(f2.columns[0].values).toEqual([99, 88]);
  });

  it("de-dupes the name when appending a duplicate", () => {
    const f = frameFromCells(["A", "B"], [[1, 2]]);
    const f2 = addColumn(f, "A", [99]);
    // "A" exists → replace; same test ensures addColumn doesn't add a phantom
    expect(f2.columns).toHaveLength(2);
    expect(f2.columns[0].values).toEqual([99]);
  });
});

// The AddColumnNode pads a values list SHORTER than the frame to the row count with
// blanks (the catalog says "Shorter lists pad with blanks"); the pad is the node's own
// Math.max logic, not addColumn's, so it needs a node-level pin.
describe("Add Column pads a short list with blanks", () => {
  it("a values list shorter than the frame's rows fills the rest with null", async () => {
    const { AddColumnNode } = await import("../../src/graph/nodes/frame");
    const f = frameFromCells(["a"], [[1], [2], [3]]); // three rows
    const node = new AddColumnNode({ addAs: "number" });
    node.stringLiterals.name = "b";
    const out = node.data({ frame: [f], values: [[10]] }).frame!; // one value
    expect(getColumn(out, "b")!.values).toEqual([10, null, null]);
  });
});

// A ragged numeric matrix (rows of unequal length) pads each short row's missing trailing
// cells to the widest row with blanks. typedColumn's ragged path is pinned above; this is
// the NUMERIC buildFrame path, which fills undefined → null itself.
describe("buildFrame — ragged rows pad to the widest row with blanks", () => {
  it("short rows fill missing trailing cells with null; headers auto-fill", () => {
    const f = buildFrame([[1, 2, 3], [4]]);
    expect(f.columns.map((c) => c.name)).toEqual(["Col1", "Col2", "Col3"]);
    expect(f.columns[0].values).toEqual([1, 4]);
    expect(f.columns[1].values).toEqual([2, null]);
    expect(f.columns[2].values).toEqual([3, null]);
  });
});

// ─── frameHasTextColumns ─────────────────────────────────────────────────────

describe("frameHasTextColumns", () => {
  it("false when all columns are numeric", () => {
    const f = frameFromCells(["A", "B"], [[1, 2]]);
    expect(frameHasTextColumns(f)).toBe(false);
  });

  it("true when at least one column is string", () => {
    const f = frameFromCells(["Num", "Label"], [[42, "foo"]]);
    expect(frameHasTextColumns(f)).toBe(true);
  });

  it("false for date columns (date serials don't block the matrix)", () => {
    const f = frameFromCells(["D"], [["2026-01-03"]]);
    expect(f.columns[0].type).toBe("date");
    expect(frameHasTextColumns(f)).toBe(false);
  });
});

describe("frameFromInputText — a blank CSV cell is null, not 0 (round-trips)", () => {
  it("CSV: a blank numeric cell imports as null", () => {
    const f = frameFromInputText("vals, tag\n1, a\n, b\n3, c\n4, d");
    expect(getColumn(f, "vals")?.values).toEqual([1, null, 3, 4]);
    expect(getColumn(f, "tag")?.values).toEqual(["a", "b", "c", "d"]);
  });
  it("JSON round-trip preserves null (the edit-and-save path)", () => {
    // The popup saves edits as JSON (frameColumnsToInputText); reopening re-parses it.
    const f = frameFromInputText("a, b\n1, \n, 4");
    const back = frameFromInputText(frameColumnsToInputText(f.columns));
    expect(getColumn(back, "a")?.values).toEqual([1, null]);
    expect(getColumn(back, "b")?.values).toEqual([null, 4]);
  });
});

// ─── Logical columns + per-cell errors (array-semantics policy) ─────────────────

describe("logical columns", () => {
  it("inferColumn detects TRUE/FALSE (case-insensitive) → logical with real booleans", () => {
    const col = inferColumn("Flag", ["TRUE", "false", "True", ""]);
    expect(col.type).toBe("logical");
    expect(col.values).toEqual([true, false, true, null]);
  });

  it("a 0/1 column stays NUMERIC (the spreadsheet mask trick), not logical", () => {
    const col = inferColumn("Mask", [0, 1, 1, 0]);
    expect(col.type).toBe("number");
  });

  it("Get Column reads a logical column as 1/0 numbers", async () => {
    const { GetColumnNode } = await import("../../src/graph/nodes/frame");
    const f = frameFromCells(["Flag"], [["TRUE"], ["FALSE"], [""]]);
    const node = new GetColumnNode({ readAs: "number" });
    node.stringLiterals.name = "Flag";
    expect(node.data({ frame: [f] }).values).toEqual([1, 0, null]);
  });

  it("Get Column reads a logical column as text as TRUE/FALSE", async () => {
    const { GetColumnNode } = await import("../../src/graph/nodes/frame");
    const f = frameFromCells(["Flag"], [["true"], ["false"]]);
    const node = new GetColumnNode({ readAs: "text" });
    node.stringLiterals.name = "Flag";
    expect(node.data({ frame: [f] }).values).toEqual(["TRUE", "FALSE"]);
  });

  it("a logical column splits to a 1/0 numeric matrix", async () => {
    const { splitFrame } = await import("../../src/graph/frame");
    const f = frameFromCells(["a", "b"], [["TRUE", "1"], ["FALSE", "2"]]);
    // 'a' is logical, 'b' numeric → no text column → clean numeric matrix
    expect(splitFrame(f).matrix).toEqual([[1, 1], [0, 2]]);
  });

  it("Split Frame filters columns by type (the colType toggle)", async () => {
    const { SplitFrameNode } = await import("../../src/graph/nodes/frame");
    const f: any = {
      __frame: true,
      columns: [
        { name: "City", type: "string", values: ["A", "B"] },
        { name: "Pop", type: "number", values: [10, 20] },
        { name: "Founded", type: "date", values: [44000, 45000] },
        { name: "Area", type: "number", values: [5, 6] },
      ],
    };

    // num → only the two number columns, as a matrix + their headers
    const numOut = new SplitFrameNode({ colType: "number" }).data({ frame: [f] });
    expect(numOut.headers).toEqual(["Pop", "Area"]);
    expect(numOut.matrix).toEqual([[10, 5], [20, 6]]);

    // date → date serials matrix + the date header
    const dateOut = new SplitFrameNode({ colType: "date" }).data({ frame: [f] });
    expect(dateOut.headers).toEqual(["Founded"]);
    expect(dateOut.matrix).toEqual([[44000], [45000]]);

    // text → the text columns as a STRING matrix
    const textOut = new SplitFrameNode({ colType: "string" }).data({ frame: [f] });
    expect(textOut.headers).toEqual(["City"]);
    expect(textOut.matrix).toEqual([["A"], ["B"]]);

    // all → every header; matrix null because the mixed frame has a text column
    const allOut = new SplitFrameNode({ colType: "all" }).data({ frame: [f] });
    expect(allOut.headers).toEqual(["City", "Pop", "Founded", "Area"]);
    expect(allOut.matrix).toBeNull();

    // text → a STRING matrix of the text columns (not null)
    const f2: any = {
      __frame: true,
      columns: [
        { name: "City", type: "string", values: ["A", "B"] },
        { name: "Note", type: "string", values: ["x", null] },
        { name: "Pop", type: "number", values: [10, 20] },
      ],
    };
    const txt = new SplitFrameNode({ colType: "string" }).data({ frame: [f2] });
    expect(txt.headers).toEqual(["City", "Note"]);
    expect(txt.matrix).toEqual([["A", "x"], ["B", ""]]);
  });

  it("Split Frame's Matrix output socket type tracks the colType", async () => {
    const { splitMatrixOutput } = await import("../../src/graph/nodes/frame");
    const dt = (ct: any) => (splitMatrixOutput(ct).socket as any).dataType;
    expect(dt("all")).toBe("table");
    expect(dt("number")).toBe("table");
    expect(dt("date")).toBe("datetable");
    expect(dt("logical")).toBe("logicaltable");
    expect(dt("string")).toBe("strtable");
  });
});

describe("per-cell errors in a frame", () => {
  it("formatFrameCell renders a logical as TRUE/FALSE and an error as its code", async () => {
    const { formatFrameCell } = await import("../../src/graph/frame");
    const { solError } = await import("../../src/graph/errorValue");
    expect(formatFrameCell("logical", true)).toBe("TRUE");
    expect(formatFrameCell("logical", false)).toBe("FALSE");
    expect(formatFrameCell("number", solError("#DIV/0!", "x"))).toBe("#DIV/0!");
  });

  it("Add Column carries a per-cell error into the new column verbatim", async () => {
    const { AddColumnNode } = await import("../../src/graph/nodes/frame");
    const { solError, isSolError } = await import("../../src/graph/errorValue");
    const f = frameFromCells(["a"], [[1], [2], [3]]);
    const node = new AddColumnNode({ addAs: "number" });
    node.stringLiterals.name = "b";
    const err = solError("#DIV/0!", "boom");
    const out = node.data({ frame: [f], values: [[10, err, 30]] }).frame!;
    const col = getColumn(out, "b")!;
    expect(col.values[0]).toBe(10);
    expect(isSolError(col.values[1]) && (col.values[1] as { code: string }).code).toBe("#DIV/0!");
    expect(col.values[2]).toBe(30);
  });

  it("Add Column add-as logical writes a real logical column (TRUE/FALSE)", async () => {
    const { AddColumnNode } = await import("../../src/graph/nodes/frame");
    const f = frameFromCells(["a"], [[1], [2], [3]]);
    const node = new AddColumnNode({ addAs: "logical" });
    node.stringLiterals.name = "flag";
    // A logicallist input arrives already coerced to booleans (coerceInputs);
    // null (missing) is carried verbatim.
    const out = node.data({ frame: [f], values: [[true, false, null]] }).frame!;
    const col = getColumn(out, "flag")!;
    expect(col.type).toBe("logical");
    expect(col.values).toEqual([true, false, null]);
  });

  it("Get Column propagates a per-cell error when reading as number", async () => {
    const { GetColumnNode, AddColumnNode } = await import("../../src/graph/nodes/frame");
    const { solError, isSolError } = await import("../../src/graph/errorValue");
    const f0 = frameFromCells(["a"], [[1], [2]]);
    const add = new AddColumnNode({ addAs: "number" });
    add.stringLiterals.name = "b";
    const f1 = add.data({ frame: [f0], values: [[solError("#VALUE!", "x"), 9]] }).frame!;
    const get = new GetColumnNode({ readAs: "number" });
    get.stringLiterals.name = "b";
    const vals = get.data({ frame: [f1] }).values as unknown[];
    expect(isSolError(vals[0]) && (vals[0] as { code: string }).code).toBe("#VALUE!");
    expect(vals[1]).toBe(9);
  });
});

// ─── Persistence (Inc 7): logical + null survive the frameText round-trip ───────
// A Frame Input persists via its `frameText` string (extractInit → save → reload →
// frameFromInputText). Logical columns + null cells must come back intact; computed
// errors/logicals are never stored (they regenerate on recompute), so the save
// format needs no new fields.

describe("frameText persistence round-trip", () => {
  it("a CSV frameText re-infers a TRUE/FALSE column as logical on reload", () => {
    const f = frameFromInputText("flag, n\nTRUE, 1\nFALSE, 2\n, 3");
    const col = getColumn(f, "flag")!;
    expect(col.type).toBe("logical");
    expect(col.values).toEqual([true, false, null]);
  });

  it("a JSON frameText preserves an explicit logical column + null", () => {
    const original = frameFromCells(["flag"], [["TRUE"], [""], ["FALSE"]]);
    expect(original.columns[0].type).toBe("logical"); // a blank doesn't break inference
    // The JSON form is what the popup/save writes; reopening re-parses it.
    const json = frameColumnsToInputText(original.columns);
    const back = frameFromInputText(json);
    const col = getColumn(back, "flag")!;
    expect(col.type).toBe("logical");
    expect(col.values).toEqual([true, null, false]);
  });
});

describe("Frame Input is a LITERAL source — never rewrites what you typed", () => {
  it("preserves mixed 1/TRUE literals in a Boolean column across a save round-trip", () => {
    // A logical column the user typed with BOTH numeric and word literals.
    const source: FrameSource = [
      { name: "flag", type: "logical", cells: ["1", "TRUE", "0", "FALSE"] },
    ];
    // Save → reload returns the EXACT text (the bug was "1" → "TRUE").
    const back = parseFrameSource(frameSourceToText(source));
    expect(back[0].cells).toEqual(["1", "TRUE", "0", "FALSE"]);
    // …while the DERIVED value (what flows downstream) is real booleans.
    const derived = deriveFrame(source);
    expect(derived.columns[0].type).toBe("logical");
    expect(derived.columns[0].values).toEqual([true, true, false, false]);
  });

  it("preserves a date column's typed literal, deriving the serial only downstream", () => {
    const source: FrameSource = [
      { name: "d", type: "date", cells: ["2026-01-03", "46025"] },
    ];
    expect(parseFrameSource(frameSourceToText(source))[0].cells).toEqual(["2026-01-03", "46025"]);
    const derived = deriveFrame(source);
    expect(derived.columns[0].type).toBe("date");
    expect(typeof derived.columns[0].values[0]).toBe("number"); // a serial
  });

  it("inferColumn keeps the INPUTTED text as `raw` (date + logical, BEFORE inference)", () => {
    // A date column: values become serials, but raw keeps the original ISO text.
    const dateCol = inferColumn("d", ["2026-01-03", "2026-02-04"]);
    expect(dateCol.type).toBe("date");
    expect(typeof dateCol.values[0]).toBe("number"); // a serial
    expect(dateCol.raw).toEqual(["2026-01-03", "2026-02-04"]);
    // A logical column from lowercase text: value is a boolean, raw keeps "true"/"false".
    const boolCol = inferColumn("flag", ["true", "false"]);
    expect(boolCol.type).toBe("logical");
    expect(boolCol.values).toEqual([true, false]);
    expect(boolCol.raw).toEqual(["true", "false"]);
  });

  it("a CSV-imported frame carries each column's raw source", () => {
    const f = frameFromCells(["d", "n"], [["2026-01-03", "5"], ["2026-02-04", "6"]]);
    expect(f.columns[0].raw).toEqual(["2026-01-03", "2026-02-04"]);
    expect(f.columns[1].raw).toEqual(["5", "6"]);
  });

  it("deriveFrame carries the Frame Input's literal source as raw", () => {
    const derived = deriveFrame([{ name: "flag", type: "logical", cells: ["1", "TRUE"] }]);
    expect(derived.columns[0].values).toEqual([true, true]);
    expect(derived.columns[0].raw).toEqual(["1", "TRUE"]); // both literals preserved
  });

  it("legacy CSV frameText parses to a typed source with cells kept raw", () => {
    const src = parseFrameSource("flag, n\n1, 10\nTRUE, 20");
    // The flag column mixes 1 and TRUE → it can't infer logical (1 isn't TRUE/FALSE
    // text), so it stays text and both literals survive verbatim.
    expect(src[0].name).toBe("flag");
    expect(src[0].cells).toEqual(["1", "TRUE"]);
    expect(src[1].type).toBe("number");
    expect(src[1].cells).toEqual(["10", "20"]);
  });
});

// ─── Typed frame building (Build Frame / Frame from Lists: any homogeneous
//     matrix/list → typed columns, dates included) ──────────────────────────────

describe("colTypeForSocket — a socket's element family → frame column type", () => {
  it("maps concrete matrix/list/scalar sockets to their family", () => {
    expect(colTypeForSocket("number")).toBe("number");
    expect(colTypeForSocket("table")).toBe("number");
    expect(colTypeForSocket("numlist")).toBe("number");
    expect(colTypeForSocket("datetable")).toBe("date");
    expect(colTypeForSocket("datelist")).toBe("date");
    expect(colTypeForSocket("strtable")).toBe("string");
    expect(colTypeForSocket("logicaltable")).toBe("logical");
  });
  it("returns null for a wildcard rung (not yet adopted) or complex", () => {
    expect(colTypeForSocket("anytable")).toBeNull();
    expect(colTypeForSocket("anylist")).toBeNull();
    expect(colTypeForSocket("trueany")).toBeNull();
    expect(colTypeForSocket("complextable")).toBeNull(); // frames hold no complex column
    expect(colTypeForSocket(undefined)).toBeNull();
  });
});

describe("typedColumn", () => {
  it("a known date type keeps serials but types the column date (values can't recover it)", () => {
    const s1 = parseDateToSerial("2026-01-03"), s2 = parseDateToSerial("2026-02-04");
    const col = typedColumn("when", [s1, s2], 2, "date");
    expect(col.type).toBe("date");
    expect(col.values).toEqual([s1, s2]);
  });
  it("infers number/logical/string from runtime cell types, type-preserving", () => {
    expect(typedColumn("a", [1, 2, 3], 3).type).toBe("number");
    expect(typedColumn("b", [true, false], 2).type).toBe("logical");
    // "1" the string stays a string (no CSV-style re-parse to 1 the number).
    expect(typedColumn("c", ["1", "x"], 2)).toMatchObject({ type: "string", values: ["1", "x"] });
  });
  it("blanks → null, per-cell errors pass through, ragged pads to length", () => {
    const err = solError("#DIV/0!", "boom");
    const col = typedColumn("x", [1, null, err], 4, "number");
    expect(col.values).toEqual([1, null, err, null]);
  });
});

describe("buildFrameTyped — a matrix of any element family", () => {
  it("a string matrix → all string columns", () => {
    const f = buildFrameTyped([["a", "b"], ["c", "d"]], ["p", "q"], "string");
    expect(f.columns.map((c) => c.type)).toEqual(["string", "string"]);
    expect(f.columns[0].values).toEqual(["a", "c"]);
  });
  it("colType null → per-column value inference", () => {
    const f = buildFrameTyped([[1, "x"], [2, "y"]], ["n", "s"], null);
    expect(f.columns.map((c) => c.type)).toEqual(["number", "string"]);
  });
  it("carries a (unit) header onto a numeric column", () => {
    const f = buildFrameTyped([[5], [6]], ["Revenue ($0.00)"], "number");
    expect(f.columns[0].name).toBe("Revenue");
    expect(f.columns[0].unit).toBeTruthy();
  });
});

describe("BuildFrameNode — types columns by the adopted matrix socket", () => {
  const adopt = (n: BuildFrameNode, t: string) => (n.inputs.matrix!.socket as MutableSocket).setType(t as never);

  it("a numeric matrix stays byte-identical to buildFrame", () => {
    const n = new BuildFrameNode();
    const out = n.data({ matrix: [[[1, 2], [3, 4]]], headers: [["a", "b"]] }).frame!;
    expect(out).toEqual(buildFrame([[1, 2], [3, 4]], ["a", "b"]));
  });
  it("a datetable adopts → date columns (serials preserved)", () => {
    const n = new BuildFrameNode();
    adopt(n, "datetable");
    const s = parseDateToSerial("2026-03-20");
    const out = n.data({ matrix: [[[s], [s + 1]]], headers: [["when"]] }).frame!;
    expect(out.columns[0].type).toBe("date");
    expect(out.columns[0].values).toEqual([s, s + 1]);
  });
  it("a strtable adopts → string columns", () => {
    const n = new BuildFrameNode();
    adopt(n, "strtable");
    const out = n.data({ matrix: [[["x"], ["y"]]], headers: [["name"]] }).frame!;
    expect(out.columns[0].type).toBe("string");
  });
  it("an unadopted anytable falls back to value inference", () => {
    const n = new BuildFrameNode(); // socket base is anytable (never wired/settled)
    const out = n.data({ matrix: [[["a"], ["b"]]], headers: [["s"]] }).frame!;
    expect(out.columns[0].type).toBe("string");
  });
});

describe("FrameFromListsNode — a genuinely mixed frame from typed lists", () => {
  it("adopts each list's type, dates included", () => {
    const n = new FrameFromListsNode();
    const [n0, n1] = n.valuePairKeys(); // two default rows
    (n.inputs[n0[1]]!.socket as MutableSocket).setType("numlist" as never);
    (n.inputs[n1[1]]!.socket as MutableSocket).setType("datelist" as never);
    const s = parseDateToSerial("2026-05-01");
    const out = n.data({
      [n0[0]]: ["id"], [n0[1]]: [[1, 2]],
      [n1[0]]: ["when"], [n1[1]]: [[s, s + 1]],
    }).frame!;
    expect(out.columns.map((c) => c.type)).toEqual(["number", "date"]);
    expect(out.columns[1].values).toEqual([s, s + 1]);
  });
});
