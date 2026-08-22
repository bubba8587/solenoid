import { describe, it, expect } from "vitest";
import { TableInputNode, tableRawCells, rawCellsToText, deriveTable } from "./matrix";

// Table Input is a raw-text literal source (tableInputRawText): the grid editor round-trips through
// rawCellsToText -> tableText -> tableRawCells. Blanks must survive that trip as real
// null cells, never silently dropping a row/column and reshaping the table. (The one
// deliberate drop is a TRAILING all-empty column — a typing artifact, not data.)
describe("Table Input — blanks round-trip as null cells", () => {
  const roundTrip = (cells: string[][]) => tableRawCells(rawCellsToText(cells));

  it("an interior blank derives to null, not NaN or a dropped cell", () => {
    const n = new TableInputNode({ tableText: "1, 2\n, 4", dataType: "number" });
    expect(n.data().table).toEqual([[1, 2], [null, 4]]);
  });

  it("an all-blank row keeps its shape and derives to a full row of nulls", () => {
    const cells = [["1", "2"], ["", ""], ["5", "6"]];
    expect(roundTrip(cells)).toEqual(cells);
    expect(deriveTable(roundTrip(cells), "number")).toEqual([[1, 2], [null, null], [5, 6]]);
  });

  it("a blank in a single-column table survives the round trip", () => {
    const cells = [["1"], [""], ["3"]];
    expect(roundTrip(cells)).toEqual(cells);
    expect(deriveTable(roundTrip(cells), "number")).toEqual([[1], [null], [3]]);
  });

  it("a trailing all-empty column is trimmed (a typing artifact, the one intended drop)", () => {
    expect(roundTrip([["1", ""], ["3", ""]])).toEqual([["1"], ["3"]]);
  });

  it("blanks in a text table are null too, not empty strings", () => {
    expect(deriveTable([["a", ""], ["", "d"]], "string")).toEqual([["a", null], [null, "d"]]);
  });
});
