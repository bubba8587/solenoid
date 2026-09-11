// Time-zone reinterpretation via Intl (zero deps, IANA names). PURE + fixture-tested.
// Solenoid date serials are wall-clock-as-UTC, so converting a datetime between zones is:
// read the serial's wall-clock components AS the FROM zone's local time, find the true UTC
// instant, express that instant in the TO zone, and rebuild the serial. DST falls out for
// free because the zone offset is read AT the relevant instant.
import { solError, type SolError } from "./errorValue";
import type { FrameValue } from "./frame";

const MS_PER_DAY = 86400000;
const EPOCH_OFFSET = 25569; // Excel serial of 1970-01-01

/** True when `zone` resolves as an IANA name. */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `zone`'s offset from UTC in ms AT the UTC instant `utcMs` (positive = ahead of UTC):
 *  the wall clock the zone shows at that instant, minus UTC. */
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

/** The true UTC instant (ms) for a serial whose wall-clock components are read in `zone`.
 *  Two offset reads settle a value that lands beside a DST transition. */
function wallSerialToInstant(serial: number, zone: string): number {
  const wallMs = (serial - EPOCH_OFFSET) * MS_PER_DAY; // components taken as if UTC
  let off = zoneOffsetMs(zone, wallMs);
  off = zoneOffsetMs(zone, wallMs - off);
  return wallMs - off;
}

/** The serial whose wall-clock components equal `zone`'s local time at UTC instant `ms`. */
function instantToWallSerial(ms: number, zone: string): number {
  return (ms + zoneOffsetMs(zone, ms)) / MS_PER_DAY + EPOCH_OFFSET;
}

/** Reinterpret a datetime serial from `fromZone`'s wall clock into `toZone`'s. A #VALUE!
 *  for an unknown zone or a non-finite serial. */
export function convertZone(serial: number, fromZone: string, toZone: string): number | SolError {
  if (!Number.isFinite(serial)) return solError("#VALUE!", "The date/time input is empty.");
  const from = fromZone.trim(), to = toZone.trim();
  if (!isValidZone(from)) return solError("#VALUE!", `Unknown time zone "${from}". Use an IANA name like America/New_York.`);
  if (!isValidZone(to)) return solError("#VALUE!", `Unknown time zone "${to}". Use an IANA name like Asia/Tokyo.`);
  return instantToWallSerial(wallSerialToInstant(serial, from), to);
}

export interface ClockRow { place: string; time: string; }

/** A zone name's readable place: the last path segment with underscores spaced. */
export function placeLabel(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** Each zone's current local time at UTC instant `nowMs`, formatted "Sun 14:32". A blank
 *  entry is dropped; an unknown zone keeps its name with a "?" time. */
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

/** The World Clock frame: a row per zone (place, local time). */
export function worldClockFrame(rows: readonly ClockRow[]): FrameValue {
  return { __frame: true, columns: [
    { name: "Place", type: "string", values: rows.map((r) => r.place) },
    { name: "Local", type: "string", values: rows.map((r) => r.time) },
  ] };
}
