import { describe, it, expect } from "vitest";
import { TextTransformNode, TextSliceNode, ReptNode } from "./text";
import { DateConstructNode, DateAddNode } from "./date";

// ─── A wired blank must not resurrect the typed literal ───────────────────────
// The `inputs.x?.[0] ?? this.literals.x` idiom swallows a WIRED null into the
// literal, so a blank flowing down a cable silently became whatever value sat in
// the node's own box. Under the settled P6 model a missing value PROPAGATES —
// null in, null out — and Fill/Coalesce is the opt-in recovery.
//
// The contract has two halves and both matter: a CONNECTED cable wins even when
// its value is null, and only an UNWIRED slot falls back to the literal. Tests
// come in pairs for that reason — a fix that propagated unconditionally would
// break every node's typed default just as badly.
//
// A wired input arrives as `[null]` (the slot is connected, the value is missing);
// an unwired one arrives as `undefined`.

describe("text operands", () => {
  it("UPPER: a wired blank yields blank, not the text typed in the box", () => {
    const node = new TextTransformNode({ op: "upper" });
    node.stringLiterals.text = "abc";
    // The originally reported case: this returned "ABC".
    expect(node.data({ text: [null as unknown as string] }).result).toBeNull();
  });

  it("UPPER: an UNWIRED slot still uses the typed text", () => {
    const node = new TextTransformNode({ op: "upper" });
    node.stringLiterals.text = "abc";
    expect(node.data({}).result).toBe("ABC");
  });

  it("LEFT: a wired blank COUNT propagates rather than falling back to 1", () => {
    const node = new TextSliceNode({ op: "left" });
    node.literals.n = 3;
    expect(node.data({ text: ["abcdef"], n: [null as unknown as number] }).result).toBeNull();
    // Unwired count keeps the literal.
    expect(node.data({ text: ["abcdef"] }).result).toBe("abc");
  });

  it("propagates per CELL, so one blank in a list doesn't poison its neighbours", () => {
    const node = new TextTransformNode({ op: "upper" });
    expect(node.data({ text: [["a", null as unknown as string, "c"]] }).result)
      .toEqual(["A", null, "C"]);
  });

  it("REPT: a wired blank count propagates", () => {
    const node = new ReptNode();
    node.literals.times = 2;
    expect(node.data({ text: ["ab"], times: [null as unknown as number] }).result).toBeNull();
    expect(node.data({ text: ["ab"] }).result).toBe("abab");
  });
});

describe("date operands", () => {
  it("DATE: a wired blank month propagates instead of defaulting to January", () => {
    const node = new DateConstructNode();
    node.literals.month = 6;
    expect(node.data({ year: [2026], month: [null as unknown as number], day: [1] }).result).toBeNull();
  });

  it("DATE: unwired parts still use the typed literals", () => {
    const node = new DateConstructNode();
    node.literals.year = 2026;
    node.literals.month = 3;
    node.literals.day = 15;
    expect(typeof node.data({}).result).toBe("number");
  });

  it("EDATE: a wired blank month offset propagates", () => {
    const node = new DateAddNode({ op: "edate" });
    node.literals.months = 1;
    expect(node.data({ start: [46096], months: [null as unknown as number] }).result).toBeNull();
    // Unwired offset keeps the literal — the value shifts, so it still computes.
    expect(typeof node.data({ start: [46096] }).result).toBe("number");
  });
});
