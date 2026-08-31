// Thermodynamics & Air pack. SI throughout: kelvin where the physics needs an
// absolute temperature, °C only where the correlation is °C-native.

import { IsaAtmosphereNode, AntoineNode, standardAtmosphere, antoinePressure, ANTOINE, type AntoineOp } from "../rete-nodes";
import { placeFormulas, solError, isSolError, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

const R_GAS = "8.314462618";   // J/(mol·K)
const SIGMA = "5.670374419*10^-8"; // Stefan–Boltzmann

export const THERMO_GAS: FormulaPackEntry[] = [
  { type: "th-ideal-gas", label: "Ideal Gas (pV = nRT)", expr: `p * vol = n * ${R_GAS} * tk`, equation: true,
    description: "The ideal-gas law with any one of p (Pa), vol (m³), n (mol), tk (K) unwired: the node solves for it",
    keywords: "pv nrt pressure volume moles temperature gas law",
    varDescriptions: { p: "Pressure (Pa)", vol: "Volume (m³)", n: "Amount (mol)", tk: "Temperature (K)" }, },
  { type: "th-air-density", label: "Air Density", expr: "p/(287.05*tk)",
    description: "Dry air density ρ = p/(R·T) with R = 287.05, from pressure p (Pa) and temperature tk in kelvin." },
];

export const THERMO_HEAT: FormulaPackEntry[] = [
  { type: "th-sensible-heat", label: "Sensible Heat", expr: "m*cp*dt",
    description: "Heat Q = mcΔT in joules to change temperature: mass m (kg), specific heat cp (J/kg·K, water 4186), rise dt in kelvin." },
  { type: "th-latent-heat", label: "Latent Heat", expr: "m*lh",
    description: "Heat Q = mL for a phase change: mass m (kg) × latent heat lh in J/kg, water melt 334k, boil 2257k." },
  { type: "th-conduction", label: "Conduction", expr: "k*a*dt/thick",
    description: "Heat flow Q̇ = kAΔT/L in watts through a slab: conductivity k (W/m·K), area a (m²), ΔT dt, thickness thick in meters.",
    keywords: "fourier" },
  { type: "th-convection", label: "Convection", expr: "hc*a*dt",
    description: "Surface heat flow Q̇ = hAΔT in watts: coefficient hc (W/m²·K), area a, ΔT dt.",
    keywords: "newton" },
  { type: "th-radiation", label: "Radiation Exchange", expr: `${SIGMA}*eps*a*(t1^4-t2^4)`,
    description: "Net radiation between a surface (emissivity eps, area a, temperature t1 K) and surroundings t2 K   (Q̇ = εσA(T₁⁴−T₂⁴))",
    keywords: "stefan boltzmann emissivity" },
  { type: "th-thermal-resistance", label: "Thermal Resistance", expr: "thick/(k*a)",
    description: "Conductive resistance R = L/kA in K/W of a slab: thickness thick (m), conductivity k, area a." },
  { type: "th-u-value", label: "U-Value", expr: "1/rval",
    description: "Overall transmittance U = 1/R in W/m²·K from a total R-value in m²·K/W.",
    keywords: "insulation" },
  { type: "th-newton-cooling", label: "Newton Cooling", expr: "ta+(t0-ta)*EXP(-kk*t)",
    description: "Temperature after time t while cooling toward ambient ta from t0, rate constant kk (1/s)   (T = Tₐ + (T₀−Tₐ)e^(−kt))",
    keywords: "coffee cooling decay" },
  { type: "th-expansion", label: "Thermal Expansion", expr: "alpha*len*dt",
    description: "Length change ΔL = αLΔT: coefficient alpha (1/K, steel 12e-6, aluminum 23e-6), length len, ΔT dt." },
];

export const THERMO_AIR: FormulaPackEntry[] = [
  { type: "th-svp", label: "Saturation Vapor Pressure", expr: "610.94*EXP(17.625*tc/(tc+243.04))",
    description: "Over water at tc °C (Magnus, Alduchov–Eskridge form) → pascals",
    keywords: "magnus psychrometric humidity" },
  { type: "th-dew-point", label: "Dew Point", expr: "243.04*(LN(rh/100)+17.625*tc/(243.04+tc))/(17.625-LN(rh/100)-17.625*tc/(243.04+tc))",
    description: "Dew point °C from air temperature tc (°C) and relative humidity rh (%), by Magnus inversion",
    keywords: "condensation humidity" },
  { type: "th-rh-from-dew", label: "Relative Humidity", expr: "100*EXP(17.625*td/(243.04+td))/EXP(17.625*tc/(243.04+tc))",
    description: "RH % from dew point td (°C) and air temperature tc in °C" },
  { type: "th-humidity-ratio", label: "Humidity Ratio", expr: "0.622*pv/(p-pv)",
    description: "Moisture content of air: vapor pressure pv over total pressure p (same units) → kg water / kg dry air   (W = 0.622·pᵥ/(p−pᵥ))",
    keywords: "mixing ratio psychrometric" },
  { type: "th-wet-bulb", label: "Wet-Bulb (Stull)", expr: "tc*ATAN(0.151977*SQRT(rh+8.313659))+ATAN(tc+rh)-ATAN(rh-1.676331)+0.00391838*rh^1.5*ATAN(0.023101*rh)-4.686035",
    description: "Wet-bulb °C from temperature tc (°C) and humidity rh (%), by Stull 2011, valid at sea-level pressure",
    keywords: "psychrometric evaporative" },
  { type: "th-heat-index", label: "Heat Index", expr: "-42.379+2.04901523*tf+10.14333127*rh-0.22475541*tf*rh-0.00683783*tf^2-0.05481717*rh^2+0.00122874*tf^2*rh+0.00085282*tf*rh^2-0.00000199*tf^2*rh^2",
    description: "Feels-like °F from temperature tf (°F ≥ 80) and humidity rh (%), by the NWS Rothfusz regression, °F-native",
    keywords: "feels like apparent temperature" },
  { type: "th-wind-chill", label: "Wind Chill", expr: "13.12+0.6215*tc-11.37*v^0.16+0.3965*tc*v^0.16",
    description: "Feels-like °C from temperature tc (≤ 10 °C) and wind v (km/h ≥ 5), the JAG/TI standard",
    keywords: "feels like apparent temperature" },
];

export const THERMO_FORMULAS: FormulaPackEntry[] = [
  ...THERMO_GAS, ...THERMO_HEAT, ...THERMO_AIR,
];

// The pack's custom-logic nodes as formula functions (formulaNaming decision 4).
const THERMO_PACK_FORMULAS: PackFormula[] = [
  {
    name: "STANDARDATMOSPHERE",
    impl: (alt, property) => {
      if (alt == null) return null;
      const z = Number(alt);
      if (!Number.isFinite(z)) return null;
      const key = property == null ? "pressure" : String(property).toLowerCase();
      const field = ({ temp: "T", temperature: "T", pressure: "p", density: "rho", sound: "a" } as const)[key];
      if (!field) return solError("#VALUE!", `Unknown property "${key}" — temp, pressure, density, sound`);
      const pt = standardAtmosphere(z);
      return isSolError(pt) ? pt : pt[field];
    },
    returns: "number", arity: [1, 2],
    signature: "altitude m, [property (pressure)]",
  },
  {
    name: "ANTOINE",
    impl: (substance, t) => {
      if (substance == null || t == null) return null;
      const id = String(substance) as AntoineOp;
      const meta = ANTOINE[id];
      if (!meta) return solError("#NAME?", `Unknown substance "${id}" — water, ethanol, acetone…`);
      const tc = Number(t);
      if (!Number.isFinite(tc)) return null;
      return tc <= -meta.C
        ? solError("#DOMAIN!", "Below the equation's temperature range")
        : antoinePressure(id, tc);
    },
    returns: "number", arity: [2, 2],
    signature: "substance, T °C — vapor pressure in Pa",
  },
];

export const THERMO_PACK: Pack = {
  formulas: THERMO_PACK_FORMULAS,
  id: "thermo",
  group: "Science & Engineering",
  name: "Thermodynamics & Air",
  description: "Ideal gas, heat transfer (conduction/convection/radiation, R or U values), and humid-air psychrometrics (dew point, wet bulb, heat index, wind chill), plus the 1976 standard atmosphere and Antoine vapor-pressure nodes.",
  builtin: true,
  defaultActive: false,
  nodes: [
    ...placeFormulas(["Packs", "Thermo & Heat"], THERMO_GAS),
    {
      path: ["Packs", "Thermo & Heat"],
      entry: {
        type: "th-isa",
        label: "Standard Atmosphere",
        description: "1976 ISA: geometric altitude (m) → temperature, pressure, density, and speed of sound, through all seven layers to 86 km",
        keywords: "isa ussa altitude aviation pressure altitude",
        create: () => new IsaAtmosphereNode(),
      },
    },
    ...placeFormulas(["Packs", "Thermo & Heat", "Heat Transfer"], THERMO_HEAT),
    ...placeFormulas(["Packs", "Thermo & Heat", "Humid Air"], THERMO_AIR),
    {
      path: ["Packs", "Thermo & Heat", "Humid Air"],
      entry: {
        type: "th-antoine",
        label: "Vapor Pressure",
        fx: ["ANTOINE"],
        description: "Antoine-equation vapor pressure for a chosen solvent (water, alcohols, acetone, benzene…) at T °C, plus its normal boiling point",
        keywords: "antoine volatility solvent evaporation boiling",
        create: () => new AntoineNode(),
      },
    },
  ],
  units: [
    { id: "J", label: " J", group: "energy", groupLabel: "Energy" },
    { id: "kJ", label: " kJ", group: "energy" },
    { id: "Wh", label: " Wh", group: "energy" },
    { id: "kWh", label: " kWh", group: "energy" },
    { id: "cal", label: " cal", group: "energy" },
    { id: "BTU", label: " BTU", group: "energy" },
  ],
};
