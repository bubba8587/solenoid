// [[D19]] implReteFree, [[C17]] shareImpl

import { solError, type SolError } from "../errorValue";

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

/** Sun position for a UTC date+time serial at lat/lon (degrees, east +). */
export function solarPosition(serial: number, lat: number, lon: number): SolarPosition {
  const { declination, eqOfTime } = solarBasis(serialToJulianDay(serial));
  const minutesUtc = ((serial % 1) + 1) % 1 * 1440;
  const trueSolarTime = (((minutesUtc + eqOfTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const zenith = DEG * Math.acos(
    Math.sin(RAD * lat) * Math.sin(RAD * declination) +
    Math.cos(RAD * lat) * Math.cos(RAD * declination) * Math.cos(RAD * hourAngle),
  );
  const elevation = 90 - zenith;
  const azDenom = Math.cos(RAD * lat) * Math.sin(RAD * zenith);
  let azimuth: number;
  if (Math.abs(azDenom) < 1e-9) {
    azimuth = lat > 0 ? 180 : 0; // sun due south/north at the poles' degenerate case
  } else {
    const azRad = (Math.sin(RAD * lat) * Math.cos(RAD * zenith) - Math.sin(RAD * declination)) / azDenom;
    const acos = DEG * Math.acos(Math.min(1, Math.max(-1, azRad)));
    azimuth = hourAngle > 0 ? (acos + 180) % 360 : (540 - acos) % 360;
  }
  return { elevation, azimuth, declination, eqOfTime };
}

export interface SunTimes {
  /** UTC serials; null when the sun never rises/sets (polar day/night). */
  sunrise: number | null;
  sunset: number | null;
  /** Hours of daylight: 24 in polar day, 0 in polar night. */
  dayLength: number;
}

/** Sunrise/sunset (UTC serials) for the DAY of `serial` at lat/lon — NOAA's
 *  zenith 90.833° (refraction + solar radius). */
export function sunTimes(serial: number, lat: number, lon: number): SunTimes {
  const day = Math.floor(serial);
  const { declination, eqOfTime } = solarBasis(serialToJulianDay(day + 0.5));
  const cosHa =
    Math.cos(RAD * 90.833) / (Math.cos(RAD * lat) * Math.cos(RAD * declination)) -
    Math.tan(RAD * lat) * Math.tan(RAD * declination);
  if (cosHa > 1) return { sunrise: null, sunset: null, dayLength: 0 };   // polar night
  if (cosHa < -1) return { sunrise: null, sunset: null, dayLength: 24 }; // polar day
  const haSunrise = DEG * Math.acos(cosHa);
  const solarNoon = (720 - 4 * lon - eqOfTime) / 1440;
  const sunrise = day + solarNoon - (haSunrise * 4) / 1440;
  const sunset = day + solarNoon + (haSunrise * 4) / 1440;
  return { sunrise, sunset, dayLength: (haSunrise * 8) / 60 };
}

const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH_SERIAL = 36531.7597; // 2000-01-06 18:14 UTC as an Excel serial

export interface MoonPhase {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase: number;
  /** Days since the last new moon. */
  age: number;
  /** Illuminated fraction of the disc, 0–1. */
  illumination: number;
}

export function moonPhase(serial: number): MoonPhase {
  const days = serial - NEW_MOON_EPOCH_SERIAL;
  const phase = ((days / SYNODIC_MONTH) % 1 + 1) % 1;
  return {
    phase,
    age: phase * SYNODIC_MONTH,
    illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2,
  };
}

export function latLonError(lat: number, lon: number): SolError | null {
  if (lat < -90 || lat > 90) return solError("#DOMAIN!", "Latitude runs −90 to 90");
  if (lon < -180 || lon > 180) return solError("#DOMAIN!", "Longitude runs −180 to 180 (east positive)");
  return null;
}
