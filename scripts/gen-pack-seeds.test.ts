// [[C79]] packActivationIsPresentation, [[C1]] demoVault
// Writes every pack's example seed (src/graph/seedGraphs/packs/pack-<id>.json) from the recipes below. A card is
// made the way the Add menu makes it (its catalog entry's create(), or its class) and saved the way the app saves it
// (savedNodeBody), so a preset carries exactly what the app would write. Run:
//   GEN_PACK_SEEDS=1 npx vitest run scripts/gen-pack-seeds.test.ts
// then check them: npx vitest run tests/graph/seeds.test.ts tests/graph/packSeeds.test.ts
import { it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import * as Nodes from "../src/graph/nodeClasses";
import { FLAT_CATALOG } from "../src/graph/catalogUtils";
import { savedNodeBody } from "../src/graph/savedNodeBody";
import { CURRENT_SAVE_VERSION } from "../src/graph/persistenceCore";
import { BUILTIN_PACKS } from "../src/graph/packs";

type Spec = {
  id: string;
  at: [number, number];
  /** A catalog type (`geo-triangle-solver`, a preset's `ts-cagr`), made by its create(). */
  cat?: string;
  /** Or a class, made with `init`. */
  cls?: string;
  init?: Record<string, unknown>;
  lit?: Record<string, number>;
  str?: Record<string, string>;
  frame?: { name: string; cells: (string | number)[] }[];
};
type Recipe = { pack: string; label: string; nodes: Spec[]; cables: string[] };

const note = (id: string, at: [number, number], label: string, body: string, width = 760, height = 150): Spec =>
  ({ id, at, cls: "NoteNode", init: { label, body, width, height } });
const value = (id: string, at: [number, number], label: string, v: string | number, op = "number"): Spec =>
  ({ id, at, cls: "ValueInputNode", init: { label, op, value: String(v), width: op === "date" ? 210 : 180 } });
const list = (id: string, at: [number, number], label: string, values: string, dataType?: string): Spec =>
  ({ id, at, cls: "ListInputNode", init: { label, valueKeys: ["v0"], ...(dataType ? { dataType } : {}) }, str: { v0: values } });
const table = (id: string, at: [number, number], label: string, tableText: string): Spec =>
  ({ id, at, cls: "TableInputNode", init: { label, tableText } });
const preset = (id: string, at: [number, number], cat: string, lit?: Record<string, number>): Spec => ({ id, at, cat, lit });
const card = (id: string, at: [number, number], cls: string, init?: Record<string, unknown>, extra: Partial<Spec> = {}): Spec =>
  ({ id, at, cls, init, ...extra });

/** A formula card. */
const expr = (id: string, at: [number, number], label: string, e: string): Spec => ({ id, at, cls: "ExpressionNode", init: { label, expr: e } });
/** Frame from Lists: one named column per list, wired in as `vals0`, `vals1`, … */
const frameOf = (id: string, at: [number, number], label: string, names: string[]): Spec => ({
  id, at, cls: "FrameFromListsNode",
  init: { label, valueKeys: names.map((_, i) => `name${i}`) },
  str: Object.fromEntries(names.map((n, i) => [`name${i}`, n])),
});
/** A chart, its options as the card's own text. */
const chart = (id: string, at: [number, number], label: string, op: string, options = ""): Spec =>
  ({ id, at, cls: "ChartNode", init: { label, op }, ...(options ? { str: { options } } : {}) });

const COL = 440;
const c = (i: number) => i * COL;

const RECIPES: Recipe[] = [
  {
    pack: "geometry",
    label: "Geometry: figures that solve themselves",
    nodes: [
      note("head", [0, 0], "Geometry", "Every figure card here **solves**: give it enough parts and it works out the rest, drawn to scale. Type into a label on a figure to change it, or clear one to have it solved. Where two figures fit the parts (a chord with a radius fits a short and a long arc), the card says so instead of guessing. The Triangle Solver below reads three triangles from a table and steps through them."),
      card("tris", [c(0), 200], "FrameInputNode", { label: "Triangles" }, {
        frame: [
          { name: "a", cells: [3, 7, ""] }, { name: "b", cells: [4, 9, 8] }, { name: "c", cells: [5, "", ""] },
          { name: "A", cells: ["", "", 40] }, { name: "B", cells: ["", "", 60] }, { name: "C", cells: ["", 50, ""] },
        ],
      }),
      preset("tri", [c(1), 200], "geo-triangle-solver"),
      preset("uc", [c(2), 200], "geo-unit-circle"),
      preset("circ", [c(3), 200], "geo-circle-solver"),
      card("solid", [c(0), 900], "SolidNode", { op: "cone" }),
      preset("poly", [c(1), 900], "geo-polygon-points"),
      preset("pts", [c(2), 900], "geo-two-points"),
      preset("ngon", [c(3), 900], "geo-regular-polygon"),
    ],
    cables: ["tris.frame -> tri.triangles"],
  },
  {
    pack: "timesavers",
    label: "Timesavers: everyday formulas, ready-made",
    nodes: [
      note("head", [0, 0], "Common Excel Timesavers", "The formulas people rebuild in every spreadsheet, as cards: a percent change, a growth rate, a word count, an ordinal, a number spelled out. Each is an ordinary formula card underneath, locked so its formula can't drift; type into its fields or wire values in."),
      preset("pct", [c(0), 220], "ts-percent-change", { before: 80, after: 92 }),
      preset("cagr", [c(1), 220], "ts-cagr", { startval: 10000, endval: 26000, periods: 8 }),
      preset("ord", [c(2), 220], "ts-ordinal", { n: 23 }),
      value("txt", [c(0), 520], "A sentence", "The quick brown fox jumps over the lazy dog", "string"),
      preset("words", [c(1), 520], "ts-count-words"),
      card("spell", [c(2), 520], "SpellNumberNode", undefined, { lit: { value: 1234.5 } }),
      card("rev", [c(0), 780], "ReverseTextNode", undefined, { str: { text: "stressed" } }),
      value("url", [c(1), 780], "A link", "https://solenoid-ngc.com", "string"),
      card("qr", [c(2), 780], "QrCodeNode"),
    ],
    cables: ["txt.value -> words.t", "url.value -> qr.text"],
  },
  {
    pack: "scientific",
    label: "Scientific: roots, systems, fits and seasons",
    nodes: [
      note("head", [0, 0], "Scientific Computing", "Numerical methods as cards. **Polynomial Roots** finds where x³ − 6x² + 11x − 6 crosses zero (at 1, 2 and 3). **Solve** answers the system 2x + y = 3, x + 3y = 5. **Eigen** gives a symmetric matrix's eigenvalues. **Fit Distribution** ranks which distribution best explains a sample, and **Decompose** splits a seasonal series into trend, season and remainder."),
      list("coeffs", [c(0), 220], "Coefficients (x³ … x⁰)", "1, -6, 11, -6"),
      card("roots", [c(1), 220], "PolyRootsNode"),
      table("A", [c(0), 460], "A", "2, 1\n1, 3"),
      list("b", [c(0), 680], "b", "3, 5"),
      card("solve", [c(1), 520], "MatSolveNode"),
      table("S", [c(2), 220], "Symmetric matrix", "2, 1, 0\n1, 2, 1\n0, 1, 2"),
      card("eig", [c(3), 220], "MatEigenNode"),
      list("sample", [c(2), 520], "Sample", "5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0, 5.3, 4.7, 5.0, 5.1, 4.9, 5.0, 5.4, 4.6, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9"),
      card("fit", [c(3), 520], "FitDistributionNode"),
      list("sales", [c(0), 900], "Quarterly sales", "12, 18, 25, 14, 15, 21, 29, 17, 18, 24, 33, 20, 21, 27, 36, 23"),
      card("dec", [c(1), 900], "DecomposeNode", undefined, { lit: { period: 4 } }),
      card("hist", [c(4), 520], "HistogramNode", { label: "The sample's shape" }, { lit: { bins: 8 } }),
      chart("decChart", [c(2), 900], "Trend, season, remainder", "line", "title=Quarterly sales, decomposed;xlabel=quarter"),
    ],
    cables: ["coeffs.list -> roots.coeffs", "A.table -> solve.matrix", "b.list -> solve.b", "S.table -> eig.matrix", "sample.list -> fit.list", "sales.list -> dec.values", "sample.list -> hist.values", "dec.decomposition -> decChart.values"],
  },
  {
    pack: "signals",
    label: "Signals: a noisy wave, cleaned up",
    nodes: [
      note("head", [0, 0], "Signals & Grids", "A signal built from two sine waves, 4 and 16 cycles across 64 samples. **Spectrum** shows both frequencies as peaks; **Smooth** irons out the faster wave; **Find Peaks** marks the slow wave's crests; **Convolve** runs a small averaging kernel along the signal, the same operation as a moving average."),
      card("sig", [c(0), 220], "ExpressionNode", { label: "Signal", expr: "SIN(2*PI()*SEQUENCE(64)/16) + 0.4*SIN(2*PI()*SEQUENCE(64)/4)" }),
      card("spec", [c(1), 220], "SpectrumNode", undefined, { lit: { rate: 64 } }),
      card("smooth", [c(1), 520], "SmoothNode", { op: "savgol" }, { lit: { window: 7, order: 2 } }),
      card("peaks", [c(2), 520], "FindPeaksNode"),
      list("kernel", [c(0), 820], "Kernel", "0.25, 0.5, 0.25"),
      card("conv", [c(1), 820], "ConvolveNode"),
      expr("n", [c(2), 1000], "Sample", "SEQUENCE(64)"),
      frameOf("wave", [c(3), 1000], "Raw and smoothed", ["sample", "raw", "smoothed"]),
      chart("waveChart", [c(4), 1000], "Raw and smoothed", "line", "title=The fast wave smoothed away;xlabel=sample"),
      expr("half", [c(2), 220], "The useful half", "CHOOSECOLS(TAKE(s, 33), 1, 2)"),
      card("specFrame", [c(3), 220], "BuildFrameNode", { label: "Spectrum" }, { str: { headers: "cycles, magnitude" } }),
      chart("specChart", [c(4), 220], "Spectrum", "column", "title=Two frequencies, two peaks;xlabel=cycles per 64 samples;ylabel=magnitude"),
    ],
    cables: [
      "sig.result -> spec.list", "sig.result -> smooth.list", "smooth.result -> peaks.list", "sig.result -> conv.a", "kernel.list -> conv.b",
      "n.result -> wave.vals0", "sig.result -> wave.vals1", "smooth.result -> wave.vals2", "wave.frame -> waveChart.values",
      "spec.result -> half.s", "half.result -> specFrame.matrix", "specFrame.frame -> specChart.values",
    ],
  },
  {
    pack: "datascience",
    label: "Data science: clusters, components, a test",
    nodes: [
      note("head", [0, 0], "Data Science", "Eight points in two clumps. **K-Means** with k = 2 finds the clumps without being told which point is which; **PCA** finds the direction the points spread along most. **Mann–Whitney U** and **KS** ask whether two samples could come from the same population, without assuming either is normal."),
      list("xs", [c(0), 220], "x", "1.0, 1.4, 0.8, 1.2, 5.1, 5.6, 4.8, 5.3"),
      list("ys", [c(0), 400], "y", "2.1, 1.7, 2.4, 1.9, 6.2, 5.8, 6.5, 6.0"),
      frameOf("pts", [c(1), 220], "Points", ["x", "y"]),
      card("km", [c(2), 220], "KMeansNode", undefined, { lit: { k: 2 } }),
      card("pca", [c(2), 520], "PcaNode"),
      frameOf("clustered", [c(3), 220], "Points by cluster", ["x", "y", "cluster"]),
      chart("scatter", [c(4), 220], "Clusters", "scatter", "title=Two clumps, found;x=x;y=y;c=cluster"),
      list("a", [c(0), 860], "Group A", "12, 15, 14, 10, 13, 11"),
      list("b2", [c(0), 1080], "Group B", "18, 21, 19, 22, 17, 20"),
      card("mw", [c(1), 860], "HypothesisTestNode", { op: "mannwhitney" }),
      card("ks", [c(2), 860], "HypothesisTestNode", { op: "ks" }),
    ],
    cables: [
      "xs.list -> pts.vals0", "ys.list -> pts.vals1", "pts.frame -> km.frame", "pts.frame -> pca.frame",
      "xs.list -> clustered.vals0", "ys.list -> clustered.vals1", "km.labels -> clustered.vals2", "clustered.frame -> scatter.values",
      "a.list -> mw.a", "b2.list -> mw.b", "a.list -> ks.a", "b2.list -> ks.b",
    ],
  },
  {
    pack: "electricity",
    label: "Electricity: Ohm's law to the parts drawer",
    nodes: [
      note("head", [0, 0], "Electricity & Circuits", "**Ohm's Law** is one equation that solves for whichever of V, I and R isn't wired: here 9 V across 330 Ω gives the current, which feeds **Power**. An LED needs a series resistor; **E-Series** rounds the exact value to one you can buy. **Parallel Combine** gives three resistors' combined resistance, and the **Resistor Color Code** card reads the bands."),
      value("v", [c(0), 220], "Voltage (V)", 9),
      value("r", [c(0), 420], "Resistance (Ω)", 330),
      preset("ohm", [c(1), 220], "elec-ohms-law"),
      preset("pw", [c(2), 220], "elec-power-vi"),
      preset("led", [c(0), 680], "elec-led-resistor", { vs: 9, vf: 2, i: 0.02 }),
      card("es", [c(1), 680], "ESeriesNode", { op: "E24" }),
      list("rs", [c(2), 680], "Resistors (Ω)", "100, 220, 330"),
      card("par", [c(3), 680], "ParallelCombineNode"),
      card("bands", [c(3), 220], "ResistorCodeNode"),
      preset("tau", [c(0), 940], "elec-rc-tau", { r: 10000, c: 0.0001 }),
      expr("tt", [c(1), 940], "Time (s)", "SEQUENCE(21, 1, 0, 0.25)"),
      preset("charge", [c(2), 940], "elec-cap-charge", { v0: 9, r: 10000, c: 0.0001 }),
      frameOf("chargeFrame", [c(3), 940], "Charging curve", ["t (s)", "V"]),
      chart("chargeChart", [c(4), 940], "Capacitor charging", "line", "title=Charging: 63% after one τ = RC = 1 s;xlabel=t (s);ylabel=V"),
    ],
    cables: [
      "v.value -> ohm.v", "r.value -> ohm.r", "v.value -> pw.v", "ohm.i -> pw.i", "led.result -> es.value", "rs.list -> par.list",
      "tt.result -> charge.t", "tt.result -> chargeFrame.vals0", "charge.result -> chargeFrame.vals1", "chargeFrame.frame -> chargeChart.values",
    ],
  },
  {
    pack: "electromagnetism",
    label: "Electromagnetism: light, charge and fields",
    nodes: [
      note("head", [0, 0], "Electromagnetism", "Green light oscillates about 545 trillion times a second. From that one number: its **wavelength** (the equation solves λ = c / f), its place in the **spectrum**, and the **energy** of one photon (E = hf). Below, the force between two point charges and the field around a current-carrying wire."),
      value("f", [c(0), 220], "Frequency (Hz)", 5.45e14),
      card("cc", [c(0), 420], "PhysicsConstantNode", { op: "c" }),
      preset("wl", [c(1), 220], "em-wavelength-frequency"),
      card("band", [c(2), 220], "EmSpectrumNode"),
      preset("pe", [c(3), 220], "em-photon-energy"),
      preset("coul", [c(1), 620], "em-coulomb-force", { q1: 1e-6, q2: -2e-6, r: 0.05 }),
      preset("bw", [c(2), 620], "em-wire-field", { i: 10, r: 0.02 }),
      expr("rr", [c(0), 940], "Distance (m)", "SEQUENCE(10, 1, 0.02, 0.02)"),
      preset("coulR", [c(1), 940], "em-coulomb-force", { q1: 1e-6, q2: 1e-6 }),
      frameOf("coulFrame", [c(2), 940], "Force by distance", ["r (m)", "F (N)"]),
      chart("coulChart", [c(3), 940], "Inverse square", "line", "title=Twice as far, a quarter the force;xlabel=r (m);ylabel=F (N)"),
    ],
    cables: [
      "f.value -> wl.f", "f.value -> band.freq", "f.value -> pe.f",
      "rr.result -> coulR.r", "rr.result -> coulFrame.vals0", "coulR.result -> coulFrame.vals1", "coulFrame.frame -> coulChart.values",
    ],
  },
  {
    pack: "health",
    label: "Health: zones, BMI and daily energy",
    nodes: [
      note("head", [0, 0], "Health & Fitness", "One age drives the heart-rate cards: **Max Heart Rate** (Tanaka's 208 − 0.7 × age), the **Karvonen** target at 70% effort, and the five training **zones**. **BMR** estimates the energy a body uses at rest, and **TDEE** scales it by activity. These are population formulas: a guide, not a diagnosis."),
      value("age", [c(0), 220], "Age (years)", 35),
      card("zones", [c(1), 220], "HrZonesNode", undefined, { lit: { resting: 60 } }),
      preset("mhr", [c(1), 620], "hf-maxhr-tanaka"),
      preset("karv", [c(2), 620], "hf-karvonen", { hrrest: 60, intensity: 0.7 }),
      preset("bmi", [c(0), 900], "hf-bmi", { w: 70, h: 1.75 }),
      preset("bmr", [c(1), 900], "hf-bmr-mifflin-w", { w: 62, hcm: 168 }),
      preset("tdee", [c(2), 900], "hf-tdee", { activity: 1.55 }),
      chart("zoneChart", [c(2), 220], "Training zones", "column", "title=Heart-rate zones;ylabel=bpm"),
    ],
    cables: ["zones.zones -> zoneChart.values", "age.value -> zones.age", "age.value -> mhr.age", "mhr.result -> karv.hrmax", "age.value -> bmr.age", "bmr.result -> tdee.bmr"],
  },
  {
    pack: "fluids",
    label: "Fluids: water through a pipe",
    nodes: [
      note("head", [0, 0], "Fluid Mechanics", "Water at 2 m/s through a 50 mm pipe, worked end to end. The **Reynolds number** says the flow is turbulent; the pipe's **roughness** (it reads the diameter in mm) and **Colebrook** give the friction factor; **Darcy–Weisbach** turns that into the pressure lost over 100 m of pipe. Change the velocity and watch every step follow."),
      value("rho", [c(0), 220], "Density (kg/m³)", 998),
      value("vel", [c(0), 400], "Velocity (m/s)", 2),
      value("d", [c(0), 580], "Diameter (m)", 0.05),
      value("mu", [c(0), 760], "Viscosity (Pa·s)", 0.001),
      preset("re", [c(1), 220], "fl-reynolds"),
      card("rough", [c(1), 640], "PipeRoughnessNode", undefined, { lit: { d: 50 } }),
      card("cb", [c(2), 220], "ColebrookNode"),
      preset("dp", [c(3), 220], "fl-darcy", { len: 100 }),
      expr("vs", [c(0), 1000], "Velocities (m/s)", "SEQUENCE(8, 1, 0.5, 0.5)"),
      preset("re2", [c(1), 1000], "fl-reynolds"),
      card("cb2", [c(2), 1000], "ColebrookNode"),
      preset("dp2", [c(3), 1000], "fl-darcy", { len: 100 }),
      frameOf("sweep", [c(4), 1000], "Pressure drop by velocity", ["v (m/s)", "Δp (Pa)"]),
      chart("sweepChart", [c(5), 1000], "Faster costs more", "line", "title=Pressure drop over 100 m, about v²;xlabel=v (m/s);ylabel=Δp (Pa)"),
    ],
    cables: [
      "rho.value -> re2.rho", "vs.result -> re2.v", "d.value -> re2.d", "mu.value -> re2.mu",
      "re2.result -> cb2.re", "rough.rel -> cb2.rr",
      "cb2.result -> dp2.f", "d.value -> dp2.d", "rho.value -> dp2.rho", "vs.result -> dp2.v",
      "vs.result -> sweep.vals0", "dp2.result -> sweep.vals1", "sweep.frame -> sweepChart.values",
      "rho.value -> re.rho", "vel.value -> re.v", "d.value -> re.d", "mu.value -> re.mu",
      "re.result -> cb.re", "rough.rel -> cb.rr",
      "cb.result -> dp.f", "d.value -> dp.d", "rho.value -> dp.rho", "vel.value -> dp.v",
    ],
  },
  {
    pack: "thermo",
    label: "Thermodynamics: air, heat and humidity",
    nodes: [
      note("head", [0, 0], "Thermodynamics & Air", "The **ideal gas law** solves for whichever of p, V, n and T isn't wired: one mole at 101,325 Pa in 22.4 L comes out near 0 °C. The **Standard Atmosphere** gives the air 3 km up. **Dew point** and **heat index** read a humid afternoon, and **Newton cooling** follows a cup of coffee left on the desk."),
      value("p", [c(0), 220], "Pressure (Pa)", 101325),
      value("vol", [c(0), 400], "Volume (m³)", 0.0224),
      value("n", [c(0), 580], "Amount (mol)", 1),
      preset("gas", [c(1), 220], "th-ideal-gas"),
      card("isa", [c(2), 220], "IsaAtmosphereNode", undefined, { lit: { alt: 3000 } }),
      preset("dew", [c(1), 700], "th-dew-point", { rh: 60, tc: 25 }),
      preset("hi", [c(2), 700], "th-heat-index", { tf: 90, rh: 60 }),
      preset("cool", [c(3), 700], "th-newton-cooling", { ta: 20, t0: 90, kk: 0.05, t: 30 }),
      card("ant", [c(3), 220], "AntoineNode", undefined, { lit: { t: 80 } }),
      expr("mins", [c(0), 1000], "Minutes", "SEQUENCE(13, 1, 0, 5)"),
      preset("coolT", [c(1), 1000], "th-newton-cooling", { ta: 20, t0: 90, kk: 0.05 }),
      frameOf("coolFrame", [c(2), 1000], "Coffee by the minute", ["minutes", "°C"]),
      chart("coolChart", [c(3), 1000], "Cooling curve", "line", "title=Coffee cooling toward the room's 20 °C;xlabel=minutes;ylabel=°C"),
    ],
    cables: [
      "p.value -> gas.p", "vol.value -> gas.vol", "n.value -> gas.n",
      "mins.result -> coolT.t", "mins.result -> coolFrame.vals0", "coolT.result -> coolFrame.vals1", "coolFrame.frame -> coolChart.values",
    ],
  },
  {
    pack: "sets",
    label: "Sets: two lists compared",
    nodes: [
      note("head", [0, 0], "Sets & Comparisons", "Two shopping lists. **Sets** gives what's on either list (union) and what's on both (intersection); **Is In** marks each item of the first list that the second has. **Tally** counts how often each word appears, and **Between** tests which values fall in a range, ends included."),
      list("la", [c(0), 220], "List A", "apple, banana, cherry, date", "string"),
      list("lb", [c(0), 420], "List B", "banana, date, fig", "string"),
      card("union", [c(1), 220], "SetsNode", { op: "union" }),
      card("inter", [c(2), 220], "SetsNode", { op: "intersect" }),
      card("isin", [c(3), 220], "IsInNode"),
      list("words", [c(0), 680], "Votes", "red, blue, red, green, blue, red", "string"),
      card("tally", [c(1), 680], "TallyNode"),
      list("vals", [c(2), 680], "Values", "3, 7, 12, 18"),
      card("btw", [c(3), 680], "BetweenNode", undefined, { str: { lo: "5", hi: "15" } }),
      chart("tallyChart", [c(1), 980], "Votes counted", "column", "title=Red wins"),
    ],
    cables: ["tally.frame -> tallyChart.values", "la.list -> union.a", "lb.list -> union.b", "la.list -> inter.a", "lb.list -> inter.b", "la.list -> isin.a", "lb.list -> isin.b", "words.list -> tally.list", "vals.list -> btw.value"],
  },
  {
    pack: "earthsky",
    label: "Earth & Sky: distance, sun and moon",
    nodes: [
      note("head", [0, 0], "Earth & Sky", "London to New York along the Earth's surface (the **great-circle** distance) and the compass bearing to set out on. For midsummer's day in London: where the **sun** stands, when it **rises and sets**, and the **moon's** phase."),
      preset("gc", [c(0), 200], "es-haversine", { lat1: 51.5074, lon1: -0.1278, lat2: 40.7128, lon2: -74.006 }),
      preset("brg", [c(1), 200], "es-bearing", { lat1: 51.5074, lon1: -0.1278, lat2: 40.7128, lon2: -74.006 }),
      preset("hz", [c(2), 200], "es-horizon", { h: 1.7 }),
      value("day", [c(0), 640], "Date", "21-Jun-2026", "date"),
      card("sun", [c(1), 640], "SolarPositionNode", undefined, { lit: { lat: 51.5, lon: -0.13 } }),
      card("rise", [c(2), 640], "SunriseSunsetNode", undefined, { lit: { lat: 51.5, lon: -0.13 } }),
      card("moon", [c(3), 640], "MoonPhaseNode"),
      expr("hours", [c(0), 1000], "Hours", "SEQUENCE(25, 1, 0, 1)"),
      expr("times", [c(1), 1000], "Through the day", "day + hours/24"),
      card("sunDay", [c(2), 1000], "SolarPositionNode", undefined, { lit: { lat: 51.5, lon: -0.13 } }),
      frameOf("sunFrame", [c(3), 1000], "Sun by the hour", ["hour (UTC)", "elevation (°)"]),
      chart("sunChart", [c(4), 1000], "The sun's arc", "line", "title=Midsummer in London: the sun's height;xlabel=hour (UTC);ylabel=degrees above the horizon"),
    ],
    cables: [
      "day.value -> sun.when", "day.value -> rise.when", "day.value -> moon.when",
      "day.value -> times.day", "hours.result -> times.hours", "times.result -> sunDay.when",
      "hours.result -> sunFrame.vals0", "sunDay.elevation -> sunFrame.vals1", "sunFrame.frame -> sunChart.values",
    ],
  },
  {
    pack: "chemistry",
    label: "Chemistry: from formula to moles",
    nodes: [
      note("head", [0, 0], "Chemistry Basics", "**Molar Mass** reads a formula (H₂O is about 18 g/mol), and the **Moles ↔ Mass** equation turns 36 g of water into moles. **pH** is −log₁₀ of the hydrogen-ion concentration: 0.001 mol/L gives pH 3. **Dilution** and **half-life** below; the **Element** card looks up iron."),
      card("mm", [c(0), 220], "MolarMassNode", undefined, { str: { formula: "H2O" } }),
      value("m", [c(0), 460], "Mass (g)", 36),
      preset("mol", [c(1), 220], "ch-moles-mass"),
      value("h", [c(2), 220], "[H⁺] (mol/L)", 0.001),
      preset("ph", [c(3), 220], "ch-ph"),
      card("fe", [c(0), 700], "ElementNode", { symbol: "Fe" }),
      preset("dil", [c(1), 700], "ch-dilution", { c1: 2, v1: 0.05, v2: 0.5 }),
      preset("decay", [c(2), 700], "ch-half-life", { n0: 100, t: 11460, thalf: 5730 }),
      expr("years", [c(0), 1000], "Years", "SEQUENCE(11, 1, 0, 2865)"),
      preset("decayT", [c(1), 1000], "ch-half-life", { n0: 100, thalf: 5730 }),
      frameOf("decayFrame", [c(2), 1000], "Carbon-14 by year", ["years", "% left"]),
      chart("decayChart", [c(3), 1000], "Half-life", "line", "title=Carbon-14: half gone every 5,730 years;xlabel=years;ylabel=% left"),
    ],
    cables: [
      "m.value -> mol.m", "mm.result -> mol.mm", "h.value -> ph.h",
      "years.result -> decayT.t", "years.result -> decayFrame.vals0", "decayT.result -> decayFrame.vals1", "decayFrame.frame -> decayChart.values",
    ],
  },
];

function make(spec: Spec): Nodes.GraphNode {
  let node: Nodes.GraphNode;
  if (spec.cat) {
    const entry = FLAT_CATALOG.get(spec.cat);
    if (!entry) throw new Error(`no catalog entry ${spec.cat}`);
    node = entry.create() as Nodes.GraphNode;
  } else {
    const Ctor = (Nodes as unknown as Record<string, new (init?: unknown) => Nodes.GraphNode>)[spec.cls!];
    if (!Ctor) throw new Error(`no class ${spec.cls}`);
    node = new Ctor(spec.init);
  }
  const n = node as unknown as { literals?: Record<string, number>; stringLiterals?: Record<string, string>; frameText?: string };
  if (spec.lit) n.literals = { ...(n.literals ?? {}), ...spec.lit };
  if (spec.str) n.stringLiterals = { ...(n.stringLiterals ?? {}), ...spec.str };
  if (spec.frame) {
    n.frameText = JSON.stringify(spec.frame.map((col) => ({
      name: col.name,
      type: col.cells.every((x) => x === "" || typeof x === "number") ? "number" : "string",
      cells: col.cells.map(String),
    })));
  }
  return node;
}

it.skipIf(!process.env.GEN_PACK_SEEDS)("writes every pack's example seed", () => {
  mkdirSync("src/graph/seedGraphs/packs", { recursive: true });
  RECIPES.forEach((r, i) => {
    const pack = BUILTIN_PACKS.find((p) => p.id === r.pack);
    if (!pack) throw new Error(`no pack ${r.pack}`);
    const nodes = r.nodes.map((s) => ({ id: s.id, x: s.at[0], y: s.at[1], ...savedNodeBody(make(s)) }));
    const connections = r.cables.map((cable) => {
      const m = /^(\S+)\.(\S+) -> (\S+)\.(\S+)$/.exec(cable);
      if (!m) throw new Error(`bad cable ${cable}`);
      return { source: m[1], sourceOutput: m[2], target: m[3], targetInput: m[4] };
    });
    const seed = { v: CURRENT_SAVE_VERSION, order: 5000 + i * 10, label: r.label, group: "Packs", nodes, connections };
    writeFileSync(`src/graph/seedGraphs/packs/${pack.seed}.json`, `${JSON.stringify(seed, null, 2)}\n`);
  });
});
