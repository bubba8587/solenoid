// [[C58]] tableInputRawText, [[live-connections#Dates and column types of a file]]
import { describe, it, expect } from "vitest";
import { csvToFrame } from "../../../src/graph/frameBackend";
import { retypeColumns } from "../../../src/graph/frame";
import { LocalFileNode } from "../../../src/graph/nodes/connection";
import { extractInit } from "../../../src/graph/nodeInit";

describe("a Local File's column types picked in its popup", () => {
  const csv = "zip,when,amount\n02134,1/2/26,12.50\n10001,3/15/26,8\n";

  it("reads a column again from its source text as the picked type", () => {
    const f = csvToFrame(csv);
    expect(f.columns[0]).toMatchObject({ type: "number", values: [2134, 10001] });
    const zip = retypeColumns(f, { zip: "string" }).columns[0];
    expect(zip).toMatchObject({ type: "string", values: ["02134", "10001"], raw: ["02134", "10001"] });
  });

  it("a Date pick reads in the card's order; Auto keeps the four-digit-year rule", () => {
    const f = csvToFrame(csv);
    expect(retypeColumns(f, { when: "date" }, "MDY").columns[1].values).toEqual([46024, 46096]);
    expect(retypeColumns(f, { when: "date" }).columns[1].values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("no picks, or a pick of the type it read as, leaves the frame as read", () => {
    const f = csvToFrame(csv);
    expect(retypeColumns(f, {})).toBe(f);
    expect(retypeColumns(f, { amount: "number" }).columns[2]).toBe(f.columns[2]);
  });

  it("the picks save with the card and keep only the four types", () => {
    const n = new LocalFileNode({ fileName: "x.csv", columnTypes: { zip: "string", bad: "nope" as never } });
    expect(n.columnTypes).toEqual({ zip: "string" });
    expect(extractInit(n).columnTypes).toEqual({ zip: "string" });
  });
});
