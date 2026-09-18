// [[D54]], [[C25]]
import { describe, it, expect } from "vitest";
import { fxLatestUrl, parseFxRate, fxRangeUrl, parseFxSeries, FX_CURRENCIES } from "../../src/graph/fxProvider";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { applyFcUnit } from "../../src/graph/unitBridge";
import { isUnitCell, dimOf } from "../../src/graph/unitValue";

// C1 Currency / FX — the Frankfurter parse is pure + fixture-tested (widget rule 5), and
// importing fxProvider registers every currency code with the display bridge.

const usdEur = JSON.stringify({ amount: 1, base: "USD", date: "2026-09-04", rates: { EUR: 0.86044 } });

describe("fxLatestUrl", () => {
  it("builds the base/symbols endpoint, upper-casing and trimming", () => {
    expect(fxLatestUrl(" usd ", "eur")).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR");
  });
});

describe("parseFxRate", () => {
  it("pulls the requested rate and the as-of date", () => {
    const r = parseFxRate(usdEur, "EUR");
    expect(r.rate).toBe(0.86044);
    expect(r.date).toBe("2026-09-04");
    expect(r.serial).toBe(parseDateToSerial("2026-09-04"));
  });
  it("a missing target rate is null", () => {
    expect(parseFxRate(usdEur, "GBP").rate).toBeNull();
  });
  it("a malformed body is a null rate with no date", () => {
    expect(parseFxRate("not json", "EUR")).toEqual({ date: "", serial: NaN, rate: null });
  });
});

describe("fxRangeUrl", () => {
  it("builds the {start}..{end} time-series endpoint, upper-casing the currencies", () => {
    expect(fxRangeUrl(" usd ", "eur", "2026-06-01", "2026-08-30"))
      .toBe("https://api.frankfurter.dev/v1/2026-06-01..2026-08-30?base=USD&symbols=EUR");
  });
});

describe("parseFxSeries", () => {
  const series = JSON.stringify({
    amount: 1, base: "USD", start_date: "2026-06-01", end_date: "2026-06-03",
    rates: { "2026-06-03": { EUR: 0.862 }, "2026-06-01": { EUR: 0.860 }, "2026-06-02": { EUR: 0.861 } },
  });
  it("returns one row per day, sorted ascending by date, with the target rate", () => {
    const rows = parseFxSeries(series, "EUR");
    expect(rows.map((r) => r.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(rows.map((r) => r.rate)).toEqual([0.860, 0.861, 0.862]);
    expect(rows[0].serial).toBe(parseDateToSerial("2026-06-01"));
  });
  it("skips days missing the target rate and empties on a malformed body", () => {
    const holey = JSON.stringify({ rates: { "2026-06-01": { EUR: 0.86 }, "2026-06-02": { GBP: 0.79 } } });
    expect(parseFxSeries(holey, "EUR").map((r) => r.date)).toEqual(["2026-06-01"]);
    expect(parseFxSeries("not json", "EUR")).toEqual([]);
  });
});

describe("FX_CURRENCIES — the bundled picker list", () => {
  it("parses code + name, keeping multi-word names whole", () => {
    expect(FX_CURRENCIES.length).toBeGreaterThan(25);
    expect(FX_CURRENCIES.find((c) => c.code === "USD")?.name).toBe("United States Dollar");
    expect(FX_CURRENCIES.find((c) => c.code === "CNY")?.name).toBe("Chinese Renminbi Yuan");
  });
  it("every code is three upper-case letters", () => {
    for (const c of FX_CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/);
  });
});

describe("currency-unit registration — applyFcUnit authors a currency cell for any code", () => {
  it("a code beyond the four built-ins (CAD) tags the value on the currency dimension", () => {
    const cell = applyFcUnit(100, "cad");
    expect(isUnitCell(cell)).toBe(true);
    expect(dimOf(cell)).toEqual({ currency: 1 });
    expect((cell as { display?: string }).display).toBe("cad");
  });
});
