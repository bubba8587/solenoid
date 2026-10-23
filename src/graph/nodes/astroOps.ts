// [[C17]] shareImpl

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Excel/Solenoid date serial (UTC wall-clock) → Julian Day. */
export function serialToJulianDay(serial: number): number {
  return serial + 2415018.5;
}

export interface SolarBasis {
  /** Solar declination, degrees. */
  declination: number;
  /** Equation of time, minutes. */
  eqOfTime: number;
}

export function solarBasis(jd: number): SolarBasis {
  const jc = (jd - 2451545) / 36525;
  const meanLong = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const eqOfCtr =
    Math.sin(RAD * meanAnom) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(RAD * 2 * meanAnom) * (0.019993 - 0.000101 * jc) +
    Math.sin(RAD * 3 * meanAnom) * 0.000289;
  const trueLong = meanLong + eqOfCtr;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(RAD * (125.04 - 1934.136 * jc));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(RAD * (125.04 - 1934.136 * jc));
  const declination = DEG * Math.asin(Math.sin(RAD * obliq) * Math.sin(RAD * appLong));
  const varY = Math.tan(RAD * (obliq / 2)) ** 2;
  const eqOfTime =
    4 * DEG * (
      varY * Math.sin(2 * RAD * meanLong) -
      2 * ecc * Math.sin(RAD * meanAnom) +
      4 * ecc * varY * Math.sin(RAD * meanAnom) * Math.cos(2 * RAD * meanLong) -
      0.5 * varY * varY * Math.sin(4 * RAD * meanLong) -
      1.25 * ecc * ecc * Math.sin(2 * RAD * meanAnom)
    );
  return { declination, eqOfTime };
}

export interface SolarPosition {
  elevation: number;  // degrees above the horizon (geometric, no refraction)
  azimuth: number;    // degrees clockwise from north
  declination: number;
  eqOfTime: number;   // minutes
}

export interface SunTimes {
  /** UTC serials; null when the sun never rises/sets (polar day/night). */
  sunrise: number | null;
  sunset: number | null;
  /** Hours of daylight: 24 in polar day, 0 in polar night. */
  dayLength: number;
}

export interface MoonPhase {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase: number;
  /** Days since the last new moon. */
  age: number;
  /** Illuminated fraction of the disc, 0–1. */
  illumination: number;
}

