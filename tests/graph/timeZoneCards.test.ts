// [[C44]] dateSerials, [[C130]] rustCore
import { describe, it, expect, vi, afterEach } from "vitest";
import { convertZone } from "../../src/graph/timeZone";
import { TimeZoneConvertNode, WorldClockNode } from "../../src/graph/nodes/date";
import { isSolError } from "../../src/graph/errorValue";

// The two zone cards over real zones: each side of DST transitions, offset zones, aliases, case variants and bad
// names. These calls are also the cases the cards' bodies on the core are held to (fixtures/core/nodes/), which is
// where the native build's bundled tzdb meets Intl, so they keep to zones and instants on which the two releases agree.
const H = 3600000;
const M = 60000;
const DAY = 86400000;
const toSerial = (ms: number) => ms / DAY + 25569;
const serial = (y: number, mo: number, d: number, h = 0, mi = 0) => toSerial(Date.UTC(y, mo - 1, d, h, mi, 0));

const formats = new Map<string, Intl.DateTimeFormat>();
/** `zoneOffsetMs`'s read with its formatter kept, for the scans. */
function offsetOf(zone: string, ms: number): number {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", era: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(zone, f);
  }
  const p: Record<string, number> = {};
  let bc = false;
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type === "era") bc = part.value === "BC";
    else if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = new Date(0);
  wall.setUTCFullYear(bc ? 1 - p.year : p.year, p.month - 1, p.day);
  wall.setUTCHours(p.hour, p.minute, p.second, 0);
  return wall.getTime() - ms;
}

/** The instants in [from, to) where a zone's offset changes, to the second, read every `step`. */
function transitions(zone: string, from: number, to: number, step = 6 * H): number[] {
  const out: number[] = [];
  let prev = offsetOf(zone, from);
  for (let t = from + step; t <= to; t += step) {
    const o = offsetOf(zone, t);
    if (o === prev) continue;
    let lo = t - step, hi = t;
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
      if (offsetOf(zone, mid) === prev) lo = mid; else hi = mid;
    }
    out.push(hi);
    prev = o;
  }
  return out;
}

const DST_ZONES = [
  "America/New_York", "America/Los_Angeles", "America/St_Johns", "America/Santiago", "America/Havana",
  "America/Asuncion", "America/Nuuk", "Europe/London", "Europe/Dublin", "Europe/Berlin", "Africa/Cairo",
  "Asia/Beirut", "Asia/Gaza", "Asia/Jerusalem", "Australia/Sydney", "Australia/Adelaide", "Australia/Lord_Howe",
  "Pacific/Auckland", "Pacific/Chatham", "Antarctica/Troll",
];
const FIXED_ZONES = ["UTC", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Tokyo", "Asia/Tehran", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Etc/GMT+5", "Etc/GMT-14"];
const ALIASES = [
  "Asia/Calcutta", "US/Eastern", "US/Pacific", "EST", "NZ", "GB", "Eire", "Japan", "Zulu", "SystemV/AST4", "Etc/Universal",
  "PST", "IST", "JST", "AET", "Canada/East-Saskatchewan", "US/Pacific-New",
];
const CASES = ["america/new_york", "AMERICA/NEW_YORK", "utc", "Utc", "europe/LONDON", "etc/gmt+5", "us/eastern", "systemv/ast4", "est", "pst", "Jst"];
const OFFSETS = ["+05:30", "-0800", "+14", "−03:00", "+23:59", "-23:59", "+00", "-00:00", "+0545"];
const BAD = ["Nowhere/Land", "America/New York", "EUROPE/İSTANBUL", "Etc/Unknown", "GMT+5", "+24:00", "+5:30", "+05:30:00", "+0560", "Z", "America/", "Factory"];

describe("Time Zone Convert card", () => {
  const card = (datetime: number, from: string, to: string) =>
    new TimeZoneConvertNode().data({ datetime: [datetime], from: [from], to: [to] }).result;

  it("crosses the New York spring gap and autumn overlap as Intl reads them", () => {
    expect(card(serial(2026, 3, 8, 1, 59), "America/New_York", "UTC")).toBeCloseTo(serial(2026, 3, 8, 6, 59), 9);
    expect(card(serial(2026, 3, 8, 3, 0), "America/New_York", "UTC")).toBeCloseTo(serial(2026, 3, 8, 7, 0), 9);
    // A repeated wall time reads as the earlier instant, still on daylight time.
    expect(card(serial(2026, 11, 1, 1, 30), "America/New_York", "UTC")).toBeCloseTo(serial(2026, 11, 1, 5, 30), 9);
    expect(card(serial(2026, 3, 8, 7, 0), "UTC", "America/New_York")).toBeCloseTo(serial(2026, 3, 8, 3, 0), 9);
    expect(card(serial(2026, 3, 8, 6, 59), "UTC", "America/New_York")).toBeCloseTo(serial(2026, 3, 8, 1, 59), 9);
  });

  it("reads half-hour, 45-minute and offset zones", () => {
    expect(card(serial(2026, 1, 15, 12, 0), "Asia/Kolkata", "UTC")).toBeCloseTo(serial(2026, 1, 15, 6, 30), 9);
    expect(card(serial(2026, 1, 15, 12, 0), "UTC", "Asia/Kathmandu")).toBeCloseTo(serial(2026, 1, 15, 17, 45), 9);
    expect(card(serial(2026, 1, 15, 12, 0), "+05:30", "UTC")).toBeCloseTo(serial(2026, 1, 15, 6, 30), 9);
    expect(card(serial(2026, 1, 15, 12, 0), "UTC", "−03:00")).toBeCloseTo(serial(2026, 1, 15, 9, 0), 9);
    expect(card(serial(2026, 1, 15, 12, 0), "UTC", "Etc/GMT+5")).toBeCloseTo(serial(2026, 1, 15, 7, 0), 9);
  });

  it("matches names without regard to ASCII case, and trims them", () => {
    const s = serial(2026, 7, 4, 12, 0);
    for (const name of ["america/new_york", "AMERICA/NEW_YORK", "  America/New_York  ", "US/Eastern"]) {
      expect(card(s, name, "Asia/Tokyo"), name).toBeCloseTo(serial(2026, 7, 5, 1, 0), 9);
    }
  });

  it("answers #VALUE! for a name Intl refuses, and nothing for a blank", () => {
    for (const bad of BAD) {
      const r = card(serial(2026, 1, 1), bad, "UTC");
      expect(isSolError(r) && r.code, bad).toBe("#VALUE!");
      const r2 = card(serial(2026, 1, 1), "UTC", bad);
      expect(isSolError(r2) && r2.code, bad).toBe("#VALUE!");
    }
    expect(card(serial(2026, 1, 1), "", "UTC")).toBeNull();
    expect(card(serial(2026, 1, 1), "UTC", "   ")).toBeNull();
    expect(card(NaN, "UTC", "Asia/Tokyo")).toBeNull();
    expect(new TimeZoneConvertNode().data({ from: ["UTC"], to: ["Asia/Tokyo"] }).result).toBeNull();
  });

  it("keeps the year before 100 and before 1 AD, which Date.UTC would read as the 1900s", () => {
    const early = (y: number) => {
      const d = new Date(0);
      d.setUTCFullYear(y, 0, 1);
      d.setUTCHours(12);
      return toSerial(d.getTime());
    };
    for (const y of [50, 0, -50]) {
      expect(card(early(y), "UTC", "UTC"), String(y)).toBe(early(y));
      expect(card(early(y), "UTC", "+05:30"), String(y)).toBeCloseTo(early(y) + 5.5 / 24, 9);
      expect(card(early(y), "-08:00", "UTC"), String(y)).toBeCloseTo(early(y) + 8 / 24, 9);
      expect(convertZone(early(y), "UTC", "+05:30"), String(y)).toBe(card(early(y), "UTC", "+05:30"));
    }
  });

  it("reads the typed zones when From and To are unwired", () => {
    const node = new TimeZoneConvertNode();
    node.stringLiterals = { from: "Europe/London", to: "Australia/Sydney" };
    expect(node.data({ datetime: [serial(2026, 1, 15, 9, 0)] }).result).toBeCloseTo(serial(2026, 1, 15, 20, 0), 9);
  });

  it("agrees with the formula on each side of every transition, there and back", () => {
    for (const zone of DST_ZONES) {
      const edges = [
        ...transitions(zone, Date.UTC(1800, 0, 1), Date.UTC(1925, 0, 1), 30 * DAY).slice(0, 2),
        ...transitions(zone, Date.UTC(1943, 0, 1), Date.UTC(1946, 0, 1)),
        ...transitions(zone, Date.UTC(2026, 0, 1), Date.UTC(2028, 0, 1)),
      ];
      for (const t of edges) {
        for (const d of [-1000, 0, 30 * M]) {
          const s = toSerial(t + d);
          expect(card(s, "UTC", zone), `${zone} ${new Date(t + d).toISOString()}`).toBe(convertZone(s, "UTC", zone));
          const wall = toSerial(t + d + offsetOf(zone, t + d));
          expect(card(wall, zone, "UTC"), `${zone} ${new Date(t + d).toISOString()}`).toBe(convertZone(wall, zone, "UTC"));
        }
      }
    }
  }, 60_000);

  it("holds every kind of zone across the calendar's span", () => {
    const at = [
      serial(2026, 1, 15, 12, 0), serial(2026, 7, 15, 12, 0), serial(1850, 6, 1, 12, 0), serial(1900, 1, 1, 0, 0),
      serial(2200, 7, 1, 12, 0), serial(9999, 12, 31, 23, 59), serial(100000, 7, 1, 12, 0), -1000.25, 0, 60.5, serial(2026, 7, 15, 12, 0) + 0.5 / 86400,
    ];
    const zones = [...DST_ZONES, ...FIXED_ZONES, ...ALIASES, ...CASES, ...OFFSETS];
    for (const s of at) {
      for (const zone of zones) {
        expect(card(s, zone, "Asia/Tokyo"), `${zone} ${s}`).toBe(convertZone(s, zone, "Asia/Tokyo"));
        expect(card(s, "America/New_York", zone), `${zone} ${s}`).toBe(convertZone(s, "America/New_York", zone));
      }
    }
  }, 60_000);
});

describe("World Clock card", () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = (ms: number, zones: (string | null)[]) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ms);
    const cols = new WorldClockNode().data({ zones: [zones] }).clock.columns;
    return cols[0].values.map((p, i) => `${p} ${cols[1].values[i]}`);
  };

  it("shows each zone's weekday and wall clock, to the minute", () => {
    expect(at(Date.UTC(2026, 0, 1, 12, 0, 0), ["UTC", "Asia/Tokyo", "Asia/Kolkata", "America/St_Johns"]))
      .toEqual(["UTC Thu 12:00", "Tokyo Thu 21:00", "Kolkata Thu 17:30", "St Johns Thu 08:30"]);
  });

  it("turns the clock at the DST edges, on both sides", () => {
    expect(at(Date.UTC(2026, 2, 8, 6, 59, 59), ["America/New_York"])).toEqual(["New York Sun 01:59"]);
    expect(at(Date.UTC(2026, 2, 8, 7, 0, 0), ["America/New_York"])).toEqual(["New York Sun 03:00"]);
    expect(at(Date.UTC(2026, 10, 1, 5, 59, 59), ["America/New_York"])).toEqual(["New York Sun 01:59"]);
    expect(at(Date.UTC(2026, 10, 1, 6, 0, 0), ["America/New_York"])).toEqual(["New York Sun 01:00"]);
    expect(at(Date.UTC(2026, 3, 4, 15, 59, 59), ["Australia/Sydney"])).toEqual(["Sydney Sun 02:59"]);
    expect(at(Date.UTC(2026, 3, 4, 16, 0, 0), ["Australia/Sydney"])).toEqual(["Sydney Sun 02:00"]);
  });

  it("reads the typed zones when Zones is unwired", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 0));
    const node = new WorldClockNode();
    node.stringLiterals = { zones: "UTC, Asia/Tokyo,, " };
    const cols = node.data({}).clock.columns;
    expect(cols[0].values.map((p, i) => `${p} ${cols[1].values[i]}`)).toEqual(["UTC Thu 12:00", "Tokyo Thu 21:00"]);
  });

  it("keeps a name as typed, marks one Intl refuses and drops blanks", () => {
    expect(at(Date.UTC(2026, 0, 1, 12, 0, 0), ["america/new_york", "+05:30", "Nowhere/Land", "  ", null, " Asia/Tokyo "]))
      .toEqual(["new york Thu 07:00", "+05:30 Thu 17:30", "Nowhere/Land ?", "Tokyo Thu 21:00"]);
  });

  it("reads every kind of zone at each side of its transitions", () => {
    const zones = [...DST_ZONES, ...FIXED_ZONES, ...ALIASES, ...CASES, ...OFFSETS, ...BAD];
    const instants = [Date.UTC(1850, 5, 1), Date.UTC(1999, 11, 31, 23, 59, 59), Date.UTC(2300, 6, 1, 12, 30), Date.UTC(100000, 0, 1), Date.UTC(275760, 6, 1), 8.64e15, -1, 0, Date.UTC(-50, 0, 1)];
    for (const zone of DST_ZONES) {
      for (const t of transitions(zone, Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1))) instants.push(t - 1000, t);
    }
    for (const t of instants) {
      const rows = at(t, zones);
      expect(rows.length, new Date(t).toISOString()).toBe(zones.length);
      expect(rows.filter((r) => r.endsWith(" ?")).length, new Date(t).toISOString()).toBe(BAD.length);
    }
  });
});
