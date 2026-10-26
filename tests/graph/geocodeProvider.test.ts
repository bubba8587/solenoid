// [[C23]] calcModes
import { describe, it, expect } from "vitest";
import { geocodeUrl, parseGeocode, pickGeocodeMatch } from "../../src/graph/geocodeProvider";

const twoParis = JSON.stringify({
  results: [
    { name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris", admin1: "Île-de-France", country: "France" },
    { name: "Paris", latitude: 33.66, longitude: -95.55, timezone: "America/Chicago", admin1: "Texas", country: "United States" },
  ],
});

describe("geocodeUrl", () => {
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
