// [[C76]] formulaPackDefault, [[C44]] dateSerials

import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut, dateIn, dateOut } from "./shared";
import type { SolError } from "../errorValue";

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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { elevation: number | SolError | null; azimuth: number | SolError | null; declination: number | SolError | null };
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { sunrise: number | SolError | null; sunset: number | SolError | null; daylength: number | SolError | null };
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { phase: number | SolError | null; age: number | SolError | null; illumination: number | SolError | null };
  }
}
