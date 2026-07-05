import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, parseFredObservations } from "./dataProviders";
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

  it("builds provider URLs — encoded input + key; stooq lower-cases and needs no key", () => {
    const fredUrl = PROVIDERS.fred.buildUrl("UNRATE", "KEY 123");
    expect(fredUrl).toContain("series_id=UNRATE");
    expect(fredUrl).toContain("api_key=KEY%20123"); // key is URL-encoded
    expect(PROVIDERS.fred.needsKey).toBe(true);

    expect(PROVIDERS.stooq.needsKey).toBe(false);
    expect(PROVIDERS.stooq.buildUrl("AAPL.US", "")).toContain("s=aapl.us");

    expect(PROVIDERS.alphavantage.buildUrl("MSFT", "K")).toContain("datatype=csv");
    expect(PROVIDERS.alphavantage.needsKey).toBe(true);
  });

  it("getProvider falls back to fred for an unknown id", () => {
    expect(getProvider("nope").id).toBe("fred");
    expect(getProvider("stooq").id).toBe("stooq");
  });
});
