// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { solarPosition, sunTimes, moonPhase, latLonError } from "../nodes/astroOps";
import { solError } from "../errorValue";
import type { PackFormula } from "./packShared";

const geo = (when: unknown, lat: unknown, lon: unknown): { w: number; la: number; lo: number } | ReturnType<typeof latLonError> | null => {
  if (when == null || lat == null || lon == null) return null;
  const w = Number(when), la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(w) || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return latLonError(la, lo) ?? { w, la, lo };
};
const isGeo = (g: unknown): g is { w: number; la: number; lo: number } =>
  typeof g === "object" && g !== null && "w" in g;

export const EARTHSKY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "SUNPOSITION",
    impl: (when, lat, lon, part) => {
      const g = geo(when, lat, lon);
      if (!isGeo(g)) return g;
      const p = part == null ? "elevation" : String(part).toLowerCase();
      const r = solarPosition(g.w, g.la, g.lo);
      if (p === "elevation") return r.elevation;
      if (p === "azimuth") return r.azimuth;
      if (p === "declination") return r.declination;
      return solError("#VALUE!", `Unknown part "${p}" — elevation, azimuth, declination`);
    },
    returns: "number", arity: [3, 4],
    signature: "datetime UTC, lat, lon, [part (elevation)]",
  },
  {
    name: "SUNRISE",
    impl: (when, lat, lon) => {
      const g = geo(when, lat, lon);
      return isGeo(g) ? sunTimes(g.w, g.la, g.lo).sunrise : g;
    },
    returns: "date", arity: [3, 3],
    signature: "date, lat, lon — UTC; blank in polar night/day",
  },
  {
    name: "SUNSET",
    impl: (when, lat, lon) => {
      const g = geo(when, lat, lon);
      return isGeo(g) ? sunTimes(g.w, g.la, g.lo).sunset : g;
    },
    returns: "date", arity: [3, 3],
    signature: "date, lat, lon — UTC; blank in polar night/day",
  },
  {
    name: "DAYLENGTH",
    impl: (when, lat, lon) => {
      const g = geo(when, lat, lon);
      return isGeo(g) ? sunTimes(g.w, g.la, g.lo).dayLength : g;
    },
    returns: "number", arity: [3, 3],
    signature: "date, lat, lon — hours",
  },
  {
    name: "MOONPHASE",
    impl: (when, part) => {
      if (when == null) return null;
      const w = Number(when);
      if (!Number.isFinite(w)) return null;
      const p = part == null ? "phase" : String(part).toLowerCase();
      const r = moonPhase(w);
      if (p === "phase") return r.phase;
      if (p === "age") return r.age;
      if (p === "illumination") return r.illumination;
      return solError("#VALUE!", `Unknown part "${p}" — phase, age, illumination`);
    },
    returns: "number", arity: [1, 2],
    signature: "date, [part (phase)]",
  },
];
