// [[C23]] calcModes
import { describe, it, expect } from "vitest";
import { weatherUrl } from "../../src/graph/weatherProvider";

describe("weatherUrl", () => {
  it("sets the temperature unit and clamps the day windows", () => {
    const u = weatherUrl(43.6, -116.2, "F", 200, 40);
    expect(u).toContain("temperature_unit=fahrenheit");
    expect(u).toContain("past_days=92");    // clamped from 200
    expect(u).toContain("forecast_days=16"); // clamped from 40
    expect(u).toContain("latitude=43.6");
    expect(weatherUrl(0, 0, "C", 0, 7)).toContain("temperature_unit=celsius");
  });
});

