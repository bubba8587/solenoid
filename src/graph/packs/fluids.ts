// Fluid mechanics: pipe flow, pumps, and the aero/particle classics.
// SI units throughout; g = 9.80665 m/s² baked where gravity appears.

import { ColebrookNode, PipeRoughnessNode, colebrookFriction, PIPE_ROUGHNESS } from "../rete-nodes";
import { placeFormulas, solError, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

const G0 = "9.80665";

export const FLUIDS_BASE: FormulaPackEntry[] = [
  { type: "fl-reynolds", label: "Reynolds Number", expr: "rho*v*d/mu",
    description: "Flow regime indicator: density rho (kg/m³), velocity v (m/s), diameter d (m), dynamic viscosity mu (Pa·s). Laminar below ~2300, turbulent above ~4000.",
    keywords: "laminar turbulent" },
  { type: "fl-kinematic-visc", label: "Kinematic Viscosity", expr: "mu/rho",
    description: "Kinematic from dynamic viscosity: mu (Pa·s) ÷ density rho   (ν = µ/ρ, m²/s)" },
  { type: "fl-hydrostatic", label: "Hydrostatic Pressure", expr: `rho*${G0}*h`,
    description: "Gauge pressure at depth h (m) in a fluid of density rho   (p = ρgh, Pa)",
    keywords: "depth head" },
  { type: "fl-flow-rate", label: "Flow Rate (Q = v·A)", expr: "v*a",
    description: "Volumetric flow from velocity v (m/s) and cross-section a (m²)   (m³/s)" },
  { type: "fl-velocity", label: "Velocity from Flow", expr: "q/a",
    description: "Mean velocity from volumetric flow q (m³/s) and cross-section a (m²)" },
  { type: "fl-mass-flow", label: "Mass Flow", expr: "rho*q",
    description: "Mass flow from density rho and volumetric flow q   (ṁ = ρQ, kg/s)" },
  { type: "fl-continuity", label: "Continuity (v₂)", expr: "v1*a1/a2",
    description: "Velocity after a section change: v1 through a1 entering a2   (A₁v₁ = A₂v₂)",
    keywords: "nozzle venturi" },
  { type: "fl-bernoulli", label: "Bernoulli (p₂)", expr: `p1+rho/2*(v1^2-v2^2)+rho*${G0}*(z1-z2)`,
    description: "Downstream pressure along a streamline (no losses): pressures Pa, velocities m/s, elevations z m   (p₂ = p₁ + ½ρ(v₁²−v₂²) + ρg(z₁−z₂))" },
];

export const FLUIDS_PIPE: FormulaPackEntry[] = [
  { type: "fl-laminar-f", label: "Friction Factor (Laminar)", expr: "64/re",
    description: "Darcy friction factor for laminar pipe flow (Re < 2300)   (f = 64/Re)" },
  { type: "fl-swamee-jain", label: "Friction Factor (Swamee–Jain)", expr: "0.25/(LOG10(rr/3.7+5.74/re^0.9))^2",
    description: "Explicit turbulent friction factor (±1% of Colebrook): Reynolds re, relative roughness rr = ε/D",
    keywords: "moody turbulent" },
  { type: "fl-darcy", label: "Pressure Drop (Darcy–Weisbach)", expr: "f*(len/d)*rho*v^2/2",
    description: "Pipe pressure loss: friction factor f, length len, diameter d, density rho, velocity v   (Δp = f·(L/D)·ρv²/2, Pa)",
    keywords: "head loss pipe" },
  { type: "fl-hazen-williams", label: "Head Loss (Hazen–Williams)", expr: "10.67*len*q^1.852/(c^1.852*d^4.87)",
    description: "Water head loss (m, SI form): length len (m), flow q (m³/s), roughness coefficient c (~150 PVC, 120 steel, 100 cast iron), diameter d (m)" },
  { type: "fl-poiseuille", label: "Poiseuille Flow", expr: "PI()*dp*r^4/(8*mu*len)",
    description: "Laminar flow through a tube from pressure drop dp: radius r, viscosity mu, length len   (Q = πΔp·r⁴/(8µL), m³/s)",
    keywords: "capillary laminar tube" },
];

export const FLUIDS_PUMPS: FormulaPackEntry[] = [
  { type: "fl-orifice", label: "Orifice Flow", expr: "cd*a*SQRT(2*dp/rho)",
    description: "Flow through an orifice: discharge coefficient cd (~0.6 sharp-edged), area a (m²), pressure drop dp (Pa)   (Q = C_d·A·√(2Δp/ρ))" },
  { type: "fl-pump-hydraulic", label: "Pump Hydraulic Power", expr: `rho*${G0}*q*head`,
    description: "Power delivered to the fluid: flow q (m³/s), head (m)   (P = ρgQH, watts)" },
  { type: "fl-pump-shaft", label: "Pump Shaft Power", expr: `rho*${G0}*q*head/eta`,
    description: "Required shaft power: hydraulic power ÷ pump efficiency eta (0–1)" },
];

export const FLUIDS_AERO: FormulaPackEntry[] = [
  { type: "fl-drag", label: "Drag Force", expr: "rho*v^2*cd*a/2",
    description: "Aerodynamic drag: density rho, speed v, drag coefficient cd, frontal area a   (F = ½ρv²C_dA, newtons)" },
  { type: "fl-stokes", label: "Stokes Terminal Velocity", expr: `d^2*${G0}*(rhop-rhof)/(18*mu)`,
    description: "Settling speed of a small sphere: diameter d (m), particle density rhop, fluid density rhof, viscosity mu   (valid for Re < ~1)",
    keywords: "settling sedimentation sphere" },
  { type: "fl-speed-sound", label: "Speed of Sound (Gas)", expr: "SQRT(gamma*rspec*tk)",
    description: "In an ideal gas: heat-capacity ratio gamma (air 1.4), specific gas constant rspec (air 287 J/kg·K), temperature tk (K)   (a = √(γRT))" },
  { type: "fl-mach", label: "Mach Number", expr: "v/SQRT(gamma*rspec*tk)",
    description: "Speed v relative to the local speed of sound √(γ·rspec·tk)" },
];

export const FLUIDS_FORMULAS: FormulaPackEntry[] = [
  ...FLUIDS_BASE, ...FLUIDS_PIPE, ...FLUIDS_PUMPS, ...FLUIDS_AERO,
];

// The pack's custom-logic nodes as formula functions (D19 decision 4).
const FLUIDS_PACK_FORMULAS: PackFormula[] = [
  {
    name: "COLEBROOK",
    impl: (re, rr) => {
      if (re == null || rr == null) return null;
      const r = Number(re), e = Number(rr);
      if (!Number.isFinite(r) || !Number.isFinite(e)) return null;
      return colebrookFriction(r, e);
    },
    returns: "number", arity: [2, 2],
    signature: "Re, relative roughness ε/D",
  },
  {
    name: "PIPEROUGHNESS",
    impl: (material) => {
      if (material == null) return null;
      const id = String(material);
      const row = PIPE_ROUGHNESS.find((m) => m.id === id);
      return row ? row.mm : solError("#NAME?", `Unknown material "${id}" — pvc, copper, steel, castiron…`);
    },
    returns: "number", arity: [1, 1],
    signature: "material — pvc, copper, steel, castiron…",
  },
];

export const FLUIDS_PACK: Pack = {
  formulas: FLUIDS_PACK_FORMULAS,
  id: "fluids",
  name: "Fluid Mechanics",
  description: "Pipe flow, pumps, and aero classics: Reynolds number, the pipe-roughness table, Colebrook or Swamee–Jain friction factors, Darcy–Weisbach and Hazen–Williams losses, Bernoulli, orifice and pump power, Stokes settling, drag, speed of sound. SI units.",
  builtin: true,
  defaultActive: false,
  nodes: [
    ...placeFormulas(["Packs", "Fluids"], FLUIDS_BASE),
    ...placeFormulas(["Packs", "Fluids", "Pipe Flow"], FLUIDS_PIPE),
    {
      path: ["Packs", "Fluid Mechanics"],
      entry: {
        type: "fl-roughness",
        label: "Pipe Roughness",
        description: "Absolute roughness ε for common pipe materials (textbook values, mm); give a diameter and it also emits ε/D, ready for the Friction Factor nodes",
        keywords: "roughness epsilon material pipe moody colebrook relative",
        create: () => new PipeRoughnessNode(),
      },
    },
    {
      path: ["Packs", "Fluids", "Pipe Flow"],
      entry: {
        type: "fl-colebrook",
        label: "Friction Factor (Colebrook)",
        fx: ["COLEBROOK"],
        description: "Solves the implicit Colebrook–White equation for the Darcy friction factor from Reynolds number and relative roughness ε/D; laminar Re hands off to 64/Re",
        keywords: "moody implicit turbulent root",
        create: () => new ColebrookNode(),
      },
    },
    ...placeFormulas(["Packs", "Fluids", "Pumps & Orifices"], FLUIDS_PUMPS),
    ...placeFormulas(["Packs", "Fluids", "Aero & Particles"], FLUIDS_AERO),
  ],
  units: [
    { id: "Pa", label: " Pa", group: "pressure", groupLabel: "Pressure" },
    { id: "kPa", label: " kPa", group: "pressure" },
    { id: "bar", label: " bar", group: "pressure" },
    { id: "psi", label: " psi", group: "pressure" },
    { id: "m3s", label: " m³/s", group: "flow", groupLabel: "Flow" },
    { id: "Ls", label: " L/s", group: "flow" },
    { id: "Lmin", label: " L/min", group: "flow" },
    { id: "gpm", label: " gpm", group: "flow" },
    { id: "Pas", label: " Pa·s", group: "viscosity", groupLabel: "Viscosity" },
    { id: "cP", label: " cP", group: "viscosity" },
  ],
};
