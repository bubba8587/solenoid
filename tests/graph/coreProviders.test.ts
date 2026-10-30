// [[C130]] rustCore, [[D99]] rustIsSpec, [[C23]] calcModes
// The data providers' parses held to their frozen answers (fixtures/core/providers.json.gz): Open-Meteo, Nager.Date and
// Frankfurter bodies, well-formed and not, read into the frames and values the cards output.
import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { frozen } from "./coreFixtures";
import { parseWeather } from "../../src/graph/weatherProvider";
import { holidaysOnCore } from "../../src/graph/holidaysProvider";
import { parseFxRate, parseFxSeries } from "../../src/graph/fxProvider";
import { parseGeocode } from "../../src/graph/geocodeProvider";

type Case = { kind: "weather" | "holidays" | "fxRate" | "fxSeries" | "geocode"; body: string; args: unknown[]; want?: unknown };

/** NaN and the infinities as text, so a frozen answer survives JSON. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? `#${x}` : x)));

const weatherBody = (daily: unknown, current?: unknown) => JSON.stringify({ daily, ...(current !== undefined ? { current } : {}) });
const DAILY = {
  time: ["2026-03-20", "2026-03-21", "2026-03-22"],
  temperature_2m_max: [12, 14.5, null], temperature_2m_min: [3, 5, -2],
  precipitation_sum: [0, 2.5, 11], precipitation_probability_max: [10, 60, 95],
  et0_fao_evapotranspiration: [1.2, 1.5, 0.4], weather_code: [1, 61, 42],
};
const WEATHER: [string, unknown[]][] = [
  [weatherBody(DAILY, { temperature_2m: 9, weather_code: 2 }), ["C"]],
  [weatherBody(DAILY, { temperature_2m: 48.2, weather_code: 95 }), ["F"]],
  [weatherBody(DAILY), ["C"]],
  [weatherBody({ ...DAILY, weather_code: ["1", 0, 2.5] }, { temperature_2m: "9", weather_code: 99.5 }), ["C"]],
  [weatherBody({ time: ["2026-01-01", "not a date", 7], temperature_2m_max: [1] }, { weather_code: 0 }), ["F"]],
  [weatherBody({ time: "2026-01-01", precipitation_sum: [1, 2] }), ["C"]],
  [weatherBody(5, 7), ["C"]],
  [weatherBody({}), ["C"]],
  ["{}", ["C"]], ["null", ["C"]], ["[1,2]", ["C"]], ['"text"', ["F"]], ["{not json", ["C"]], ["", ["C"]],
];

const H = (date: unknown, name: unknown, localName: unknown, counties?: unknown) => ({ date, name, localName, ...(counties !== undefined ? { counties } : {}) });
const NAGER = JSON.stringify([
  H("2026-01-01", "New Year's Day", "Neujahr"),
  H("2026-01-06", "Epiphany", "Heilige Drei Könige", ["DE-BW", "DE-BY", "DE-ST"]),
  H("2026-04-03", "Good Friday", "Karfreitag", null),
  H("2026-05-01", "", "", []),
  H("2026-10-31", "Reformation Day", "Reformationstag", ["DE-BB", 5, "DE-ST"]),
  H("not a date", "Bad", "Bad"),
  H(20260101, "Number date", "x"),
  { name: "No date" },
  H("2026-12-25", 7, null),
]);
const HOLIDAYS: [string, unknown[]][] = [];
for (const region of ["", "DE-BY", " DE-ST ", "DE-XX"]) {
  for (const today of [46023, 46027, 46100, 46400]) HOLIDAYS.push([NAGER, [region, today]]);
}
HOLIDAYS.push(["[]", ["", 46023]], ["{}", ["", 46023]], ["{bad", ["", 46023]], ["null", ["", 46023]], ['"x"', ["DE-BY", 46023]]);

const FX_RATE: [string, unknown[]][] = [
  [JSON.stringify({ amount: 1, base: "EUR", date: "2026-03-20", rates: { USD: 1.0832 } }), ["USD"]],
  [JSON.stringify({ date: "2026-03-20", rates: { USD: 1.0832 } }), [" usd "]],
  [JSON.stringify({ date: "2026-03-20", rates: { GBP: 0.85 } }), ["USD"]],
  [JSON.stringify({ date: "2026-03-20", rates: { USD: "1.08" } }), ["USD"]],
  [JSON.stringify({ rates: { USD: 1.1 } }), ["USD"]],
  [JSON.stringify({ date: 5, rates: 7 }), ["USD"]],
  [JSON.stringify({ date: "garbage", rates: { USD: 2 } }), ["USD"]],
  ["null", ["USD"]], ["[1]", ["USD"]], ["{oops", ["USD"]], ["", ["USD"]],
];
const FX_SERIES: [string, unknown[]][] = [
  [JSON.stringify({ base: "EUR", rates: { "2026-03-20": { USD: 1.08 }, "2026-03-18": { USD: 1.07 }, "2026-03-19": { USD: 1.09, GBP: 0.8 } } }), ["USD"]],
  [JSON.stringify({ rates: { "2026-03-20": { GBP: 0.8 }, "2026-03-21": null, "2026-03-22": 5, "2026-03-23": { USD: "1" }, "2026-03-24": { USD: 1.2 } } }), ["usd"]],
  [JSON.stringify({ rates: {} }), ["USD"]],
  [JSON.stringify({ rates: 5 }), ["USD"]],
  [JSON.stringify({ rates: [{ USD: 1 }, { USD: 2 }] }), ["USD"]],
  [JSON.stringify({}), ["USD"]], ["null", ["USD"]], ["{x", ["USD"]],
];

const G = (o: Record<string, unknown>) => ({ id: 1, elevation: 800, country_code: "US", ...o });
const GEOCODE: string[] = [
  JSON.stringify({ results: [
    G({ name: "Boise", latitude: 43.6135, longitude: -116.2035, admin1: "Idaho", country: "United States", timezone: "America/Boise" }),
    G({ name: "Boise City", latitude: 36.7292, longitude: -102.5132, admin1: "Oklahoma", country: "United States" }),
    G({ name: "Nowhere", latitude: "1", longitude: 2 }),
    G({ name: "", latitude: 0, longitude: 0, admin1: "", country: "" }),
    G({ latitude: -33.8688, longitude: 151.2093, country: "Australia", timezone: 5 }),
    G({ name: 7, latitude: 1.5, longitude: 2.5, admin1: "Region" }),
  ] }),
  JSON.stringify({ generationtime_ms: 0.5 }),
  JSON.stringify({ results: "none" }),
  JSON.stringify({ results: [] }),
  "null", "[1]", "{bad", "",
];

function answer(c: Case): unknown {
  switch (c.kind) {
    case "weather": {
      const r = parseWeather(c.body, c.args[0] as "C" | "F");
      return plain([r.daily, r.nowTemp, r.nowCondition]);
    }
    case "holidays": {
      const r = holidaysOnCore(c.body, c.args[0] as string, c.args[1] as number);
      return plain([r.frame, r.next]);
    }
    case "fxRate": {
      const r = parseFxRate(c.body, c.args[0] as string);
      return plain([r.date, r.serial, r.rate]);
    }
    case "fxSeries":
      return plain(parseFxSeries(c.body, c.args[0] as string));
    case "geocode":
      return plain(parseGeocode(c.body).map((m) => [m.label, m.lat, m.lon, m.timezone]));
  }
}

describe("the data providers' parses hold to their frozen answers", () => {
  it("every body, well-formed and not", () => {
    const fresh: Case[] = [
      ...WEATHER.map(([body, args]) => ({ kind: "weather" as const, body, args })),
      ...HOLIDAYS.map(([body, args]) => ({ kind: "holidays" as const, body, args })),
      ...FX_RATE.map(([body, args]) => ({ kind: "fxRate" as const, body, args })),
      ...FX_SERIES.map(([body, args]) => ({ kind: "fxSeries" as const, body, args })),
      ...GEOCODE.map((body) => ({ kind: "geocode" as const, body, args: [] })),
    ].map((c) => ({ ...c, want: answer(c) }));
    const cases = frozen<Case>("providers", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => !isDeepStrictEqual(c.want, fresh[i].want)).map((c) => `${c.kind} ${c.body.slice(0, 40)} ${JSON.stringify(c.args)}`);
    expect(bad).toEqual([]);
  });
});
