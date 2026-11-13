// [[C44]] dateSerials, [[frame-verbs#pivot]]
// Excel's grouped date fields: `Years (When)`, `Quarters (When)`, `Months (When)`, `Weeks (When)` and `Days (When)` bucket
// a date column, each sorting in time order, on a plain frame and a lazy one alike.
import { describe, it, expect } from "vitest";
import { PivotNode } from "../../../src/graph/nodes/frame";
import { readFrame, type FrameInput } from "../../../src/graph/frameBackend";
import { pivotLayoutOf } from "../../../src/graph/pivotLayout";
import { dateGroupOf, regroupField, type PivotConfig } from "../../../src/graph/pivotConfig";
import { lazy } from "../frameRefKit";
import type { FrameValue } from "../../../src/graph/frame";

const serial = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569;
const log: FrameValue = { __frame: true, columns: [
  { name: "When", type: "date", values: ["2025-12-30", "2026-01-05", "2026-01-20", "2026-02-03", "2026-04-15", null, "2026-01-07"].map((d) => (d ? serial(d) : null)) },
  { name: "Note", type: "string", values: ["a", "b", "c", "d", "e", "f", "g"] },
  { name: "Amt", type: "number", values: [5, 10, 20, 30, 40, 50, 1] },
] };

async function pivot(frame: unknown, rows: string[], cols: string[] = [], extra: Record<string, unknown> = {}) {
  const p = new PivotNode(extra as never);
  const raw = p.data({ frame: [frame], rowFields: [rows], colFields: [cols], values: [["Amt"]] }).frame as FrameInput;
  const out = (await readFrame(raw)) as FrameValue;
  const col = (n: string) => out.columns.find((c) => c.name === n)!.values;
  return { p, out, col };
}

describe("grouped date fields", () => {
  it("Years › Months: each month's total under its year, a month shown Jan 2026", async () => {
    const { out, col } = await pivot(log, ["Years (When)", "Months (When)"]);
    expect(col("Years (When)")).toEqual([2025, 2026, 2026, 2026, null]);
    expect(col("Months (When)")).toEqual([serial("2025-12-01"), serial("2026-01-01"), serial("2026-02-01"), serial("2026-04-01"), null]);
    expect(col("Sum of Amt")).toEqual([5, 31, 30, 40, 50]);
    const layout = pivotLayoutOf(out)!;
    expect(layout.rowFormats?.[1]).toMatchObject({ format: "date_custom", customPattern: "MMM YYYY" });
  });

  it("Quarters read 2026 Q1 and head columns; Weeks start on Monday; Days drop the time", async () => {
    const q = await pivot(log, ["Weeks (When)"], ["Quarters (When)"]);
    expect(q.out.columns.map((c) => c.name)).toEqual(["Weeks (When)", "2025 Q4", "2026 Q1", "2026 Q2", "null"]);
    expect(q.col("Weeks (When)").slice(0, 2)).toEqual([serial("2025-12-29"), serial("2026-01-05")]);
    expect(q.col("2026 Q1")).toEqual([null, 11, 20, 30, null, null]);
    const timed = { __frame: true, columns: [{ ...log.columns[0], values: [serial("2026-01-05") + 0.75] }, { name: "Amt", type: "number", values: [3] }] } as FrameValue;
    expect((await pivot(timed, ["Days (When)"])).col("Days (When)")).toEqual([serial("2026-01-05")]);
  });

  it("a month field's columns are headed Jan 2026", async () => {
    const { out } = await pivot(log, [], ["Months (When)"]);
    expect(out.columns.map((c) => c.name).slice(0, 2)).toEqual(["Dec 2025", "Jan 2026"]);
  });

  it("lists the grouped field among the editor's fields, and filters on its keys", async () => {
    const { p, col } = await pivot(log, ["Years (When)"], [], { filterExclude: { "Years (When)": ["2025"] } });
    const src = p.sourceColumns.find((c) => c.name === "Years (When)")!;
    expect(src.type).toBe("number");
    expect(src.distinct).toEqual(["2025", "2026", ""]);
    expect(col("Years (When)")).toEqual([2026, null]);
  });

  it("groups nothing from a column that is no date, and a real column of the name wins", async () => {
    const notDate = await pivot(log, ["Months (Note)"]);
    expect(notDate.out.columns.map((c) => c.name)).not.toContain("Months (Note)");
    const real: FrameValue = { __frame: true, columns: [...log.columns, { name: "Months (When)", type: "string", values: ["x", "x", "x", "x", "x", "x", "y"] }] };
    expect((await pivot(real, ["Months (When)"])).col("Months (When)")).toEqual(["x", "y"]);
  });

  it("reads the date column off a lazy input", async () => {
    const { col } = await pivot(lazy(log), ["Quarters (When)"]);
    expect(col("Quarters (When)")).toEqual(["2025 Q4", "2026 Q1", "2026 Q2", null]);
    expect(col("Sum of Amt")).toEqual([5, 61, 40, 50]);
  });
});

describe("regrouping a placed field", () => {
  const cfg = (rows: string[], exclude: Record<string, string[]> = {}): PivotConfig => ({
    rows, cols: [], vals: ["Amt"], details: [], funcs: {}, rowTotalDepth: 0, colTotalDepth: 0, rowSort: null, colSort: null, relativeTo: 0, exclude,
  });
  it("renames it where it stands, back to the dates with none, and drops its old filter", () => {
    expect(dateGroupOf("Months (When)")).toEqual({ unit: "Months", from: "When" });
    expect(dateGroupOf("Months When")).toBeNull();
    expect(regroupField(cfg(["Region", "When"]), "rows", "When", "Months").rows).toEqual(["Region", "Months (When)"]);
    const back = regroupField(cfg(["Months (When)"], { "Months (When)": ["1"] }), "rows", "Months (When)", null);
    expect([back.rows, back.exclude]).toEqual([["When"], {}]);
    expect(regroupField(cfg(["Years (When)", "Months (When)"]), "rows", "Months (When)", "Years").rows).toEqual(["Years (When)"]);
  });
});
