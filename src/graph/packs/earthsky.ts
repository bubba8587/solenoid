// Earth & Sky — navigation, gravity, orbits, and the sun/moon almanac nodes.
// The custom nodes implement the NOAA solar formulation (a published standard);
// everything else is closed-form. Angles in DEGREES at every socket here
// (navigation convention — these formulas bake their own radian conversion),
// distances in metres unless a description says km.

import { SolarPositionNode, SunriseSunsetNode, MoonPhaseNode } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

const G = "6.6743*10^-11"; // CODATA gravitational constant

export const EARTH_FORMULAS: FormulaPackEntry[] = [
  { type: "es-haversine", label: "Great-Circle Distance", expr:
      "2*6371.0088*ASIN(SQRT(SIN((lat2-lat1)*PI()/360)^2+COS(lat1*PI()/180)*COS(lat2*PI()/180)*SIN((lon2-lon1)*PI()/360)^2))",
    description: "Shortest distance in km between two lat/lon points (degrees) — the haversine formula on the mean-radius sphere",
    keywords: "haversine gps distance nautical flight" },
  { type: "es-bearing", label: "Initial Bearing", expr:
      "MOD(DEGREES(ATAN2(COS(lat1*PI()/180)*SIN(lat2*PI()/180)-SIN(lat1*PI()/180)*COS(lat2*PI()/180)*COS((lon2-lon1)*PI()/180),SIN((lon2-lon1)*PI()/180)*COS(lat2*PI()/180)))+360,360)",
    description: "Compass bearing (° from north) to start a great-circle leg from point 1 to point 2 (lat/lon in degrees)",
    keywords: "azimuth heading course navigation" },
  { type: "es-gravity", label: "Gravity at Latitude", expr:
      "9.780327*(1+0.0053024*SIN(lat*PI()/180)^2-0.0000058*SIN(2*lat*PI()/180)^2)-0.000003086*h",
    description: "Local gravity (m/s²): the 1980 International Gravity Formula at latitude lat (°) with the free-air correction for altitude h (m)",
    keywords: "igf wgs84 gravitational acceleration" },
  { type: "es-horizon", label: "Distance to Horizon", expr: "SQRT(2*6371008.8*h)/1000",
    description: "How far the horizon is (km) from an eye height h metres above the surface (geometric, no refraction)",
    keywords: "visibility sea level lookout" },
];

export const ORBIT_FORMULAS: FormulaPackEntry[] = [
  { type: "es-escape-velocity", label: "Escape Velocity", expr: `SQRT(2*${G}*m/r)`,
    description: "Speed to escape a body of mass m (kg) from radius r (m)   (v = √(2GM/r); Earth surface ≈ 11.2 km/s)",
    keywords: "rocket delta v" },
  { type: "es-orbital-velocity", label: "Circular Orbital Velocity", expr: `SQRT(${G}*m/r)`,
    description: "Speed of a circular orbit of radius r (m) around mass m (kg)   (v = √(GM/r); LEO ≈ 7.8 km/s)",
    keywords: "satellite leo" },
  { type: "es-orbital-period", label: "Orbital Period (Kepler)", expr: `2*PI()*SQRT(r^3/(${G}*m))`,
    description: "Period in seconds of an orbit with semi-major axis r (m) around mass m (kg)   (T = 2π√(a³/GM))",
    keywords: "kepler third law satellite year" },
  { type: "es-schwarzschild", label: "Schwarzschild Radius", expr: `2*${G}*m/299792458^2`,
    description: "Event-horizon radius (m) of mass m (kg)   (r = 2GM/c²; the Sun's is ~3 km)",
    keywords: "black hole relativity" },
];

export const EARTHSKY_FORMULAS: FormulaPackEntry[] = [...EARTH_FORMULAS, ...ORBIT_FORMULAS];

export const EARTHSKY_PACK: Pack = {
  id: "earthsky",
  name: "Earth & Sky",
  description: "Navigation and astronomy: great-circle distance and bearing, gravity by latitude, horizon distance, orbital mechanics (Kepler, escape velocity), sun position and sunrise/sunset (NOAA), and moon phase.",
  builtin: true,
  defaultActive: false,
  nodes: [
    ...placeFormulas(["Numbers", "Earth & Sky"], EARTH_FORMULAS),
    {
      path: ["Numbers", "Earth & Sky"],
      entry: {
        type: "es-sun-position",
        label: "Sun Position",
        description: "Solar elevation, azimuth, and declination for a UTC date+time at a lat/lon — the NOAA solar calculator formulation (geometric, no refraction)",
        keywords: "solar elevation azimuth altitude noaa panel shadow",
        create: () => new SolarPositionNode(),
      },
    },
    {
      path: ["Numbers", "Earth & Sky"],
      entry: {
        type: "es-sunrise-sunset",
        label: "Sunrise / Sunset",
        description: "Sunrise and sunset times (UTC) and day length for a date at a lat/lon — NOAA formulation with standard refraction; blank in polar day/night",
        keywords: "dawn dusk daylight noaa golden hour",
        create: () => new SunriseSunsetNode(),
      },
    },
    {
      path: ["Numbers", "Earth & Sky"],
      entry: {
        type: "es-moon-phase",
        label: "Moon Phase",
        description: "Phase (0 new → 0.5 full), age in days, and illuminated fraction for a date — mean-synodic approximation, good to ~half a day",
        keywords: "lunar full new moon crescent illumination",
        create: () => new MoonPhaseNode(),
      },
    },
    ...placeFormulas(["Numbers", "Earth & Sky", "Orbits"], ORBIT_FORMULAS),
  ],
};
