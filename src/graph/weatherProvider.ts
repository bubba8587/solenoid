// [[C25]] firstClassUnits
// Open-Meteo forecast (keyless, CORS-open): past and future daily rows plus current conditions in one call.
import { type FrameValue, type FrameCell } from "./frame";
import { frameFnOnCore } from "./frameBackend";
import type { ChartValue } from "./chartValue";

export type TempUnit = "C" | "F";

/** The forecast endpoint. `past_days` 0–92, `forecast_days` 1–16 (the API caps). */
export function weatherUrl(lat: number, lon: number, unit: TempUnit, pastDays: number, forecastDays: number): string {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,weather_code",
    current: "temperature_2m,weather_code",
    temperature_unit: unit === "F" ? "fahrenheit" : "celsius",
    timezone: "auto",
    past_days: String(Math.max(0, Math.min(92, Math.round(pastDays)))),
    forecast_days: String(Math.max(1, Math.min(16, Math.round(forecastDays)))),
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

export interface WeatherResult {
  daily: FrameValue;
  nowTemp: number | null;
  nowCondition: string;
}

/** The reply read on the core (`providers.rs`): the daily frame, its temperatures in the chosen °C or °F, and the
 *  conditions now; a malformed body gives an empty frame. */
export function parseWeather(text: string, unit: TempUnit): WeatherResult {
  const r = frameFnOnCore("weatherFrame", [], [text, unit]);
  if (!r || !("frame" in r)) return { daily: { __frame: true, columns: [] }, nowTemp: null, nowCondition: "" };
  const [nowTemp, nowCondition] = r.value as [number | null, string];
  return { daily: r.frame, nowTemp, nowCondition };
}

/** The daily frame as a forecast figure, `today` marked; no days gives null, so the socket stays empty. */
export function forecastChart(daily: FrameValue, unit: TempUnit, today: number, title: string): ChartValue | null {
  const col = (name: string) => daily.columns.find((c) => c.name === name)?.values ?? [];
  const num = (c: FrameCell | undefined) => (typeof c === "number" && Number.isFinite(c) ? c : null);
  const dates = col("Date");
  const days: number[] = [];
  const keep: number[] = [];
  dates.forEach((d, i) => { const n = num(d); if (n !== null) { days.push(n); keep.push(i); } });
  if (days.length === 0) return null;
  const nums = (name: string) => { const v = col(name); return keep.map((i) => num(v[i])); };
  const cond = col("Condition");
  const high = nums("High");
  return {
    __chart: true,
    op: "forecast",
    values: high.filter((v): v is number => v !== null),
    payload: {
      kind: "forecast", days, high, low: nums("Low"), rainMm: nums("Rain mm"), rainPct: nums("Rain %"),
      conditions: keep.map((i) => (typeof cond[i] === "string" ? (cond[i] as string) : "")), unit, today,
    },
    options: {},
    title,
  };
}
