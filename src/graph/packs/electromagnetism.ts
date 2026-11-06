// [[B15]] leanCore, [[C79]] packActivationIsPresentation, [[C76]] formulaPackDefault, [[C51]] formulaNaming, [[C17]] shareImpl
// SI units; angles in radians. A physical constant is a variable the card's Physics Constant feeds.

import { EmSpectrumNode } from "../nodeClasses";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";
import { ELECTROMAGNETISM_PACK_FORMULAS } from "./electromagnetismFormulas";

const EM_ELECTROSTATICS: FormulaPackEntry[] = [
  { type: "em-coulomb-force", label: "Coulomb Force", expr: "ke*q1*q2/r^2", constants: { ke: "ke" },
    description: "Force F = kₑq₁q₂/r² between two point charges q1, q2 (C) at distance r in meters.",
    keywords: "electrostatic charge",
    varDescriptions: { q1: "First charge (C)", q2: "Second charge (C)", r: "Distance (m)" }, units: { r: "m" } },
  { type: "em-e-field", label: "Electric Field (Point Charge)", expr: "ke*q/r^2", constants: { ke: "ke" },
    description: "Field magnitude E = kₑq/r² in V/m at distance r from a point charge q.",
    varDescriptions: { q: "Point charge (C)", r: "Distance (m)" }, units: { r: "m" } },
  { type: "em-e-potential", label: "Electric Potential (Point Charge)", expr: "ke*q/r", constants: { ke: "ke" },
    description: "Potential V = kₑq/r at distance r from a point charge q.",
    varDescriptions: { q: "Point charge (C)", r: "Distance (m)" }, units: { r: "m" } },
  { type: "em-plate-capacitance", label: "Parallel-Plate Capacitance", expr: "eps0*er*a/d", constants: { eps0: "eps0" },
    description: "Capacitance C = ε₀εᵣA/d of parallel plates: relative permittivity er, plate area a (m²), gap d in meters.",
    keywords: "dielectric",
    varDescriptions: { er: "Relative permittivity εᵣ", a: "Plate area (m²)", d: "Plate gap (m)" }, units: { a: "m2", d: "m" } },
  // `ef`, not `e` — the formula grammar reserves e for Euler's constant.
  { type: "em-e-energy-density", label: "Electric Energy Density", expr: "eps0*ef^2/2", constants: { eps0: "eps0" },
    description: "Energy density u = ½ε₀E² in J/m³ in an electric field ef in V/m.",
    varDescriptions: { ef: "Electric field (V/m)" } },
];

const EM_MAGNETISM: FormulaPackEntry[] = [
  { type: "em-solenoid-inductance", label: "Solenoid Inductance", expr: "mu0*n^2*a/len", constants: { mu0: "mu0" },
    description: "Inductance L = µ₀N²A/ℓ of an air-core solenoid: n total turns, cross-section a (m²), length len in meters.",
    keywords: "coil henries",
    varDescriptions: { n: "Total turns", a: "Cross-section area (m²)", len: "Solenoid length (m)" }, units: { a: "m2", len: "m" } },
  { type: "em-solenoid-field", label: "Solenoid Field", expr: "mu0*n*i", constants: { mu0: "mu0" },
    description: "Field B = µ₀nI in tesla inside a long solenoid: n turns per meter, current i.",
    keywords: "coil tesla",
    varDescriptions: { n: "Turns per meter", i: "Current (A)" }, units: { i: "A" } },
  { type: "em-wire-field", label: "Straight-Wire Field", expr: "mu0*i/(2*PI()*r)", constants: { mu0: "mu0" },
    description: "Field at distance r from a long straight wire carrying i   (B = µ₀I/(2πr))",
    keywords: "ampere tesla",
    varDescriptions: { i: "Current (A)", r: "Distance from the wire (m)" }, units: { i: "A", r: "m" } },
  { type: "em-loop-field", label: "Loop-Center Field", expr: "mu0*i/(2*r)", constants: { mu0: "mu0" },
    description: "Field at the center of a circular loop of radius r carrying i   (B = µ₀I/(2r))",
    varDescriptions: { i: "Current (A)", r: "Loop radius (m)" }, units: { i: "A", r: "m" } },
  { type: "em-wire-force", label: "Force on a Wire", expr: "b*i*len*SIN(theta)",
    description: "Force F = BIℓ·sinθ on a wire of length len carrying i in field b, at angle theta in radians.",
    varDescriptions: { b: "Magnetic field (T)", i: "Current (A)", len: "Wire length (m)", theta: "Angle (rad)" }, units: { i: "A", len: "m" } },
  { type: "em-lorentz", label: "Lorentz Force (Magnetic)", expr: "q*v*b*SIN(theta)",
    description: "Force F = qvB·sinθ on a charge q moving at v through field b, at angle theta in radians.",
    varDescriptions: { q: "Charge (C)", v: "Speed (m/s)", b: "Magnetic field (T)", theta: "Angle (rad)" }, units: { v: "m/s" } },
  { type: "em-cyclotron", label: "Cyclotron Frequency", expr: "q*b/(2*PI()*m)",
    description: "Orbit frequency of a charge q, mass m in field b   (f = qB/(2πm))",
    varDescriptions: { q: "Charge (C)", b: "Magnetic field (T)", m: "Particle mass (kg)" }, units: { m: "kg" } },
  { type: "em-b-energy-density", label: "Magnetic Energy Density", expr: "b^2/(2*mu0)", constants: { mu0: "mu0" },
    description: "Energy density u = B²/2µ₀ in J/m³ in a magnetic field b in tesla.",
    varDescriptions: { b: "Magnetic field (T)" } },
  { type: "em-hall", label: "Hall Voltage", expr: "i*b/(n*qe*t)", constants: { qe: "e" },
    description: "Hall voltage across a conductor: current i, field b, carrier density n (1/m³), thickness t (m)   (V = IB/(nqt))",
    varDescriptions: { i: "Current (A)", b: "Magnetic field (T)", n: "Carrier density (1/m³)", t: "Conductor thickness (m)" }, units: { i: "A", t: "m" } },
];

const EM_WAVES: FormulaPackEntry[] = [
  { type: "em-wavelength-frequency", label: "Wavelength ↔ Frequency", expr: "lambda = c / f", constants: { c: "c" }, equation: true,
    description: "Free-space λ = c/f, either way around: wire f to get the wavelength, or lambda to get the frequency",
    keywords: "radio antenna wavelength frequency band",
    varDescriptions: { lambda: "Wavelength (m)", f: "Frequency (Hz)" }, units: { lambda: "m", f: "Hz" } },
  { type: "em-photon-energy", label: "Photon Energy (Frequency)", expr: "h*f", constants: { h: "h" },
    description: "Energy E = hf in joules of one photon at frequency f.",
    varDescriptions: { f: "Frequency (Hz)" }, units: { f: "Hz" } },
  { type: "em-photon-energy-wl", label: "Photon Energy (Wavelength)", expr: "h*c/lambda", constants: { c: "c", h: "h" },
    description: "Energy E = hc/λ in joules of one photon from wavelength lambda in meters.",
    varDescriptions: { lambda: "Wavelength (m)" }, units: { lambda: "m" } },
  { type: "em-skin-depth", label: "Skin Depth", expr: "SQRT(rho/(PI()*f*mu0*mur))", constants: { mu0: "mu0" },
    description: "AC skin depth: resistivity rho (Ω·m), frequency f, relative permeability mur   (δ = √(ρ/πfµ), meters)",
    keywords: "eddy high frequency conductor",
    varDescriptions: { rho: "Resistivity (Ω·m)", f: "Frequency (Hz)", mur: "Relative permeability µᵣ" }, units: { f: "Hz" } },
];

const EM_INDUCTION: FormulaPackEntry[] = [
  { type: "em-faraday-emf", label: "Induced EMF (Faraday)", expr: "-n*dphi/dt",
    description: "EMF ε = −N·ΔΦ/Δt induced in n turns by flux change dphi (Wb) over dt in seconds.",
    keywords: "induction flux",
    varDescriptions: { n: "Number of turns", dphi: "Flux change (Wb)", dt: "Time interval (s)" }, units: { dt: "s" } },
  { type: "em-transformer", label: "Transformer Voltage", expr: "vp*ns/np",
    description: "Ideal transformer secondary voltage Vs = Vp·Ns/Np: primary vp, turns np → ns.",
    keywords: "turns ratio",
    varDescriptions: { vp: "Primary voltage (V)", ns: "Secondary turns", np: "Primary turns" }, units: { vp: "W/A" } },
];

export const EM_FORMULAS: FormulaPackEntry[] = [
  ...EM_ELECTROSTATICS, ...EM_MAGNETISM, ...EM_WAVES, ...EM_INDUCTION,
];

export const ELECTROMAGNETISM_PACK: Pack = {
  formulas: ELECTROMAGNETISM_PACK_FORMULAS,
  id: "electromagnetism",
  seed: "pack-electromagnetism",
  tags: ["physics-constant"],
  group: "Science & Engineering",
  name: "Electromagnetism",
  description: "Coulomb, Lorentz, Faraday, capacitance and inductance from geometry, skin depth, spectrum bands, CODATA constants. Builds on Electricity & Circuits.",
  builtin: true,
  defaultActive: false,
  dependsOn: ["electricity"],
  nodes: [
    {
      path: ["Packs", "Electromagnetism"],
      entry: {
        type: "em-spectrum-band",
        label: "EM Spectrum Band",
        description: "Names the band, Radio through Gamma, for a frequency or wavelength, with the color when Visible, and gives both quantities through c.",
        keywords: "spectrum band radio microwave infrared visible ultraviolet xray gamma light classify",
        create: () => new EmSpectrumNode(),
      },
    },
    ...placeFormulas(["Packs", "Electromagnetism"], EM_ELECTROSTATICS),
    ...placeFormulas(["Packs", "Electromagnetism", "Magnetism"], EM_MAGNETISM),
    ...placeFormulas(["Packs", "Electromagnetism", "Waves & Photons"], EM_WAVES),
    ...placeFormulas(["Packs", "Electromagnetism"], EM_INDUCTION),
  ],
  units: [
    { id: "T", label: " T", group: "electrical" },
    { id: "mT", label: " mT", group: "electrical" },
    { id: "Wb", label: " Wb", group: "electrical" },
    { id: "eV", label: " eV", group: "electrical" },
  ],
};
