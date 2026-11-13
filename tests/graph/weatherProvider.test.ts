// [[C23]] calcModes, [[live-connections#Service providers]]
import { describe, it, expect } from "vitest";
import { weatherUrl, forecastChart, placeToday } from "../../src/graph/weatherProvider";
import { forecastWindow } from "../../src/graph/components/forecastView";
import type { FrameValue } from "../../src/graph/frame";
import type { ForecastPayload } from "../../src/graph/chartValue";

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


const daily: FrameValue = { __frame: true, columns: [
  { name: "Date", type: "date", values: [46000, 46001, null, 46003] },
  { name: "Rain mm", type: "number", values: [0, 2.5, 1, null] },
  { name: "Rain %", type: "number", values: [10, 80, 50, 20] },
  { name: "High", type: "number", values: [20, 18, 17, null] },
  { name: "Low", type: "number", values: [9, 8, 7, 6] },
  { name: "ET₀ mm", type: "number", values: [2, 2, 2, 2] },
  { name: "Condition", type: "string", values: ["Clear sky", "Light rain", "Fog", null] },
] };

describe("forecastChart", () => {
  it("reads the Daily frame's columns by name, dropping an undated row", () => {
    const cv = forecastChart(daily, "C", 46001, "Here")!;
    expect(cv).toMatchObject({ __chart: true, op: "forecast", title: "Here", values: [20, 18] });
    expect(cv.payload).toEqual({
      kind: "forecast", days: [46000, 46001, 46003], high: [20, 18, null], low: [9, 8, 6],
      rainMm: [0, 2.5, null], rainPct: [10, 80, 20], conditions: ["Clear sky", "Light rain", ""], unit: "C", today: 46001,
    });
  });
  it("gives null for no days, so the socket stays empty", () => {
    expect(forecastChart({ __frame: true, columns: [] }, "F", 46000, "x")).toBeNull();
  });
});

describe("forecastWindow", () => {
  const p = (forecastChart({ __frame: true, columns: [
    { name: "Date", type: "date", values: [1, 2, 3, 4, 5, 6, 7, 8] },
    { name: "High", type: "number", values: [1, 2, 3, 4, 5, 6, 7, 8] },
  ] }, "C", 3, "t")!.payload as ForecastPayload);
  it("starts at today", () => expect(forecastWindow(p, 3).days).toEqual([3, 4, 5]));
  it("keeps a full window when today is near the end or past it", () => {
    expect(forecastWindow({ ...p, today: 7 }, 3).days).toEqual([6, 7, 8]);
    expect(forecastWindow({ ...p, today: 99 }, 3).high).toEqual([6, 7, 8]);
  });
  it("leaves a short forecast whole", () => expect(forecastWindow(p, 20)).toBe(p));
});

describe("placeToday", () => {
  // 12 Nov 2026 23:30 UTC is serial 46338; Tokyo (+9 h) is already on the 13th, Honolulu (-10 h) still on the 12th.
  const now = new Date(Date.UTC(2026, 10, 12, 23, 30));
  it("is the calendar day at the forecast's place, not here", () => {
    expect(placeToday(0, now)).toBe(46338);
    expect(placeToday(9 * 3600, now)).toBe(46339);
    expect(placeToday(-10 * 3600, now)).toBe(46338);
    expect(placeToday(-10 * 3600, new Date(Date.UTC(2026, 10, 12, 9, 30)))).toBe(46337);
  });
  it("falls back to the day here when the reply names no offset", () => {
    const here = new Date(2026, 10, 12, 23, 30);
    expect(placeToday(null, here)).toBe(46338);
  });
});
