// Open-Meteo forecast (keyless, CORS-open): one call returns past + future daily rows
// plus current conditions. The URL build + PARSE are pure and fixture-tested (widget
// rule 5); the node owns the fetch/cache and the unit tagging.
import { type FrameValue, type FrameColumn } from "./frame";
import { parseDateToSerial } from "./nodes/dateSerial";
import { columnUnitFromSpec } from "./unitColumn";

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

// WMO weather-interpretation codes → short text (Open-Meteo's documented table).
const WMO: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
};
export function wmoText(code: number | null): string {
  return code == null ? "" : (WMO[code] ?? `Code ${code}`);
}

export interface WeatherResult {
  daily: FrameValue;
  nowTemp: number | null;
  nowCondition: string;
}

const EMPTY: FrameValue = { __frame: true, columns: [] };

/** Parse the forecast response into a Daily frame (date, rain, temps, ET₀, condition)
 *  plus the current temp + condition. Temps carry the chosen °C/°F unit on their columns
 *  (unitOnValue) so it flows downstream. A malformed body → an empty frame. */
export function parseWeather(text: string, unit: TempUnit): WeatherResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { daily: EMPTY, nowTemp: null, nowCondition: "" }; }
  const root = (data ?? {}) as Record<string, unknown>;
  const d = (root.daily ?? {}) as Record<string, unknown>;
  const time = Array.isArray(d.time) ? (d.time as unknown[]) : [];
  const nums = (a: unknown): (number | null)[] =>
    Array.isArray(a) ? (a as unknown[]).map((v) => (typeof v === "number" ? v : null)) : time.map(() => null);
  const tempUnit = columnUnitFromSpec(unit === "F" ? "degF" : "degC") ?? undefined;
  const codes = Array.isArray(d.weather_code) ? (d.weather_code as unknown[]) : time.map(() => null);
  const columns: FrameColumn[] = [
    { name: "Date", type: "date", values: time.map((t) => (typeof t === "string" ? parseDateToSerial(t) : null)) },
    { name: "Rain mm", type: "number", values: nums(d.precipitation_sum) },
    { name: "Rain %", type: "number", values: nums(d.precipitation_probability_max) },
    { name: "High", type: "number", values: nums(d.temperature_2m_max), ...(tempUnit ? { unit: tempUnit } : {}) },
    { name: "Low", type: "number", values: nums(d.temperature_2m_min), ...(tempUnit ? { unit: tempUnit } : {}) },
    { name: "ET₀ mm", type: "number", values: nums(d.et0_fao_evapotranspiration) },
    { name: "Condition", type: "string", values: codes.map((c) => (typeof c === "number" ? wmoText(c) : null)) },
  ];
  const cur = (root.current ?? {}) as Record<string, unknown>;
  return {
    daily: { __frame: true, columns },
    nowTemp: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
    nowCondition: typeof cur.weather_code === "number" ? wmoText(cur.weather_code) : "",
  };
}
