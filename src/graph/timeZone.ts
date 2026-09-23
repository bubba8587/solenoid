// [[C44]] dateSerials
// Time-zone reinterpretation via Intl. Serials are wall-clock-as-UTC: read the components as the FROM zone's local
// time, find the true UTC instant, express it in the TO zone; DST falls out because the offset is read at that instant.
import { solError, type SolError } from "./errorValue";
import type { FrameValue } from "./frame";

const MS_PER_DAY = 86400000;
const EPOCH_OFFSET = 25569; // Excel serial of 1970-01-01

/** Runtime `Intl.supportedValuesOf` where available, with a static fallback so the list is never empty. */
export const IANA_ZONES: readonly string[] = (() => {
  try {
    const withValues = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = withValues.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch { /* fall through to the static list */ }
  return [
    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
    "Africa/Cairo", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo",
    "Asia/Singapore", "Australia/Sydney", "Pacific/Auckland",
  ];
})();

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Positive means ahead of UTC. */
export function zoneOffsetMs(zone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/** Two offset reads settle a value that lands beside a DST transition. */
function wallSerialToInstant(serial: number, zone: string): number {
  const wallMs = (serial - EPOCH_OFFSET) * MS_PER_DAY; // components taken as if UTC
  let off = zoneOffsetMs(zone, wallMs);
  off = zoneOffsetMs(zone, wallMs - off);
  return wallMs - off;
}

function instantToWallSerial(ms: number, zone: string): number {
  return (ms + zoneOffsetMs(zone, ms)) / MS_PER_DAY + EPOCH_OFFSET;
}

/** #VALUE! for an unknown zone or a non-finite serial. */
export function convertZone(serial: number, fromZone: string, toZone: string): number | SolError {
  if (!Number.isFinite(serial)) return solError("#VALUE!", "The date/time input is empty.");
  const from = fromZone.trim(), to = toZone.trim();
  if (!isValidZone(from)) return solError("#VALUE!", `Unknown time zone "${from}". Use an IANA name like America/New_York.`);
  if (!isValidZone(to)) return solError("#VALUE!", `Unknown time zone "${to}". Use an IANA name like Asia/Tokyo.`);
  return instantToWallSerial(wallSerialToInstant(serial, from), to);
}

export interface ClockRow { place: string; time: string; }

export function placeLabel(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** Formatted "Sun 14:32"; a blank entry is dropped, and an unknown zone keeps its name with a "?" time. */
export function worldClockRows(zones: readonly string[], nowMs: number): ClockRow[] {
  const out: ClockRow[] = [];
  for (const raw of zones) {
    const zone = raw.trim();
    if (zone === "") continue;
    if (!isValidZone(zone)) { out.push({ place: zone, time: "?" }); continue; }
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    out.push({ place: placeLabel(zone), time: dtf.format(new Date(nowMs)) });
  }
  return out;
}

export function worldClockFrame(rows: readonly ClockRow[]): FrameValue {
  return { __frame: true, columns: [
    { name: "Place", type: "string", values: rows.map((r) => r.place) },
    { name: "Local", type: "string", values: rows.map((r) => r.time) },
  ] };
}
