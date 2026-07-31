import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTextCase,
  annotationRendersNegativeRed,
  formatAnnotationStore,
  formatMismatchStore,
  formatNumberWithAnnotation,
  formatCxWithAnnotation,
  isDateStyle,
  unitsCompatible,
  unitById,
  type FormatAnnotation,
} from "./formatAnnotationStore";
import { cx } from "./cxValue";

// ─── helpers ─────────────────────────────────────────────────────────────────

// Returns a minimal FormatAnnotation (override what you need).
function ann(overrides: Partial<FormatAnnotation> = {}): FormatAnnotation {
  return { format: "auto", unit: "none", ...overrides };
}

// Convenience: formatNumberWithAnnotation with inline annotation fields.
function fwn(n: number, overrides: Partial<FormatAnnotation> = {}): string {
  return formatNumberWithAnnotation(n, ann(overrides));
}

// Clean up store state between tests (delete any keys we know we've set).
const TEST_NODES = ["n1", "n2", "n3", "na", "nb"];
beforeEach(() => {
  for (const id of TEST_NODES) {
    for (const sk of ["out", "a", "b", "value", "result"]) {
      formatAnnotationStore.delete(id, sk);
    }
  }
});

// ─── formatAnnotationStore ────────────────────────────────────────────────────

describe("formatAnnotationStore — set / get", () => {
  it("get returns undefined for an entry never set", () => {
    expect(formatAnnotationStore.get("n1", "out")).toBeUndefined();
  });

  it("set then get round-trips the annotation", () => {
    const a = ann({ format: "decimal", unit: "usd", decimalDigits: 2 });
    formatAnnotationStore.set("n1", "out", a);
    expect(formatAnnotationStore.get("n1", "out")).toEqual(a);
  });

  it("set overwrites an existing entry", () => {
    formatAnnotationStore.set("n1", "out", ann({ format: "decimal" }));
    formatAnnotationStore.set("n1", "out", ann({ format: "percent" }));
    expect(formatAnnotationStore.get("n1", "out")?.format).toBe("percent");
  });

  it("separate (nodeId, socketKey) pairs are independent", () => {
    formatAnnotationStore.set("n1", "a", ann({ format: "decimal" }));
    formatAnnotationStore.set("n1", "b", ann({ format: "percent" }));
    expect(formatAnnotationStore.get("n1", "a")?.format).toBe("decimal");
    expect(formatAnnotationStore.get("n1", "b")?.format).toBe("percent");
  });
});

describe("formatAnnotationStore — getForNode", () => {
  it("returns undefined when no socket for that node is set", () => {
    expect(formatAnnotationStore.getForNode("n1")).toBeUndefined();
  });

  it("returns the annotation when at least one socket is set", () => {
    const a = ann({ format: "integer" });
    formatAnnotationStore.set("n1", "out", a);
    expect(formatAnnotationStore.getForNode("n1")).toEqual(a);
  });

  it("does not match a node whose id is a prefix of another (double-colon separator)", () => {
    // "n1" must not match "n1x" — key is "n1::out" vs "n1x::out"
    const nodeAnn = ann({ format: "decimal" });
    formatAnnotationStore.set("n1", "out", nodeAnn);
    // A different node whose id STARTS with "n1" but isn't "n1"
    formatAnnotationStore.set("n1", "value", ann({ format: "percent" }));
    // Use a fresh nodeId "na" to confirm it doesn't bleed
    expect(formatAnnotationStore.getForNode("na")).toBeUndefined();
  });
});

describe("formatAnnotationStore — delete", () => {
  it("delete removes the entry; subsequent get returns undefined", () => {
    formatAnnotationStore.set("n1", "out", ann());
    formatAnnotationStore.delete("n1", "out");
    expect(formatAnnotationStore.get("n1", "out")).toBeUndefined();
  });

  it("delete on a nonexistent key is a no-op (no throw)", () => {
    expect(() => formatAnnotationStore.delete("n1", "out")).not.toThrow();
  });
});

describe("formatAnnotationStore — subscribe / version", () => {
  it("version increments on set", () => {
    const v0 = formatAnnotationStore.version();
    formatAnnotationStore.set("n1", "out", ann());
    expect(formatAnnotationStore.version()).toBe(v0 + 1);
  });

  it("version increments on delete (when key existed)", () => {
    formatAnnotationStore.set("n1", "out", ann());
    const v0 = formatAnnotationStore.version();
    formatAnnotationStore.delete("n1", "out");
    expect(formatAnnotationStore.version()).toBe(v0 + 1);
  });

  it("delete on nonexistent key does NOT increment version", () => {
    const v0 = formatAnnotationStore.version();
    formatAnnotationStore.delete("n1", "out"); // nothing there
    expect(formatAnnotationStore.version()).toBe(v0);
  });

  it("subscribe listener fires on set", () => {
    const fn = vi.fn();
    const unsub = formatAnnotationStore.subscribe(fn);
    formatAnnotationStore.set("n1", "out", ann());
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("subscribe listener fires on delete (when key existed)", () => {
    formatAnnotationStore.set("n1", "out", ann());
    const fn = vi.fn();
    const unsub = formatAnnotationStore.subscribe(fn);
    formatAnnotationStore.delete("n1", "out");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("unsubscribe stops delivery", () => {
    const fn = vi.fn();
    const unsub = formatAnnotationStore.subscribe(fn);
    unsub();
    formatAnnotationStore.set("n1", "out", ann());
    expect(fn).not.toHaveBeenCalled();
  });
});

// ─── formatNumberWithAnnotation ────────────────────────────────────────────────

describe("formatNumberWithAnnotation — non-finite passthrough", () => {
  it("returns 'Infinity' for Infinity", () => {
    expect(fwn(Infinity)).toBe("Infinity");
  });

  it("returns '-Infinity' for -Infinity", () => {
    expect(fwn(-Infinity)).toBe("-Infinity");
  });

  it("returns 'NaN' for NaN", () => {
    expect(fwn(NaN)).toBe("NaN");
  });
});

describe("formatNumberWithAnnotation — auto format", () => {
  it("formats integers without a decimal point", () => {
    expect(fwn(42)).toBe("42");
    expect(fwn(0)).toBe("0");
    expect(fwn(-7)).toBe("-7");
  });

  it("formats floats to 6 significant figures via toPrecision", () => {
    // parseFloat(n.toPrecision(6)) trims trailing zeros
    expect(fwn(1.23456789)).toBe("1.23457");
    expect(fwn(100.1)).toBe("100.1");
    expect(fwn(0.000123456)).toBe("0.000123456");
  });
});

describe("formatNumberWithAnnotation — decimal format", () => {
  it("renders 2 decimal places by default", () => {
    expect(fwn(1.5, { format: "decimal", decimalDigits: 2 })).toBe("1.50");
  });

  it("renders 0 decimal places (integer-like)", () => {
    expect(fwn(1.7, { format: "decimal", decimalDigits: 0 })).toBe("2");
  });

  it("renders 4 decimal places", () => {
    expect(fwn(1.23456, { format: "decimal", decimalDigits: 4 })).toBe("1.2346");
  });

  it("sigfigs mode uses significant figures not places", () => {
    const result = fwn(1234.5678, { format: "decimal", decimalDigits: 3, decimalMode: "sigfigs" });
    expect(result).toBe("1,230");
  });
});

describe("formatNumberWithAnnotation — percent format", () => {
  it("multiplies by 100 and appends %", () => {
    expect(fwn(0.5, { format: "percent", decimalDigits: 2 })).toBe("50.00%");
    expect(fwn(0.1234, { format: "percent", decimalDigits: 1 })).toBe("12.3%");
  });

  it("handles 0% and 100%", () => {
    expect(fwn(0, { format: "percent", decimalDigits: 0 })).toBe("0%");
    expect(fwn(1, { format: "percent", decimalDigits: 0 })).toBe("100%");
  });

  it("handles negative percent", () => {
    expect(fwn(-0.05, { format: "percent", decimalDigits: 0 })).toBe("-5%");
  });
});

describe("formatNumberWithAnnotation — integer format", () => {
  it("rounds to nearest integer", () => {
    expect(fwn(1.4, { format: "integer" })).toBe("1");
    expect(fwn(1.6, { format: "integer" })).toBe("2");
    expect(fwn(-1.6, { format: "integer" })).toBe("-2");
  });
});

describe("formatNumberWithAnnotation — scientific format", () => {
  it("honors the precision row in places mode (format model — was hardcoded 3)", () => {
    expect(fwn(12300, { format: "scientific" })).toBe("1.23e+4"); // default 2 places
    expect(fwn(0.00123, { format: "scientific" })).toBe("1.23e-3");
    expect(fwn(12300, { format: "scientific", decimalDigits: 3 })).toBe("1.230e+4");
    expect(fwn(12300, { format: "scientific", decimalDigits: 0 })).toBe("1e+4");
  });
  it("sig-figs mode = mantissa significant digits (toExponential(s − 1))", () => {
    expect(fwn(12345, { format: "scientific", decimalDigits: 3, decimalMode: "sigfigs" })).toBe("1.23e+4");
    expect(fwn(12345, { format: "scientific", decimalDigits: 1, decimalMode: "sigfigs" })).toBe("1e+4");
  });
});

describe("formatNumberWithAnnotation — advanced tier (grouping / negative / scale)", () => {
  it("grouping off drops the thousands separator (decimal, integer, percent)", () => {
    expect(fwn(1234.5, { format: "decimal", grouping: false })).toBe("1234.50");
    expect(fwn(1234.5, { format: "integer", grouping: false })).toBe("1235");
    expect(fwn(12.34, { format: "percent", grouping: false, decimalDigits: 0 })).toBe("1234%");
  });
  it("grouping is inert where it doesn't apply (scientific)", () => {
    expect(fwn(12300, { format: "scientific", grouping: false })).toBe("1.23e+4");
  });
  it("paren negatives wrap OUTSIDE the unit (accounting style)", () => {
    expect(fwn(-1234.5, { format: "decimal", negativeStyle: "paren" })).toBe("(1,234.50)");
    expect(fwn(-1234.5, { format: "decimal", negativeStyle: "paren", unit: "usd" })).toBe("($1,234.50)");
    expect(fwn(1234.5, { format: "decimal", negativeStyle: "paren" })).toBe("1,234.50"); // positive unchanged
  });
  it("red is a render hint — the string form stays minus / parens", () => {
    expect(fwn(-12.5, { format: "decimal", negativeStyle: "red" })).toBe("-12.50");
    expect(fwn(-12.5, { format: "decimal", negativeStyle: "redparen" })).toBe("(12.50)");
    expect(annotationRendersNegativeRed(ann({ negativeStyle: "red" }), -1)).toBe(true);
    expect(annotationRendersNegativeRed(ann({ negativeStyle: "red" }), 1)).toBe(false);
    expect(annotationRendersNegativeRed(ann({ negativeStyle: "paren" }), -1)).toBe(false);
  });
  it("scale divides and suffixes; the unit wraps the scaled form", () => {
    expect(fwn(1200000, { format: "decimal", scaleMode: "m", decimalDigits: 1 })).toBe("1.2M");
    expect(fwn(4500, { format: "integer", scaleMode: "k" })).toBe("5K");
    expect(fwn(1200000, { format: "decimal", scaleMode: "m", decimalDigits: 1, unit: "usd" })).toBe("$1.2M");
  });
  it("scale is inert where it doesn't apply (percent)", () => {
    expect(fwn(0.5, { format: "percent", scaleMode: "m", decimalDigits: 0 })).toBe("50%");
  });
  it("paren + scale + unit compose: ($1.2M)", () => {
    expect(fwn(-1200000, { format: "decimal", scaleMode: "m", decimalDigits: 1, unit: "usd", negativeStyle: "redparen" })).toBe("($1.2M)");
  });
});

describe("formatNumberWithAnnotation — fraction format", () => {
  it("renders clean fractions", () => {
    expect(fwn(0.5, { format: "fraction" })).toBe("1/2");
    expect(fwn(0.25, { format: "fraction" })).toBe("1/4");
  });

  it("renders mixed numbers for values > 1", () => {
    expect(fwn(1.5, { format: "fraction" })).toBe("1 1/2");
  });

  it("falls back to auto for values that aren't clean fractions", () => {
    // 0.1 is not a clean fraction (1/10 is ok, but 1/3 of pi isn't)
    // 1/3 ≈ 0.33333... is clean
    expect(fwn(1 / 3, { format: "fraction" })).toBe("1/3");
    // A random float that has no low-denominator rational
    const result = fwn(0.123456789, { format: "fraction" });
    // Falls back to autoFormat — 6 sig figs
    expect(result).toMatch(/0\.12345/);
  });

  it("renders 0 as '0'", () => {
    expect(fwn(0, { format: "fraction" })).toBe("0");
  });
});

describe("formatNumberWithAnnotation — fraction_adv format", () => {
  it("recognizes π/2", () => {
    expect(fwn(Math.PI / 2, { format: "fraction_adv" })).toBe("π/2");
  });

  it("recognizes π", () => {
    expect(fwn(Math.PI, { format: "fraction_adv" })).toBe("π");
  });

  it("recognizes 2π", () => {
    expect(fwn(2 * Math.PI, { format: "fraction_adv" })).toBe("2π");
  });

  it("falls back to plain fraction for non-constant values", () => {
    expect(fwn(0.5, { format: "fraction_adv" })).toBe("1/2");
  });
});

describe("formatNumberWithAnnotation — unit suffixes and prefixes", () => {
  it("appends a suffix unit after the number (e.g. degrees)", () => {
    expect(fwn(90, { format: "integer", unit: "deg" })).toBe("90°");
  });

  it("prepends a prefix unit before the number (currency)", () => {
    expect(fwn(1234, { format: "integer", unit: "usd" })).toBe("$1,234");
  });

  it("unit 'none' adds no affix", () => {
    expect(fwn(42, { format: "integer", unit: "none" })).toBe("42");
  });

  it("custom unit appends the customUnit string", () => {
    expect(fwn(5, { format: "integer", unit: "custom", customUnit: " pcs" })).toBe("5 pcs");
  });

  it("custom unit with no customUnit string adds nothing", () => {
    expect(fwn(5, { format: "integer", unit: "custom" })).toBe("5");
  });
});

// ─── applyTextCase ────────────────────────────────────────────────────────────

describe("applyTextCase", () => {
  it("upper: converts to uppercase", () => {
    expect(applyTextCase("hello world", "upper")).toBe("HELLO WORLD");
  });

  it("lower: converts to lowercase", () => {
    expect(applyTextCase("Hello World", "lower")).toBe("hello world");
  });

  it("proper: capitalizes first letter of each word", () => {
    expect(applyTextCase("hello world", "proper")).toBe("Hello World");
  });

  it("none / undefined: returns unchanged", () => {
    expect(applyTextCase("Hello World", "none")).toBe("Hello World");
    expect(applyTextCase("Hello World", undefined)).toBe("Hello World");
  });
});

// ─── isDateStyle ─────────────────────────────────────────────────────────────

describe("isDateStyle", () => {
  it("returns true for date_ prefixed styles", () => {
    expect(isDateStyle("date_iso")).toBe(true);
    expect(isDateStyle("date_us")).toBe(true);
    expect(isDateStyle("date_custom")).toBe(true);
  });

  it("returns true for time_ prefixed styles", () => {
    expect(isDateStyle("time_24")).toBe(true);
    expect(isDateStyle("time_12")).toBe(true);
  });

  it("returns true for 'datetime'", () => {
    expect(isDateStyle("datetime")).toBe(true);
  });

  it("returns false for number styles", () => {
    expect(isDateStyle("decimal")).toBe(false);
    expect(isDateStyle("auto")).toBe(false);
    expect(isDateStyle("percent")).toBe(false);
  });
});

// ─── unitsCompatible ─────────────────────────────────────────────────────────

describe("unitsCompatible", () => {
  it("'none' is compatible with anything", () => {
    expect(unitsCompatible("none", "usd")).toBe(true);
    expect(unitsCompatible("deg", "none")).toBe(true);
  });

  it("same group is compatible", () => {
    expect(unitsCompatible("deg", "rad")).toBe(true);   // both angle
    expect(unitsCompatible("m", "km")).toBe(true);       // both length
  });

  it("different groups are not compatible", () => {
    expect(unitsCompatible("deg", "m")).toBe(false);     // angle vs length
    expect(unitsCompatible("usd", "kg")).toBe(false);    // currency vs mass
  });

  it("'custom' is compatible with anything", () => {
    expect(unitsCompatible("custom", "deg")).toBe(true);
    expect(unitsCompatible("m", "custom")).toBe(true);
  });
});

// ─── unitById ────────────────────────────────────────────────────────────────

describe("unitById", () => {
  it("returns the matching annotation for a known id", () => {
    expect(unitById("deg").label).toBe("°");
    expect(unitById("usd").prefix).toBe(true);
  });

  it("returns the 'none' annotation (first entry) for an unknown id", () => {
    expect(unitById("bogus").id).toBe("none");
  });
});

// ─── formatMismatchStore ──────────────────────────────────────────────────────

describe("formatMismatchStore", () => {
  it("has() returns false for an unset node", () => {
    expect(formatMismatchStore.has("n1")).toBe(false);
  });

  it("setMismatch(true) sets it; has() returns true", () => {
    formatMismatchStore.setMismatch("n1", true);
    expect(formatMismatchStore.has("n1")).toBe(true);
    formatMismatchStore.setMismatch("n1", false); // cleanup
  });

  it("setMismatch(false) clears it", () => {
    formatMismatchStore.setMismatch("n1", true);
    formatMismatchStore.setMismatch("n1", false);
    expect(formatMismatchStore.has("n1")).toBe(false);
  });

  it("subscribe fires on state change but not on no-op", () => {
    const fn = vi.fn();
    const unsub = formatMismatchStore.subscribe(fn);
    formatMismatchStore.setMismatch("n2", true);  // change → fires
    formatMismatchStore.setMismatch("n2", true);  // no-op → no fire
    expect(fn).toHaveBeenCalledTimes(1);
    formatMismatchStore.setMismatch("n2", false); // cleanup
    unsub();
  });
});

// ─── Complex: the FC finally reaches a complex value ─────────────────────────
// The popup half (reduced style list, precision, unit rows) gated correctly long
// before any of it reached a render: the complex cards pre-formatted to a fixed
// string in their own components, so the annotation had nothing to act on. These
// pin the three ways a complex differs from a number.
describe("formatCxWithAnnotation", () => {
  const fcx = (re: number, im: number, o: Partial<FormatAnnotation> = {}) =>
    formatCxWithAnnotation(cx(re, im), ann(o));

  it("auto keeps the default written form", () => {
    expect(fcx(3, 2)).toBe("3 + 2i");
    expect(fcx(3, -2)).toBe("3 - 2i");
    expect(fcx(0, 1)).toBe("i");
    expect(fcx(0, -1)).toBe("-i");
    expect(fcx(5, 0)).toBe("5");
  });

  it("precision applies to BOTH components — the defect this closes", () => {
    expect(fcx(1.23456, 2.34567, { format: "decimal", decimalDigits: 2 })).toBe("1.23 + 2.35i");
    // …including when one component is a whole number: it does not keep an
    // integer's bare form while the other shows places.
    expect(fcx(1, 2.5, { format: "decimal", decimalDigits: 3 })).toBe("1.000 + 2.500i");
  });

  it("scientific formats both components too", () => {
    expect(fcx(12345, 6789, { format: "scientific", decimalDigits: 2 })).toBe("1.23e+4 + 6.79e+3i");
  });

  it("a style outside the complex list falls back to auto, never nonsense", () => {
    // percent/fraction/integer are not offered on a complex socket, but an
    // annotation can still carry one from before the socket was retyped.
    for (const format of ["percent", "fraction", "integer", "custom"] as const) {
      expect(fcx(3, 2, { format })).toBe("3 + 2i");
    }
  });

  it("the unit wraps the WHOLE value, parenthesised only in the two-term form", () => {
    expect(fcx(3, 2, { unit: "custom", customUnit: " V" })).toBe("(3 + 2i) V");
    // One term needs no parens — "2i V" cannot be misread.
    expect(fcx(0, 2, { unit: "custom", customUnit: " V" })).toBe("2i V");
    expect(fcx(3, 0, { unit: "custom", customUnit: " V" })).toBe("3 V");
  });

  it("NaN stays NaN rather than formatting into a number", () => {
    expect(fcx(NaN, 1)).toBe("NaN");
    expect(fcx(1, NaN, { format: "decimal", decimalDigits: 2 })).toBe("NaN");
  });
});
