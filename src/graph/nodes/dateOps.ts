// [[C17]] shareImpl, [[C44]] dateSerials, [[C24]] arraySemantics
// Entry points take date serials; a per-cell domain failure is a SolError, an undefined answer (DATEDIF over a reversed range) is `null`.
import { solError, type SolError } from "../errorValue";
import { serialToJsDate, jsDateToSerial } from "./dateSerial";

export function dateFromParts(rawY: number, rawM: number, rawD: number): number | SolError {
  const year = Math.floor(rawY), month = Math.floor(rawM), day = Math.floor(rawD);
  if (year < 1 || year > 9999) return solError("#DOMAIN!", "Year must be between 1 and 9999");
  // Date.UTC carries month and day overflow but remaps a 0–99 year to 1900–1999; setUTCFullYear shifts it back without remapping.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year <= 99) d.setUTCFullYear(d.getUTCFullYear() - 1900);
  return jsDateToSerial(d);
}

export type WeekInfoOp = "weekday" | "weeknum" | "isoweeknum";

export type DateDiffOp =
  | "days" | "days360" | "yearfrac"
  | "years" | "months" | "ym" | "md" | "yd";

export function dateDiffNeedsBasis(op: DateDiffOp): boolean {
  return op === "days360" || op === "yearfrac";
}

export type EpochUnit = "s" | "ms";

export type DateTruncUnit = "day" | "week" | "week_sun" | "month" | "quarter" | "year";

export function dateTrunc(serial: number, unit: DateTruncUnit, ceiling = false): number {
  const d = serialToJsDate(serial);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  let floor: Date;
  switch (unit) {
    case "day":      floor = new Date(Date.UTC(y, m, day)); break;
    case "week":     floor = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7))); break;
    case "week_sun": floor = new Date(Date.UTC(y, m, day - d.getUTCDay())); break;
    case "month":    floor = new Date(Date.UTC(y, m, 1)); break;
    case "quarter":  floor = new Date(Date.UTC(y, m - (m % 3), 1)); break;
    case "year":     floor = new Date(Date.UTC(y, 0, 1)); break;
  }
  const f = jsDateToSerial(floor);
  if (!ceiling || f === serial) return f;
  switch (unit) {
    case "day":      return f + 1;
    case "week": case "week_sun": return f + 7;
    case "month":    return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth() + 1, 1)));
    case "quarter":  return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth() + 3, 1)));
    case "year":     return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear() + 1, 0, 1)));
  }
}


