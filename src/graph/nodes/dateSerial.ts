// ─── Pure date-serial layer — rete-free by design (FX-2) ─────────────────────
// Serial ↔ JS Date conversion, text parsing and token formatting, extracted from
// date.ts so the formula path (excelFunctions), financeOps, frameVerbs and
// coerceInputs can read a date serial without dragging rete and the socket
// lattice into the headless evaluator. date.ts (the NODES) imports from here;
// nothing here may import a module that reaches rete (rules.md FX-2, enforced
// by formulaPathIsReteFree.test.ts).

// Excel serial 1 = Jan 1, 1900; JS epoch (Jan 1, 1970) = serial 25569.

export function serialToJsDate(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

export function jsDateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

// Parse a date string ("2026-01-03", "Jan 3 2026", ISO datetime, …) to an Excel
// serial. Returns NaN when it isn't a parseable date. The ONE canonical text→date
// parser — shared by DateValue (DATEVALUE), Cast(date), and Get Column's read-as
// Date — so all three agree on what a date string means. Does NOT floor the time
// component; callers that want date-only (DATEVALUE) floor the result themselves.
export function parseDateToSerial(s: string): number {
  const t = s.trim();
  if (!t) return NaN;
  // A year token must be EXACTLY four digits — no 2-digit-year century guessing
  // (Excel's 00–29 pivot goes stale; it's 2026 now), in ANY form. A date string
  // with no 4-digit run anywhere can only parse by guessing the century (or the
  // whole year), so it is NOT a date: "1/15/26", "20-Mar-26" (JS would guess
  // 2026), bare "Mar 20" (JS guesses 2001!) → NaN; write the 4-digit year.
  // ISO date-only ("0026-01-15") has a 4-digit token and parses as 26 AD.
  if (!/\d{4}/.test(t)) return NaN;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return NaN;
  // Zone-less text must mean the same calendar date on every machine. new Date()
  // reads ISO date-only forms ("2026-01-03") as UTC midnight but everything else
  // ("01-Jan-2026", "Jan 3 2026", "2026-01-03T10:00") as LOCAL wall-clock, so a
  // raw getTime()-based serial shifts with the machine's timezone (off-by-one day
  // east of UTC, fractional serials everywhere else). Rebuild the wall-clock via
  // Date.UTC from whichever getters match the parse interpretation; an explicit
  // zone designator means an absolute instant, which is already TZ-independent.
  // A zone designator only counts after a time component — a bare trailing
  // "[+-]dddd" is otherwise indistinguishable from a "-2026" year.
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

/**
 * Format a date serial with a token pattern (YYYY, MM, DD, MMMM, HH, mm, A, …).
 * Shared by Cast-to-text and the Format Controller's date styles.
 */
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

