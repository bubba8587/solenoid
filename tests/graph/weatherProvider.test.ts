import { describe, it, expect } from "vitest";
import { weatherUrl, parseWeather, wmoText } from "../../src/graph/weatherProvider";

// C1 Weather — the Open-Meteo forecast parse is pure + fixture-tested (widget rule 5).

const fixture = JSON.stringify({
  daily: {
    time: ["2026-03-20", "2026-03-21"],
    temperature_2m_max: [12, 14],
    temperature_2m_min: [3, 5],
    precipitation_sum: [0, 2.5],
    precipitation_probability_max: [10, 60],
    et0_fao_evapotranspiration: [1.2, 1.5],
    weather_code: [1, 61],
  },
  current: { temperature_2m: 9, weather_code: 2 },
});

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

describe("parseWeather", () => {
  it("builds the daily frame, tagging the temps with the chosen unit", () => {
    const r = parseWeather(fixture, "C");
    const names = r.daily.columns.map((c) => c.name);
    expect(names).toEqual(["Date", "Rain mm", "Rain %", "High", "Low", "ET₀ mm", "Condition"]);
    const high = r.daily.columns.find((c) => c.name === "High")!;
    expect(high.values).toEqual([12, 14]);
    expect(high.unit?.display).toBe("degC");
    expect(r.daily.columns.find((c) => c.name === "Date")!.type).toBe("date");
    expect(r.daily.columns.find((c) => c.name === "Condition")!.values).toEqual(["Mainly clear", "Light rain"]);
    expect(r.nowTemp).toBe(9);
    expect(r.nowCondition).toBe("Partly cloudy");
  });

  it("tags temps degF when Fahrenheit is chosen", () => {
    const r = parseWeather(fixture, "F");
    expect(r.daily.columns.find((c) => c.name === "Low")!.unit?.display).toBe("degF");
  });

  it("a malformed body → an empty frame", () => {
    const r = parseWeather("nope", "C");
    expect(r.daily.columns).toEqual([]);
    expect(r.nowTemp).toBeNull();
  });
});

describe("wmoText", () => {
  it("maps known codes, falls back for unknown, blank for null", () => {
    expect(wmoText(0)).toBe("Clear");
    expect(wmoText(95)).toBe("Thunderstorm");
    expect(wmoText(7)).toBe("Code 7");
    expect(wmoText(null)).toBe("");
  });
});
