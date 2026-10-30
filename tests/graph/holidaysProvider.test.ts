// [[C44]]
import { describe, it, expect } from "vitest";
import { holidaysUrl, NAGER_COUNTRIES } from "../../src/graph/holidaysProvider";

describe("holidaysUrl", () => {
  it("builds the year/country endpoint, upper-casing and trimming the code", () => {
    expect(holidaysUrl(2026, " us ")).toBe("https://date.nager.at/api/v3/PublicHolidays/2026/US");
  });
  it("truncates a fractional year", () => {
    expect(holidaysUrl(2026.9, "GB")).toContain("/2026/GB");
  });
});

describe("NAGER_COUNTRIES — the bundled picker list", () => {
  it("parses code + name, keeping multi-word names whole", () => {
    expect(NAGER_COUNTRIES.length).toBeGreaterThan(190);
    expect(NAGER_COUNTRIES.find((c) => c.code === "BA")?.name).toBe("Bosnia and Herzegovina");
  });
  it("every entry has a two-letter code and a non-empty name", () => {
    for (const c of NAGER_COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
