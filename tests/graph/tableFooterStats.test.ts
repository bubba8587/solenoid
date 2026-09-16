import { describe, it, expect } from "vitest";
import { describeColumn } from "../../src/graph/frameVerbs";
import { formatScalar } from "../../src/graph/components/format";
import { formatDateSerial, DEFAULT_DATE_FORMAT, parseDateToSerial } from "../../src/graph/nodes/date";
import {
  type FooterColType,
  type ColSummary,
  STATS_BY_TYPE,
  defaultFooterStat,
  footerStatValue,
  formatFooterStat,
  FOOTER_STAT_LABEL,
} from "../../src/graph/components/tableFooterStats";

// Build a ColSummary exactly as the Table popup's summary pass does.
function summarize(values: unknown[], type: FooterColType): ColSummary {
  const profile = describeColumn(values, type);
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const sum = type === "number" ? nums.reduce((a, b) => a + b, 0) : null;
  const checked = type === "logical" ? values.filter((v) => v === true).length : null;
  const unchecked = type === "logical" ? values.filter((v) => v === false).length : null;
  return { profile, sum, checked, unchecked };
}

describe("footer stat choices", () => {
  it("offers the number stats, including range and std dev", () => {
    const n = STATS_BY_TYPE.number;
    expect(n).toContain("range");
    expect(n).toContain("stddev");
    for (const k of ["sum", "avg", "min", "max", "median"] as const) expect(n).toContain(k);
    // The common presence stats trail every type.
    for (const k of ["count", "distinct", "blank", "error"] as const) expect(n).toContain(k);
  });

  it("offers earliest/latest only on date columns, checked/unchecked only on logical", () => {
    expect(STATS_BY_TYPE.date).toContain("earliest");
    expect(STATS_BY_TYPE.date).toContain("latest");
    expect(STATS_BY_TYPE.logical).toContain("checked");
    expect(STATS_BY_TYPE.logical).toContain("unchecked");
    // Cross-type stats don't leak onto the wrong column.
    expect(STATS_BY_TYPE.date).not.toContain("range");
    expect(STATS_BY_TYPE.date).not.toContain("checked");
    expect(STATS_BY_TYPE.logical).not.toContain("earliest");
    expect(STATS_BY_TYPE.string).not.toContain("sum");
    expect(STATS_BY_TYPE.string).not.toContain("earliest");
  });

  it("defaults to Sum on numbers and Count elsewhere", () => {
    expect(defaultFooterStat("number")).toBe("sum");
    expect(defaultFooterStat("date")).toBe("count");
    expect(defaultFooterStat("logical")).toBe("count");
    expect(defaultFooterStat("string")).toBe("count");
  });

  it("every stat has a label", () => {
    const all = new Set(Object.values(STATS_BY_TYPE).flat());
    for (const k of all) expect(FOOTER_STAT_LABEL[k]).toBeTruthy();
  });
});

describe("footerStatValue — number", () => {
  const s = summarize([1, 2, 3, 4], "number");
  it("sum / avg / min / max / median", () => {
    expect(footerStatValue("sum", s)).toBe(10);
    expect(footerStatValue("avg", s)).toBe(2.5);
    expect(footerStatValue("min", s)).toBe(1);
    expect(footerStatValue("max", s)).toBe(4);
    expect(footerStatValue("median", s)).toBe(2.5);
  });
  it("range is max − min", () => {
    expect(footerStatValue("range", s)).toBe(3);
  });
  it("stddev is the sample standard deviation (profile.std)", () => {
    // sample sd of [1,2,3,4] = sqrt(5/3)
    expect(footerStatValue("stddev", s)).toBeCloseTo(Math.sqrt(5 / 3), 10);
    expect(footerStatValue("stddev", s)).toBe(s.profile.std);
  });
  it("range is null when the column has no numbers", () => {
    const empty = summarize([null, null], "number");
    expect(footerStatValue("range", empty)).toBeNull();
  });
});

describe("footerStatValue — date", () => {
  const a = parseDateToSerial("2024-01-10");
  const b = parseDateToSerial("2024-03-20");
  const c = parseDateToSerial("2024-02-01");
  const s = summarize([a, b, c], "date");
  it("earliest / latest are the serial bounds", () => {
    expect(footerStatValue("earliest", s)).toBe(a);
    expect(footerStatValue("latest", s)).toBe(b);
  });
});

describe("footerStatValue — logical", () => {
  const s = summarize([true, true, false, null], "logical");
  it("checked / unchecked tally TRUE / FALSE, blanks excluded", () => {
    expect(footerStatValue("checked", s)).toBe(2);
    expect(footerStatValue("unchecked", s)).toBe(1);
    expect(footerStatValue("count", s)).toBe(3);
    expect(footerStatValue("blank", s)).toBe(1);
  });
});

describe("formatFooterStat", () => {
  const serial = parseDateToSerial("2024-01-10");
  it("renders a date bound as a formatted date, not a raw serial", () => {
    expect(formatFooterStat("earliest", serial)).toBe(formatDateSerial(serial, DEFAULT_DATE_FORMAT));
    expect(formatFooterStat("latest", serial)).toBe(formatDateSerial(serial, DEFAULT_DATE_FORMAT));
    expect(formatFooterStat("earliest", serial)).not.toBe(formatScalar(serial));
  });
  it("renders other stats as plain numbers", () => {
    expect(formatFooterStat("sum", 1234.5)).toBe(formatScalar(1234.5));
    expect(formatFooterStat("checked", 3)).toBe(formatScalar(3));
  });
  it("shows an em dash for a missing value", () => {
    expect(formatFooterStat("range", null)).toBe("—");
  });
});
