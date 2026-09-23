// [[C76]] formulaPackDefault, [[C44]] dateSerials, [[D12]] dateValuedPortIsDateTyped

import { ClassicPreset } from "rete";
import { numIn, numOut, dateIn, dateOut, readInput } from "./shared";
import type { SolError } from "../errorValue";
import { solarPosition, sunTimes, moonPhase, latLonError } from "./astroOps";

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
