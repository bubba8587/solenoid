// [[C44]] dateSerials, [[C25]] firstClassUnits
import { describe, it, expect } from "vitest";
import { fxLatestUrl, fxRangeUrl, FX_CURRENCIES } from "../../src/graph/fxProvider";
import { applyFcUnit } from "../../src/graph/unitBridge";
import { dimOf } from "../../src/graph/unitValue";

// Importing fxProvider registers every currency code with the display bridge; the reply's reads are
// coreProviders.test.ts.

describe("fxLatestUrl", () => {
  it("builds the base/symbols endpoint, upper-casing and trimming", () => {
    expect(fxLatestUrl(" usd ", "eur")).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR");
  });
});

describe("fxRangeUrl", () => {
  it("builds the {start}..{end} time-series endpoint, upper-casing the currencies", () => {
    expect(fxRangeUrl(" usd ", "eur", "2026-06-01", "2026-08-30"))
      .toBe("https://api.frankfurter.dev/v1/2026-06-01..2026-08-30?base=USD&symbols=EUR");
  });
});

describe("FX_CURRENCIES — the bundled picker list", () => {
  it("parses code + name, keeping multi-word names whole", () => {
    expect(FX_CURRENCIES.length).toBeGreaterThan(25);
    expect(FX_CURRENCIES.find((c) => c.code === "CNY")?.name).toBe("Chinese Renminbi Yuan");
  });
  it("every code is three upper-case letters", () => {
    for (const c of FX_CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/);
  });
});

describe("currency-unit registration — applyFcUnit authors a currency cell for any code", () => {
  it("a code beyond the four built-ins (CAD) tags the value on the currency dimension", () => {
    const cell = applyFcUnit(100, "cad");
    expect(dimOf(cell)).toEqual({ currency: 1 });
    expect((cell as { display?: string }).display).toBe("cad");
  });
});
