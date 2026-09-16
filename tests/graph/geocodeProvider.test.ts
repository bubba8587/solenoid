import { describe, it, expect } from "vitest";
import { geocodeUrl, parseGeocode, pickGeocodeMatch } from "../../src/graph/geocodeProvider";

// C1 Geocode — the Open-Meteo geocoding parse is pure + fixture-tested (widget rule 5).

const twoParis = JSON.stringify({
  results: [
    { name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris", admin1: "Île-de-France", country: "France" },
    { name: "Paris", latitude: 33.66, longitude: -95.55, timezone: "America/Chicago", admin1: "Texas", country: "United States" },
  ],
});

describe("parseGeocode", () => {
  it("parses matches, best first, with a City, Region, Country label", () => {
    const m = parseGeocode(twoParis);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ label: "Paris, Île-de-France, France", lat: 48.85, lon: 2.35, timezone: "Europe/Paris" });
    expect(m[1].label).toBe("Paris, Texas, United States");
  });

  it("returns [] for malformed JSON, no results, or a non-array results field", () => {
    expect(parseGeocode("not json")).toEqual([]);
    expect(parseGeocode("{}")).toEqual([]);
    expect(parseGeocode(JSON.stringify({ results: "nope" }))).toEqual([]);
    expect(parseGeocode(JSON.stringify({ results: [] }))).toEqual([]);
  });

  it("skips a result missing coordinates", () => {
    const m = parseGeocode(JSON.stringify({ results: [{ name: "Nowhere", country: "X" }] }));
    expect(m).toEqual([]);
  });

  it("url-encodes the place name", () => {
    expect(geocodeUrl("São Paulo")).toContain("name=S%C3%A3o%20Paulo");
  });
});

describe("pickGeocodeMatch — the ambiguity pick is by LABEL, defaulting to the top match", () => {
  const m = parseGeocode(twoParis);
  it("no pick → the top match", () => {
    expect(pickGeocodeMatch(m, "")?.label).toBe("Paris, Île-de-France, France");
  });
  it("a stored label → that match, even when the API reorders (index would swap)", () => {
    expect(pickGeocodeMatch([m[1], m[0]], "Paris, Texas, United States")?.lat).toBe(33.66);
  });
  it("an unknown label falls back to the top match", () => {
    expect(pickGeocodeMatch(m, "Paris, Mars")?.label).toBe("Paris, Île-de-France, France");
  });
  it("no matches → null", () => {
    expect(pickGeocodeMatch([], "anything")).toBeNull();
  });
});
