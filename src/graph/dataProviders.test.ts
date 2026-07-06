import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, parseFredObservations, parseFredCsv } from "./dataProviders";
import { getColumn, frameRowCount } from "./frame";

describe("dataProviders", () => {
  it("FRED observations → a date/value frame; '.' and blank gaps become missing", () => {
    const json = JSON.stringify({
      observations: [
        { date: "2020-01-01", value: "1.5" },
        { date: "2020-02-01", value: "." },
        { date: "2020-03-01", value: "2.0" },
      ],
    });
    const f = parseFredObservations(json);
    expect(f.columns.map((c) => c.name)).toEqual(["date", "value"]);
    expect(frameRowCount(f)).toBe(3);
    expect(getColumn(f, "value")?.values).toEqual([1.5, null, 2.0]);
    // The date column is type-inferred (ISO strings → a date column); just assert it
    // carries all three rows, not its coerced representation.
    expect(getColumn(f, "date")?.values.length).toBe(3);
  });

  it("handles a missing observations array without throwing", () => {
    expect(frameRowCount(parseFredObservations("{}"))).toBe(0);
  });

  it("FRED keyless CSV → date/value frame with the series-named value column; '.' gaps missing", () => {
    const csv = "observation_date,UNRATE\n2020-01-01,3.5\n2020-02-01,.\n2020-03-01,4.4\n";
    const f = parseFredCsv(csv);
    expect(f.columns.map((c) => c.name)).toEqual(["observation_date", "UNRATE"]);
    expect(getColumn(f, "UNRATE")?.values).toEqual([3.5, null, 4.4]);
  });

  it("builds provider URLs — FRED keyless CSV; Alpha Vantage keyed CSV", () => {
    // FRED is keyless now — the public fredgraph.csv download, no api_key.
    const fredUrl = PROVIDERS.fred.buildUrl("UNRATE", "");
    expect(fredUrl).toContain("fredgraph.csv?id=UNRATE");
    expect(fredUrl).not.toContain("api_key");
    expect(PROVIDERS.fred.needsKey).toBe(false);

    expect(PROVIDERS.alphavantage.buildUrl("MSFT", "K")).toContain("datatype=csv");
    expect(PROVIDERS.alphavantage.needsKey).toBe(true);
  });

  it("getProvider falls back to fred for an unknown id", () => {
    expect(getProvider("nope").id).toBe("fred");
    expect(getProvider("alphavantage").id).toBe("alphavantage");
  });
});
