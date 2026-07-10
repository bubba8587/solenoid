import { describe, expect, it } from "vitest";
import { CastNode, castOutput, parseCx, type CastTarget } from "./cast";
import { formatNumberPattern } from "./text";
import { isSolError } from "../errorValue";
import { SolenoidSocket, isDateType } from "../sockets";

// No editor singleton in tests → sourceKind() is null, so complex INPUTS can't
// be disambiguated here — those paths are typed by the live socket. Everything
// else (parsing, formatting, list mapping) is pure and covered below.

const cast = (target: CastTarget, value: unknown) => {
  const n = new CastNode({ target });
  return n.data({ value: [value] }).result;
};

describe("Cast node", () => {
  // Regression: Cast(date) outputs a `datecombo` socket, and a date serial is
  // just a number — so the Format Controller (and anything else) can only know
  // to format it as a date from the SOCKET TYPE. isDateType must accept the
  // socket Cast(date) actually emits, or the FC shows a raw serial (46025).
  it("Cast(date)'s output socket is recognized as a date type", () => {
    const sock = castOutput("date").socket as SolenoidSocket;
    expect(sock.dataType).toBe("datecombo");
    expect(isDateType(sock.dataType)).toBe(true);
    expect(isDateType("date")).toBe(true);
    expect(isDateType("datelist")).toBe(true);
    expect(isDateType("number")).toBe(false);
  });

  it("casts to number", () => {
    expect(cast("number", "42.5")).toBe(42.5);
    expect(cast("number", 7)).toBe(7);
    const r = cast("number", [1, "2", "x"]) as Array<number | import("../errorValue").SolError>;
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(2);
    expect(isSolError(r[2]) && (r[2] as import("../errorValue").SolError).code).toBe("#VALUE!");
  });

  it("casts a logical to number via the 0/1 bridge (Excel N(TRUE)=1), scalar and per-cell", () => {
    expect(cast("number", true)).toBe(1);
    expect(cast("number", false)).toBe(0);
    // a logical list (Comparison / BooleanOp / IS.TEST emit these) → 1/0 per cell,
    // not a row of #VALUE!.
    expect(cast("number", [true, false, true])).toEqual([1, 0, 1]);
  });

  it("casts to text (default representation, element-wise)", () => {
    expect(cast("text", 3.14159)).toBe("3.14159");
    expect(cast("text", [1, 2.5])).toEqual(["1", "2.5"]);
    expect(cast("text", "already text")).toBe("already text");
  });

  // The number-format util still exists (used by Text nodes); Cast no longer
  // exposes a format code, but the regression coverage stays.
  it("formatNumberPattern formats decimals (old TEXT regex was double-escaped)", () => {
    expect(formatNumberPattern(2.345, "0.00")).toBe("2.35");
    expect(formatNumberPattern(5, "0")).toBe("5");
    expect(formatNumberPattern(0.123, "0.0%")).toBe("12.3%");
  });

  it("casts to date serials", () => {
    expect(cast("date", "1970-01-01")).toBe(25569); // JS epoch = Excel serial 25569
    expect(cast("date", 45000)).toBe(45000);        // serials pass through
  });

  it("casts to logical (boolean) — text, number, and passthrough", () => {
    expect(cast("logical", "TRUE")).toBe(true);
    expect(cast("logical", "false")).toBe(false);  // case-insensitive
    expect(cast("logical", " True ")).toBe(true);   // trimmed
    expect(cast("logical", 5)).toBe(true);          // nonzero → TRUE
    expect(cast("logical", 0)).toBe(false);
    expect(cast("logical", "1")).toBe(true);        // numeric string → nonzero
    expect(cast("logical", true)).toBe(true);       // real boolean passes through
  });

  it("Cast(logical) output socket is logicalcombo", () => {
    expect((castOutput("logical").socket as SolenoidSocket).dataType).toBe("logicalcombo");
  });

  it("casts a list to logical with a per-cell #VALUE! for an unparseable cell", () => {
    const r = cast("logical", ["true", "false", "maybe", 2]) as Array<boolean | import("../errorValue").SolError>;
    expect(r[0]).toBe(true);
    expect(r[1]).toBe(false);
    expect(isSolError(r[2]) && (r[2] as import("../errorValue").SolError).code).toBe("#VALUE!");
    expect(r[3]).toBe(true);
  });

  it("returns #VALUE! when a scalar can't be cast to logical", () => {
    const bad = cast("logical", "maybe");
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });

  it("returns #VALUE! when a scalar can't be cast", () => {
    const badDate = cast("date", "not a date");
    expect(isSolError(badDate) && badDate.code).toBe("#VALUE!");
    const badNum = cast("number", "abc");
    expect(isSolError(badNum) && badNum.code).toBe("#VALUE!");
    const badCx = cast("complex", "garbage");
    expect(isSolError(badCx) && badCx.code).toBe("#VALUE!");
    // A list with a bad element now carries a per-cell #VALUE! (relaxed invariant);
    // a blank element stays null (missing). Good elements compute around them.
    const r = cast("number", [1, "2", "x", null]) as Array<number | null | import("../errorValue").SolError>;
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(2);
    expect(isSolError(r[2]) && (r[2] as import("../errorValue").SolError).code).toBe("#VALUE!");
    expect(r[3]).toBeNull();
  });

  it("casts to complex", () => {
    expect(cast("complex", 7)).toEqual([7, 0]);
    expect(cast("complex", "3+4i")).toEqual([3, 4]);
    expect(cast("complex", ["1+i", 2])).toEqual([[1, 1], [2, 0]]);
  });

  it("parses complex text forms", () => {
    expect(parseCx("3+4i")).toEqual([3, 4]);
    expect(parseCx("3-4i")).toEqual([3, -4]);
    expect(parseCx("-i")).toEqual([0, -1]);
    expect(parseCx("i")).toEqual([0, 1]);
    expect(parseCx("2.5")).toEqual([2.5, 0]);
    expect(parseCx("5j")).toEqual([0, 5]);
    expect(parseCx("1+j")).toEqual([1, 1]);
    expect(parseCx("garbage")).toEqual([NaN, NaN]);
  });

  it("passes null through and exposes lists as a structured value (chip, not a joined string)", () => {
    const n = new CastNode({ target: "text" });
    expect(n.data({ value: [null] }).result).toBeNull();
    n.data({ value: [[1, 2, 3]] });
    // ValueDisplay-compatible array → rendered as a chip, not "[1, 2, 3]".
    expect(n.cachedResult).toEqual(["1", "2", "3"]);
  });

  it("keeps a date cast as numeric serials (ValueDisplay formats them — list → chip)", () => {
    // Cast no longer pre-formats dates; the date socket drives display formatting
    // in ValueDisplay (see valueDisplayFormat.test.ts), so a list stays a chip.
    const n = new CastNode({ target: "date" });
    n.data({ value: [45000] });
    expect(n.cachedResult).toBe(45000);
    n.data({ value: [[45000, 45001]] });
    expect(n.cachedResult).toEqual([45000, 45001]);
  });
});
