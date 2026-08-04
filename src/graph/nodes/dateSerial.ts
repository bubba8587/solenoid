// Nothing here may import a module that reaches rete — the formula path stays
// headless (rules.md FX-2, enforced by formulaPathIsReteFree.test.ts).

// Excel serial 1 = Jan 1, 1900; JS epoch (Jan 1, 1970) = serial 25569.

export function serialToJsDate(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

export function jsDateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

// The ONE canonical text→date parser (DATEVALUE, Cast(date), Get Column read-as):
// NaN when unparseable, and the time component is NOT floored — callers do that.
export function parseDateToSerial(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  // Without a 4-digit run the year can only be guessed (JS reads bare "Mar 20" as
  // 2001), so it is not a date — no 2-digit-year century pivot in any form.
  if (!/\d{4}/.test(t)) return NaN;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return NaN;
  // Zone-less text must mean the same calendar date on every machine: new Date()
  // reads ISO date-only as UTC but every other form as LOCAL, so rebuild the wall
  // clock via Date.UTC. A zone designator counts only after a time component — a bare
  // trailing "[+-]dddd" is indistinguishable from a "-2026" year.
  const hasTime = /\d\s*:\s*\d/.test(t);
  const hasZone = hasTime && /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i.test(t);
  const isoDateOnly = /^[+-]?\d{4,6}-\d{2}(?:-\d{2})?$/.test(t);
  const ms = hasZone || isoDateOnly
    ? d.getTime()
    : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return ms / 86400000 + 25569;
}


export const DEFAULT_DATE_FORMAT = "DD-MMM-YYYY";
export const DEFAULT_DATETIME_FORMAT = "DD-MMM-YYYY HH:mm";

const FORMAT_MONTHS = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
const FORMAT_DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** Format a date serial with a token pattern (YYYY, MM, DD, MMMM, HH, mm, A, …). */
export function formatDateSerial(serial: number, pattern: string): string {
  if (!Number.isFinite(serial)) return String(serial);
  const d = serialToJsDate(serial);
  const YYYY = String(d.getUTCFullYear()).padStart(4, "0");
  const MM   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const DD   = String(d.getUTCDate()).padStart(2, "0");
  const HH   = String(d.getUTCHours()).padStart(2, "0");
  const mi   = String(d.getUTCMinutes()).padStart(2, "0");
  const ss   = String(d.getUTCSeconds()).padStart(2, "0");
  return pattern.replace(
    /MMMM|MMM|MM|M|DDDD|DDD|DD|D|YYYY|YY|HH|hh|h|mm|ss|A|a/g,
    (token) => {
      switch (token) {
        case "MMMM": return FORMAT_MONTHS[d.getUTCMonth()];
        case "MMM":  return FORMAT_MONTHS[d.getUTCMonth()].slice(0, 3);
        case "MM":   return MM;
        case "M":    return String(d.getUTCMonth() + 1);
        case "DDDD": return FORMAT_DAYS[d.getUTCDay()];
        case "DDD":  return FORMAT_DAYS[d.getUTCDay()].slice(0, 3);
        case "DD":   return DD;
        case "D":    return String(d.getUTCDate());
        case "YYYY": return YYYY;
        case "YY":   return YYYY.slice(-2);
        case "HH":   return HH;
        case "hh":   return String(d.getUTCHours() % 12 || 12).padStart(2, "0");
        case "h":    return String(d.getUTCHours() % 12 || 12);
        case "mm":   return mi;
        case "ss":   return ss;
        case "A":    return d.getUTCHours() < 12 ? "AM" : "PM";
        case "a":    return d.getUTCHours() < 12 ? "am" : "pm";
        default:     return token;
      }
    }
  );
}

