import { describe, it, expect } from "vitest";
import { familyOf, controlsFor, precisionApplies, COMPLEX_FORMAT_STYLES } from "./formatModel";
import { applyLogicalStyle } from "./formatAnnotationStore";
import type { SocketDataType } from "./sockets";

// The spec's truth table (docs/format-model.md), machine-checked.

describe("familyOf — the ENTIRE SocketDataType union is covered or explicitly none", () => {
  // Every member of the union, exhaustively — a new socket type must be added
  // here (Record<SocketDataType, …> makes tsc flag the omission), so it can't
  // silently fall into the FC's "none" family without a decision.
  const EXPECTED: Record<SocketDataType, string> = {
    number: "number", list: "number", numlist: "number", table: "number",
    anytable: "number",           // formats its numeric cells
    any: "number",                // provisional until the concrete type flows in
    trueany: "number",            // wildcard rung — same provisional default (isWildcardType)
    date: "date", datelist: "date", datecombo: "date", datetable: "date",
    string: "text", strlist: "text", strcombo: "text", strtable: "text",
    logical: "logical", logicallist: "logical", logicalcombo: "logical", logicaltable: "logical",
    complex: "complex", complexlist: "complex", complexcombo: "complex", complextable: "complex",
    frame: "none", cube: "none",  // per-column formats are the A4 units milestone
    anylist: "none",              // element-agnostic wildcard — no format family until a concrete type flows in
    anycombo: "none",             // its scalar-or-list sibling — same reason
    chart: "chart",               // text-scale control (display only)
    lambda: "lambda",             // view-as control (signature/KaTeX/highlighted/mono)
    document: "none",             // a whole-document value — no FC format controls
  };
  for (const [dt, fam] of Object.entries(EXPECTED)) {
    it(`${dt} → ${fam}`, () => expect(familyOf(dt as SocketDataType)).toBe(fam));
  }
});

describe("precisionApplies — ONE list: decimal, percent, scientific", () => {
  it("applies to exactly those styles", () => {
    expect(precisionApplies("decimal")).toBe(true);
    expect(precisionApplies("percent")).toBe(true);
    expect(precisionApplies("scientific")).toBe(true);
    for (const s of ["auto", "integer", "fraction", "fraction_adv", "custom", "date_dmy", "some_pack_format"]) {
      expect(precisionApplies(s)).toBe(false);
    }
  });
});

describe("controlsFor — the truth table rows", () => {
  it("number family: styles + unit; precision follows the style", () => {
    const dec = controlsFor("number", "decimal");
    expect(dec).toEqual({ numberStyle: true, complexStyle: false, precision: true, unit: true, dateStyle: false, text: false, logical: false, lambda: false, chart: false, advanced: true });
    expect(controlsFor("number", "scientific").precision).toBe(true); // the model's new grant
    expect(controlsFor("number", "integer").precision).toBe(false);
    expect(controlsFor("number", "fraction").precision).toBe(false);
  });

  it("date family: date styles only — no unit, no precision", () => {
    const c = controlsFor("date", "date_dmy");
    expect(c.dateStyle).toBe(true);
    expect(c.unit).toBe(false);
    expect(c.precision).toBe(false);
    expect(c.numberStyle).toBe(false);
  });

  it("text family: case/B/I/size + an advanced tier (align/markdown/mono)", () => {
    const c = controlsFor("text", "auto");
    expect(c.text).toBe(true);
    expect(c.unit).toBe(false);
    expect(c.numberStyle).toBe(false);
    expect(c.advanced).toBe(true); // alignment / markdown / monospace live here
  });

  it("logical family: show-as only", () => {
    const c = controlsFor("logical", "auto");
    expect(c.logical).toBe(true);
    expect(c.unit).toBe(false);
    expect(c.numberStyle).toBe(false);
  });

  it("complex family: reduced styles + precision + unit", () => {
    const c = controlsFor("complex", "decimal");
    expect(c.complexStyle).toBe(true);
    expect(c.numberStyle).toBe(false);
    expect(c.precision).toBe(true);
    expect(c.unit).toBe(true);
    expect(COMPLEX_FORMAT_STYLES).toEqual(["auto", "decimal", "scientific"]);
  });

  it("lambda family: the view-as dropdown only", () => {
    const c = controlsFor("lambda", "auto");
    expect(c.lambda).toBe(true);
    expect(c.chart).toBe(false);
    expect(c.unit).toBe(false);
    expect(c.numberStyle).toBe(false);
    expect(c.advanced).toBe(false);
  });

  it("chart family: the text-scale dropdown only", () => {
    const c = controlsFor("chart", "auto");
    expect(c.chart).toBe(true);
    expect(c.lambda).toBe(false);
    expect(c.unit).toBe(false);
    expect(c.numberStyle).toBe(false);
    expect(c.advanced).toBe(false);
  });

  it("none family: every control off", () => {
    const c = controlsFor("none", "decimal");
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });
});

describe("applyLogicalStyle — the show-as forms", () => {
  it("default / truefalse is the Excel form", () => {
    expect(applyLogicalStyle(true)).toBe("TRUE");
    expect(applyLogicalStyle(false, "truefalse")).toBe("FALSE");
  });
  it("binary / yesno / check", () => {
    expect(applyLogicalStyle(true, "binary")).toBe("1");
    expect(applyLogicalStyle(false, "binary")).toBe("0");
    expect(applyLogicalStyle(true, "yesno")).toBe("Yes");
    expect(applyLogicalStyle(false, "yesno")).toBe("No");
    expect(applyLogicalStyle(true, "check")).toBe("✓");
    expect(applyLogicalStyle(false, "check")).toBe("✗");
  });
});
