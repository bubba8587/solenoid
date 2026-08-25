// Constants are baked into each formula at CODATA 2018 precision. SI units throughout;
// angles in radians (core Trigonometry convention).

import { PhysicsConstantNode, EmSpectrumNode, emSpectrum, PHYS_CONSTANTS, type PhysConstOp } from "../rete-nodes";
import { placeFormulas, solError, isSolError, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

// Written as decimal·10^n so the formula grammar stays simple.
const KE   = "8.9875517923*10^9";    // Coulomb constant (N·m²/C²)
const EPS0 = "8.8541878128*10^-12";  // vacuum permittivity (F/m)
const MU0  = "1.25663706212*10^-6";  // vacuum permeability (H/m)
const C    = "299792458";            // speed of light (m/s)
const H    = "6.62607015*10^-34";    // Planck constant (J·s)
const QE   = "1.602176634*10^-19";   // elementary charge (C)

export const EM_ELECTROSTATICS: FormulaPackEntry[] = [
  { type: "em-coulomb-force", label: "Coulomb Force", expr: `${KE}*q1*q2/r^2`,
    description: "Force F = kₑq₁q₂/r² between two point charges q1, q2 (C) at distance r in meters.",
    keywords: "electrostatic charge" },
  { type: "em-e-field", label: "Electric Field (Point Charge)", expr: `${KE}*q/r^2`,
    description: "Field magnitude E = kₑq/r² in V/m at distance r from a point charge q." },
  { type: "em-e-potential", label: "Electric Potential (Point Charge)", expr: `${KE}*q/r`,
    description: "Potential V = kₑq/r at distance r from a point charge q." },
  { type: "em-plate-capacitance", label: "Parallel-Plate Capacitance", expr: `${EPS0}*er*a/d`,
    description: "Capacitance C = ε₀εᵣA/d of parallel plates: relative permittivity er, plate area a (m²), gap d in meters.",
    keywords: "dielectric" },
  // `ef`, not `e` — the formula grammar reserves e for Euler's constant.
  { type: "em-e-energy-density", label: "Electric Energy Density", expr: `${EPS0}*ef^2/2`,
    description: "Energy density u = ½ε₀E² in J/m³ in an electric field ef in V/m." },
];

export const EM_MAGNETISM: FormulaPackEntry[] = [
  { type: "em-solenoid-inductance", label: "Solenoid Inductance", expr: `${MU0}*n^2*a/len`,
    description: "Inductance L = µ₀N²A/ℓ of an air-core solenoid: n total turns, cross-section a (m²), length len in meters.",
    keywords: "coil henries" },
  { type: "em-solenoid-field", label: "Solenoid Field", expr: `${MU0}*n*i`,
    description: "Field B = µ₀nI in tesla inside a long solenoid: n turns per meter, current i.",
    keywords: "coil tesla" },
  { type: "em-wire-field", label: "Straight-Wire Field", expr: `${MU0}*i/(2*PI()*r)`,
    description: "Field at distance r from a long straight wire carrying i   (B = µ₀I/(2πr))",
    keywords: "ampere tesla" },
  { type: "em-loop-field", label: "Loop-Center Field", expr: `${MU0}*i/(2*r)`,
    description: "Field at the center of a circular loop of radius r carrying i   (B = µ₀I/(2r))" },
  { type: "em-wire-force", label: "Force on a Wire", expr: "b*i*len*SIN(theta)",
    description: "Force F = BIℓ·sinθ on a wire of length len carrying i in field b, at angle theta in radians." },
  { type: "em-lorentz", label: "Lorentz Force (Magnetic)", expr: "q*v*b*SIN(theta)",
    description: "Force F = qvB·sinθ on a charge q moving at v through field b, at angle theta in radians." },
  { type: "em-cyclotron", label: "Cyclotron Frequency", expr: "q*b/(2*PI()*m)",
    description: "Orbit frequency of a charge q, mass m in field b   (f = qB/(2πm))" },
  { type: "em-b-energy-density", label: "Magnetic Energy Density", expr: `b^2/(2*${MU0})`,
    description: "Energy density u = B²/2µ₀ in J/m³ in a magnetic field b in tesla." },
  { type: "em-hall", label: "Hall Voltage", expr: `i*b/(n*${QE}*t)`,
    description: "Hall voltage across a conductor: current i, field b, carrier density n (1/m³), thickness t (m)   (V = IB/(nqt))" },
];

export const EM_WAVES: FormulaPackEntry[] = [
  { type: "em-wavelength-frequency", label: "Wavelength ↔ Frequency", expr: `lambda = ${C} / f`, equation: true,
    description: "Free-space λ = c/f, either way around: wire f to get the wavelength, or lambda to get the frequency",
    keywords: "radio antenna wavelength frequency band",
    varDescriptions: { lambda: "Wavelength (m)", f: "Frequency (Hz)" }, },
  { type: "em-photon-energy", label: "Photon Energy (Frequency)", expr: `${H}*f`,
    description: "Energy E = hf in joules of one photon at frequency f." },
  { type: "em-photon-energy-wl", label: "Photon Energy (Wavelength)", expr: `${H}*${C}/lambda`,
    description: "Energy E = hc/λ in joules of one photon from wavelength lambda in meters." },
  { type: "em-skin-depth", label: "Skin Depth", expr: `SQRT(rho/(PI()*f*${MU0}*mur))`,
    description: "AC skin depth: resistivity rho (Ω·m), frequency f, relative permeability mur   (δ = √(ρ/πfµ), meters)",
    keywords: "eddy high frequency conductor" },
];

export const EM_INDUCTION: FormulaPackEntry[] = [
  { type: "em-faraday-emf", label: "Induced EMF (Faraday)", expr: "-n*dphi/dt",
    description: "EMF ε = −N·ΔΦ/Δt induced in n turns by flux change dphi (Wb) over dt in seconds.",
    keywords: "induction flux" },
  { type: "em-transformer", label: "Transformer Voltage", expr: "vp*ns/np",
    description: "Ideal transformer secondary voltage Vs = Vp·Ns/Np: primary vp, turns np → ns.",
    keywords: "turns ratio" },
];

export const EM_FORMULAS: FormulaPackEntry[] = [
  ...EM_ELECTROSTATICS, ...EM_MAGNETISM, ...EM_WAVES, ...EM_INDUCTION,
];

const ELECTROMAGNETISM_PACK_FORMULAS: PackFormula[] = [
  {
    name: "EMSPECTRUMBAND",
    impl: (freq, wavelength) => {
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const r = emSpectrum(num(freq), num(wavelength));
      if (r === null) return null;
      return isSolError(r) ? r : r.band;
    },
    returns: "string", arity: [1, 2],
    signature: "frequency Hz — or blank, wavelength m",
  },
  {
    name: "PHYSICSCONSTANT",
    impl: (id) => {
      if (id == null) return null;
      const k = String(id);
      const m = PHYS_CONSTANTS[k as PhysConstOp];
      return m ? m.value : solError("#NAME?", `Unknown constant "${k}" — c, G, h, e, kb, na… (case matters)`);
    },
    returns: "number", arity: [1, 1],
    signature: "id — c, G, h, e, kb, na…",
  },
];

export const ELECTROMAGNETISM_PACK: Pack = {
  formulas: ELECTROMAGNETISM_PACK_FORMULAS,
  id: "electromagnetism",
  name: "Electromagnetism",
  description: "Fields, forces, waves, and induction: Coulomb's law, capacitance and inductance from geometry, magnetic fields, Lorentz force, photons, skin depth, Faraday's law, the EM spectrum band namer, and the CODATA physical-constants node. Builds on Electricity & Circuits.",
  builtin: true,
  defaultActive: false,
  dependsOn: ["electricity"],
  nodes: [
    {
      path: ["Packs", "Electromagnetism"],
      entry: {
        type: "em-spectrum-band",
        label: "EM Spectrum Band",
        description: "Name the band for a frequency or wavelength: Radio, Microwave, Infrared, Visible (with its color), Ultraviolet, X-ray, Gamma. Also emits both quantities through c",
        keywords: "spectrum band radio microwave infrared visible ultraviolet xray gamma light classify",
        create: () => new EmSpectrumNode(),
      },
    },
    {
      path: ["Packs", "Electromagnetism"],
      entry: {
        type: "em-constant",
        label: "Physics Constant",
        description: "CODATA 2018 physical constants: c, e, ε₀, µ₀, h, k_B, Nₐ, G… grouped by domain, SI units",
        keywords: "codata speed of light planck boltzmann avogadro permittivity permeability",
        create: () => new PhysicsConstantNode(),
      },
    },
    ...placeFormulas(["Packs", "Electromagnetism"], EM_ELECTROSTATICS),
    ...placeFormulas(["Packs", "Electromagnetism", "Magnetism"], EM_MAGNETISM),
    ...placeFormulas(["Packs", "Electromagnetism", "Waves & Photons"], EM_WAVES),
    ...placeFormulas(["Packs", "Electromagnetism", "Induction"], EM_INDUCTION),
  ],
  units: [
    { id: "T", label: " T", group: "electrical" },
    { id: "mT", label: " mT", group: "electrical" },
    { id: "Wb", label: " Wb", group: "electrical" },
    { id: "eV", label: " eV", group: "electrical" },
  ],
};
