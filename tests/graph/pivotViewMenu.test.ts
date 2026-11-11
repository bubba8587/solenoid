// [[C127]] pivotView, [[table-popup#The Pivot view]]
// The Pivot view's right-click menu acts on the card's settings: each item checked against the setting it writes.
import { describe, it, expect } from "vitest";
import { pivotFrame } from "./coreVerbs";
import type { FrameValue } from "../../src/graph/frame";
import { buildPivotModel, pivotLayoutOf, DEFAULT_PIVOT_VIEW, type PivotViewOptions } from "../../src/graph/pivotLayout";
import type { PivotConfig } from "../../src/graph/pivotConfig";
import { calcFieldNames, pivotKey } from "../../src/graph/pivotConfig";
import { keyLabel, pivotMenuSections, type PivotMenuTarget, type PivotValueFormat } from "../../src/graph/components/PivotViewMenu";

const sales: FrameValue = {
  __frame: true,
  columns: [
    { name: "Region", type: "string", values: ["N", "N", "S", "S", "N", "S"] },
    { name: "Rep", type: "string", values: ["Ann", "Bo", "Cy", "Cy", "Ann", "Di"] },
    { name: "Q", type: "string", values: ["Q1", "Q2", "Q1", "Q2", "Q2", "Q1"] },
    { name: "Amt", type: "number", values: [1, 2, 3, 4, 5, 6] },
  ],
};
const layout = pivotLayoutOf(pivotFrame(sales, {
  rowFields: ["Region", "Rep"], colFields: ["Q"], values: ["Amt"], funcs: ["sum"], rowTotalDepth: 2, colTotalDepth: 0,
} as never))!;
const base = (): PivotConfig => ({
  rows: ["Region", "Rep"], cols: ["Q"], vals: ["Amt"], details: [], funcs: {}, rowTotalDepth: 2, colTotalDepth: 0,
  rowSort: 0, colSort: 0, relativeTo: 0, exclude: {},
});

/** The menu for a target over a fake card; `pick(label)` clicks that line and gives what the card was set to. */
function menu(target: PivotMenuTarget, cfg = base(), options: PivotViewOptions = DEFAULT_PIVOT_VIEW, format?: PivotValueFormat) {
  let applied: PivotConfig | null = null;
  let view: PivotViewOptions | null = null;
  const host = { agg: "sum" as const, typeOf: () => "string", config: () => cfg, apply: (n: PivotConfig) => { applied = n; }, keysOf: async () => ({ keys: ["N", "S", ""], total: 3 }) };
  const sections = pivotMenuSections({ target, layout, host, options, onOptions: (v) => { view = v; }, copyText: () => {}, format });
  const items = sections.flatMap((s) => s.items);
  const find = (label: string) => {
    const it = items.find((i) => i.label === label);
    if (!it) throw new Error(`no "${label}" in ${items.map((i) => i.label).join(", ")}`);
    return it;
  };
  return {
    labels: items.map((i) => i.label),
    headings: sections.map((s) => s.heading),
    find,
    pick: (label: string) => { find(label).onClick(); return applied as PivotConfig | null; },
    pickView: (label: string) => { find(label).onClick(); return view as PivotViewOptions | null; },
    applied: () => applied as PivotConfig | null,
  };
}
const item = (field: number, key: string): PivotMenuTarget => ({ kind: "item", axis: "rows", field, key, text: key });

describe("the Pivot view's menu on an item", () => {
  it("Hide adds the item's key, Keep Only hides every other value, Clear Filter empties the list", async () => {
    expect(menu(item(0, "N")).pick("Hide N")!.exclude).toEqual({ Region: ["N"] });
    const m = menu(item(0, "N"));
    m.pick("Keep Only N");
    await Promise.resolve(); await Promise.resolve();
    expect(m.applied()!.exclude).toEqual({ Region: ["S", ""] });
    expect(menu(item(0, "N")).find("Clear Filter from Region").disabled).toBe(true);
    const filtered = { ...base(), exclude: { Region: ["S"] } };
    expect(menu(item(0, "N"), filtered).pick("Clear Filter from Region")!.exclude).toEqual({ Region: [] });
  });

  it("keys match the core's: a blank is \"\", a logical TRUE, a number its digits", () => {
    expect([pivotKey(null), pivotKey(true), pivotKey(45678), pivotKey("x")]).toEqual(["", "TRUE", "45678", "x"]);
  });

  it("sorts by the field both ways, checks the current one, and No Sort clears it", () => {
    const m = menu(item(1, "Ann"), { ...base(), rowSort: -2 });
    expect(m.find("Sort Z to A").checked).toBe(true);
    expect(m.pick("Sort A to Z")!.rowSort).toBe(2);
    expect(menu(item(1, "Ann"), { ...base(), rowSort: -2 }).pick("Default Order")!.rowSort).toBe(0);
  });

  it("moves, reorders and removes the field", () => {
    expect(menu(item(0, "N")).pick("Move Down")!.rows).toEqual(["Rep", "Region"]);
    expect(menu(item(1, "Ann")).pick("Move Up")!.rows).toEqual(["Rep", "Region"]);
    const moved = menu(item(1, "Ann")).pick("Move to Columns")!;
    expect([moved.rows, moved.cols]).toEqual([["Region"], ["Q", "Rep"]]);
    expect(menu(item(0, "N")).pick("Remove Region")!.rows).toEqual(["Rep"]);
    expect(menu(item(0, "N")).labels).not.toContain("Move Up");
  });

  it("collapses and expands every group of an outer field, in the view only", () => {
    const model = buildPivotModel(layout, DEFAULT_PIVOT_VIEW, () => "", () => "");
    expect(model.body.length).toBeGreaterThan(0);
    const folded = menu(item(0, "N")).pickView("Collapse All Region")!;
    expect(folded.collapsed.length).toBe(2);
    const m = menu(item(0, "N"), base(), folded);
    expect(m.find("Collapse All Region").disabled).toBe(true);
    expect(m.pickView("Expand All Region")!.collapsed).toEqual([]);
    expect(menu(item(1, "Ann")).labels).not.toContain("Collapse All Rep");
  });

  it("an item's menu heads with its field and value", () => {
    expect(menu(item(0, "N")).headings[0]).toBe("Region: N");
  });
});

describe("the Pivot view's menu on a value", () => {
  const value: PivotMenuTarget = { kind: "value", value: 0, text: "8" };
  it("summarizes by another function, checking the current one", () => {
    const m = menu(value);
    expect(m.find("Sum").checked).toBe(true);
    expect(m.pick("Average")!.funcs).toEqual({ Amt: "avg" });
    expect(menu(value, { ...base(), funcs: { Amt: "varp" } }).labels).toContain("Varp");
  });

  it("shows values as a share, and No Calculation goes back to a sum", () => {
    const share = menu(value).pick("% of Row Total")!;
    expect([share.funcs.Amt, share.relativeTo]).toEqual(["percentof", 1]);
    const m = menu(value, share);
    expect(m.find("% of Row Total").checked).toBe(true);
    expect(m.pick("No Calculation")!.funcs.Amt).toBe("sum");
  });

  it("picks a Number format for the value, checking the current one, and none for a value that is no number", () => {
    const picks: [number, string][] = [];
    const fmt = (cur: string | null): PivotValueFormat => ({ get: () => cur, set: (v, f) => { picks.push([v, f]); } });
    const m = menu(value, base(), DEFAULT_PIVOT_VIEW, fmt("percent"));
    expect(m.find("Percent").checked).toBe(true);
    m.pick("Auto");
    expect(picks).toEqual([[0, ""]]);
    expect(menu(value, base(), DEFAULT_PIVOT_VIEW, fmt("custom")).find("Other").checked).toBe(true);
    expect(menu(value, base(), DEFAULT_PIVOT_VIEW, fmt(null)).headings).not.toContain("Number Format");
  });

  it("sorts rows by the value and removes the value field", () => {
    expect(menu(value).pick("Largest to Smallest")!.rowSort).toBe(-3);
    expect(menu(value).pick("Smallest to Largest")!.rowSort).toBe(3);
    expect(menu(value).pick("Remove Sum of Amt")!.vals).toEqual([]);
  });
});

describe("a field header's value list", () => {
  it("shows a key in its field's type and the blank as (blank)", () => {
    expect(keyLabel("date", "46023")).toBe("01-Jan-2026");
    expect(keyLabel("string", "")).toBe("(blank)");
    expect(keyLabel("string", "007")).toBe("007");
    expect(keyLabel("number", "#N/A")).toBe("#N/A");
  });
});

describe("Configure Fields lists calculated fields", () => {
  it("names each calculated value by its caption in the last result, and nothing without one", () => {
    expect(calcFieldNames({ values: ["Miles", "MPG", "Calculated 2"], funcs: ["sum", "calc", "calc"] })).toEqual(["MPG", "Calculated 2"]);
    expect(calcFieldNames({ values: ["Miles"], funcs: ["sum"] })).toEqual([]);
    expect(calcFieldNames(null)).toEqual([]);
  });
});
