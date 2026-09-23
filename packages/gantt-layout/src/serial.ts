// [[C69]] ganttPackages, [[C44]] dateSerials, [[D65]] serialsNeverDate

export const UNIX_EPOCH_SERIAL = 25569;

/** Floors toward negative infinity: window padding can reach before the epoch, where `/ | 0` and `Math.trunc` break the era math. */
function fdiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export interface Civil {
  year: number;
  month: number;
  day: number;
}

export function civilFromSerial(serial: number): Civil {
  let z = Math.floor(serial) - UNIX_EPOCH_SERIAL + 719468;
  const era = fdiv(z >= 0 ? z : z - 146096, 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100)); // [0, 365]
  const mp = fdiv(5 * doy + 2, 153); // [0, 11]
  const day = doy - fdiv(153 * mp + 2, 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? y + 1 : y, month, day };
}

export function serialFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = fdiv(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = fdiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + fdiv(yoe, 4) - fdiv(yoe, 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468 + UNIX_EPOCH_SERIAL;
}

/** 1969-12-28 (serial 25565) was a Sunday, hence the `UNIX_EPOCH_SERIAL - 4` anchor. */
export function dayOfWeek(serial: number): number {
  const n = Math.floor(serial) - (UNIX_EPOCH_SERIAL - 4);
  return ((n % 7) + 7) % 7;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

export function startOfMonth(serial: number): number {
  const c = civilFromSerial(serial);
  return serialFromCivil(c.year, c.month, 1);
}

export function addMonths(serial: number, n: number): number {
  const c = civilFromSerial(serial);
  const m0 = c.year * 12 + (c.month - 1) + n;
  const year = fdiv(m0, 12);
  const month = m0 - year * 12 + 1;
  const day = Math.min(c.day, daysInMonth(year, month));
  return serialFromCivil(year, month, day);
}

export function startOfYear(serial: number): number {
  return serialFromCivil(civilFromSerial(serial).year, 1, 1);
}

export function startOfWeek(serial: number, weekStartsOn: number): number {
  const d = dayOfWeek(serial);
  const back = ((d - weekStartsOn) % 7 + 7) % 7;
  return Math.floor(serial) - back;
}

export function isoWeek(serial: number): number {
  const thursday = startOfWeek(serial, 1) + 3;
  const c = civilFromSerial(thursday);
  const jan1 = serialFromCivil(c.year, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}

export function usWeek(serial: number): number {
  const c = civilFromSerial(serial);
  const jan1 = serialFromCivil(c.year, 1, 1);
  const firstSunday = startOfWeek(jan1, 0);
  const thisSunday = startOfWeek(serial, 0);
  return Math.floor((thisSunday - firstSunday) / 7) + 1;
}

export function fiscalQuarter(serial: number, fiscalStart: number): { quarter: number; fiscalYear: number } {
  const c = civilFromSerial(serial);
  const offset = ((c.month - fiscalStart) % 12 + 12) % 12;
  const quarter = Math.floor(offset / 3) + 1;
  const fiscalYear = c.month >= fiscalStart ? c.year : c.year - 1;
  return { quarter, fiscalYear };
}

export function startOfFiscalQuarter(serial: number, fiscalStart: number): number {
  const c = civilFromSerial(serial);
  const offset = ((c.month - fiscalStart) % 12 + 12) % 12;
  return addMonths(serialFromCivil(c.year, c.month, 1), -(offset % 3));
}

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
