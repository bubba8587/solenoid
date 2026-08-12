// Earth & Sky pack: the NOAA Solar Calculator formulation (a published standard,
// per the reference-pack licensing rule); serial dates, degrees at the sockets.

import { ClassicPreset } from "rete";
import { numIn, numOut, dateIn, dateOut, readInput } from "./shared";
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

// Moon age from a reference new moon modulo the MEAN synodic month — good to
// roughly ±half a day, so it is honest for calendars but not for eclipse work.

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

export class SolarPositionNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { lat: 0, lon: 0 };
  cachedElevation: number | SolError | null = null;
  cachedAzimuth: number | SolError | null = null;
  cachedDeclination: number | SolError | null = null;
  width = 220;
  height = 230;

  constructor(init?: { label?: string }) {
    super("SolarPosition");
    this.label = init?.label ?? "Sun Position";
    this.addInput("when", dateIn("Date & time (UTC)"));
    this.addInput("lat", numIn("Latitude °"));
    this.addInput("lon", numIn("Longitude °"));
    this.addOutput("elevation", numOut("Elevation °"));
    this.addOutput("azimuth", numOut("Azimuth °"));
    this.addOutput("declination", numOut("Declination °"));
  }

  data(inputs: { when?: (number | null)[]; lat?: (number | null)[]; lon?: (number | null)[] }) {
    const when = inputs.when?.[0] ?? null;
    const lat = readInput(inputs.lat, this.literals.lat);
    const lon = readInput(inputs.lon, this.literals.lon);
    let elevation: number | SolError | null = null;
    let azimuth: number | SolError | null = null;
    let declination: number | SolError | null = null;
    if (typeof when === "number" && typeof lat === "number" && typeof lon === "number") {
      const err = latLonError(lat, lon);
      if (err) {
        elevation = azimuth = declination = err;
      } else {
        const p = solarPosition(when, lat, lon);
        elevation = p.elevation; azimuth = p.azimuth; declination = p.declination;
      }
    }
    this.cachedElevation = elevation;
    this.cachedAzimuth = azimuth;
    this.cachedDeclination = declination;
    return { elevation, azimuth, declination };
  }
}

export class SunriseSunsetNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { lat: 0, lon: 0 };
  cachedSunrise: number | SolError | null = null;
  cachedSunset: number | SolError | null = null;
  cachedDayLength: number | SolError | null = null;
  width = 220;
  height = 220;

  constructor(init?: { label?: string }) {
    super("SunriseSunset");
    this.label = init?.label ?? "Sunrise / Sunset";
    this.addInput("when", dateIn("Date"));
    this.addInput("lat", numIn("Latitude °"));
    this.addInput("lon", numIn("Longitude °"));
    this.addOutput("sunrise", dateOut("Sunrise (UTC)"));
    this.addOutput("sunset", dateOut("Sunset (UTC)"));
    this.addOutput("daylength", numOut("Day length h"));
  }

  data(inputs: { when?: (number | null)[]; lat?: (number | null)[]; lon?: (number | null)[] }) {
    const when = inputs.when?.[0] ?? null;
    const lat = readInput(inputs.lat, this.literals.lat);
    const lon = readInput(inputs.lon, this.literals.lon);
    let sunrise: number | SolError | null = null;
    let sunset: number | SolError | null = null;
    let daylength: number | SolError | null = null;
    if (typeof when === "number" && typeof lat === "number" && typeof lon === "number") {
      const err = latLonError(lat, lon);
      if (err) {
        sunrise = sunset = daylength = err;
      } else {
        const t = sunTimes(when, lat, lon);
        sunrise = t.sunrise; sunset = t.sunset; daylength = t.dayLength; // null = polar day/night
      }
    }
    this.cachedSunrise = sunrise;
    this.cachedSunset = sunset;
    this.cachedDayLength = daylength;
    return { sunrise, sunset, daylength };
  }
}

export class MoonPhaseNode extends ClassicPreset.Node {
  label: string;
  cachedPhase: number | SolError | null = null;
  cachedAge: number | SolError | null = null;
  cachedIllumination: number | SolError | null = null;
  width = 210;
  height = 200;

  constructor(init?: { label?: string }) {
    super("MoonPhase");
    this.label = init?.label ?? "Moon Phase";
    this.addInput("when", dateIn("Date"));
    this.addOutput("phase", numOut("Phase 0–1"));
    this.addOutput("age", numOut("Age days"));
    this.addOutput("illumination", numOut("Illuminated"));
  }

  data(inputs: { when?: (number | null)[] }) {
    const when = inputs.when?.[0] ?? null;
    let phase: number | SolError | null = null;
    let age: number | SolError | null = null;
    let illumination: number | SolError | null = null;
    if (typeof when === "number") {
      const m = moonPhase(when);
      phase = m.phase; age = m.age; illumination = m.illumination;
    }
    this.cachedPhase = phase;
    this.cachedAge = age;
    this.cachedIllumination = illumination;
    return { phase, age, illumination };
  }
}
