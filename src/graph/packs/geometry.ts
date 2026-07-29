// The Geometry pack — the original worked example of the formula-data pack
// shape (docs/pack-architecture.md). Trig is in radians (the core Trigonometry
// convention); wire a Convert node to go from degrees.

import type { NodeCatalogEntry } from "../AddNodeMenu";
import { HypotenuseNode, TriangleSolverNode, solveGivenParts, type TriangleGiven } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry, type PackFormula } from "./packShared";

const GEOMETRY_FORMULAS: FormulaPackEntry[] = [
  { type: "geo-circle-area",    label: "Circle Area",          expr: "PI()*r^2",
    description: "Area of a circle from its radius   (in Excel you'd write =PI()*r^2)" },
  { type: "geo-circle-circum",  label: "Circle Circumference", expr: "2*PI()*r",
    description: "Circumference of a circle from its radius   (=2*PI()*r)" },
  { type: "geo-ellipse-area",   label: "Ellipse Area",         expr: "PI()*a*b",
    description: "Area of an ellipse from its two semi-axes a and b   (=PI()*a*b)" },
  { type: "geo-triangle-area",  label: "Triangle Area",        expr: "b*h/2",
    description: "Area of a triangle from base and height   (=b*h/2)" },
  { type: "geo-triangle-heron", label: "Triangle Area (Heron)", expr: "SQRT(((a+b+c)/2)*((a+b+c)/2-a)*((a+b+c)/2-b)*((a+b+c)/2-c))",
    description: "Area of a triangle from its three side lengths a, b, c (Heron's formula)" },
  { type: "geo-trapezoid-area", label: "Trapezoid Area",       expr: "(a+b)/2*h",
    description: "Area of a trapezoid from its two parallel sides a, b and height   (=(a+b)/2*h)" },
  { type: "geo-sphere-vol",     label: "Sphere Volume",        expr: "4/3*PI()*r^3",
    description: "Volume of a sphere from its radius   (=4/3*PI()*r^3)" },
  { type: "geo-sphere-area",    label: "Sphere Surface Area",  expr: "4*PI()*r^2",
    description: "Surface area of a sphere from its radius   (=4*PI()*r^2)" },
  { type: "geo-cylinder-vol",   label: "Cylinder Volume",      expr: "PI()*r^2*h",
    description: "Volume of a cylinder from radius and height   (=PI()*r^2*h)" },
  { type: "geo-cone-vol",       label: "Cone Volume",          expr: "PI()*r^2*h/3",
    description: "Volume of a cone from base radius and height   (=PI()*r^2*h/3)" },
  { type: "geo-distance-2d",    label: "Distance (2D)",        expr: "SQRT((x2-x1)^2+(y2-y1)^2)",
    description: "Straight-line distance between two points (x1,y1) and (x2,y2)" },
  { type: "geo-polygon-area",   label: "Regular Polygon Area", expr: "n*s^2/(4*TAN(PI()/n))",
    description: "Area of a regular n-sided polygon with side length s   (=n*s²/(4·tan(π/n)))" },
];

// Second wave (2026-07-09): circles & arcs, 3-D solids, and the Ramanujan
// ellipse circumference. Same conventions — radians, any consistent length unit.
export const GEOMETRY_CIRCLES: FormulaPackEntry[] = [
  { type: "geo-arc-length", label: "Arc Length", expr: "r*theta",
    description: "Arc of a circle: radius r × central angle theta (radians)   (s = rθ)" },
  { type: "geo-sector-area", label: "Sector Area", expr: "r^2*theta/2",
    description: "Pie-slice area: radius r, central angle theta (radians)   (A = ½r²θ)" },
  { type: "geo-chord", label: "Chord Length", expr: "2*r*SIN(theta/2)",
    description: "Straight line across a circle: radius r, central angle theta (radians)   (c = 2r·sin(θ/2))" },
  { type: "geo-segment-area", label: "Circular Segment Area", expr: "r^2/2*(theta-SIN(theta))",
    description: "Area between a chord and its arc: radius r, central angle theta (radians)   (A = ½r²(θ−sinθ))" },
  { type: "geo-annulus-area", label: "Annulus Area", expr: "PI()*(r2^2-r1^2)",
    description: "Ring between two concentric circles: outer r2, inner r1   (A = π(r₂²−r₁²))" },
  { type: "geo-ellipse-circum", label: "Ellipse Circumference", expr: "PI()*(3*(a+b)-SQRT((3*a+b)*(a+3*b)))",
    description: "Perimeter of an ellipse with semi-axes a, b — Ramanujan's approximation (error < 0.05%)" },
];

export const GEOMETRY_SOLIDS: FormulaPackEntry[] = [
  { type: "geo-distance-3d", label: "Distance (3D)", expr: "SQRT((x2-x1)^2+(y2-y1)^2+(z2-z1)^2)",
    description: "Straight-line distance between two points (x1,y1,z1) and (x2,y2,z2)" },
  { type: "geo-cuboid-diag", label: "Box Diagonal", expr: "SQRT(a^2+b^2+c^2)",
    description: "Space diagonal of an a×b×c box   (d = √(a²+b²+c²))" },
  { type: "geo-cone-slant", label: "Cone Slant Height", expr: "SQRT(r^2+h^2)",
    description: "Slant height of a right cone from base radius and height   (l = √(r²+h²))" },
  { type: "geo-cone-area", label: "Cone Surface Area", expr: "PI()*r*(r+SQRT(r^2+h^2))",
    description: "Total surface of a right cone (base + side) from radius and height   (A = πr(r+l))" },
  { type: "geo-cylinder-area", label: "Cylinder Surface Area", expr: "2*PI()*r*(r+h)",
    description: "Total surface of a closed cylinder from radius and height   (A = 2πr(r+h))" },
  { type: "geo-pyramid-vol", label: "Pyramid Volume", expr: "b*h/3",
    description: "Volume of any pyramid or cone from base AREA b and height   (V = Bh/3)" },
  { type: "geo-tetra-vol", label: "Tetrahedron Volume", expr: "s^3/(6*SQRT(2))",
    description: "Volume of a regular tetrahedron with edge s   (V = s³/(6√2))" },
  { type: "geo-torus-vol", label: "Torus Volume", expr: "2*PI()^2*rr*r^2",
    description: "Volume of a torus: ring radius rr (center of tube), tube radius r   (V = 2π²Rr²)" },
  { type: "geo-torus-area", label: "Torus Surface Area", expr: "4*PI()^2*rr*r",
    description: "Surface of a torus: ring radius rr, tube radius r   (A = 4π²Rr)" },
];

// Decimal degrees → D°M′S″ (a real geometry/navigation format — demonstrates a
// pack contributing display logic the core doesn't ship).
function toDMS(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? "-" : "";
  const deg = Math.abs(n);
  let d = Math.floor(deg);
  let m = Math.floor((deg - d) * 60);
  let s = Math.round((deg - d - m / 60) * 3600);
  if (s === 60) { s = 0; m += 1; }
  if (m === 60) { m = 0; d += 1; }
  return `${sign}${d}°${m}′${s}″`;
}

// HYPOTENUSE is the archetypal cross-domain timesaver: it belongs to Geometry AND
// to a general "timesavers" bundle, and is neither core nor a true Excel matcher
// (Excel has no HYPOT function). Defined once and claimed by both packs; the
// catalog builder dedupes by `type` and records both owners.
export const HYPOTENUSE_ENTRY: NodeCatalogEntry = {
  type: "hypotenuse",
  label: "HYPOTENUSE",
  description: "Leg lengths → hypotenuse √(x²+y²)   (in Excel you'd write =SQRT(x^2+y^2))",
  create: () => new HypotenuseNode(),
};

// Which formulas file under which Add-menu subcategory (see the placement
// note in `nodes` below).
const CIRCLE_IDS = new Set(["geo-circle-area", "geo-circle-circum", "geo-ellipse-area"]);
const SOLID_IDS = new Set(["geo-sphere-vol", "geo-sphere-area", "geo-cylinder-vol", "geo-cone-vol"]);
const DISTANCE_IDS = new Set(["geo-distance-3d", "geo-cuboid-diag"]);

// The pack's custom-logic node as a formula function (D19 decision 4): the
// solver core is the node's own `solveGivenParts`, so a typed
// TRIANGLESOLVER(3, 4, , , , 90) and the node card agree on every edge.
const GEOMETRY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "TRIANGLESOLVER",
    impl: (...args: unknown[]) => {
      const keys = ["a", "b", "c", "A", "B", "C"] as const;
      const given: Record<string, number> = {};
      let any = false;
      keys.forEach((k, i) => {
        const v = args[i];
        if (typeof v === "number" && Number.isFinite(v)) { given[k] = v; any = true; }
      });
      if (!any) return null;
      const r = solveGivenParts(given as TriangleGiven);
      return keys.map((k) => r.values[k]);
    },
    returns: "number", rank: "list", arity: [3, 6],
    signature: "a, b, c, A°, B°, C° — any 3 incl. a side; returns all six",
  },
];

export const GEOMETRY_PACK: Pack = {
  formulas: GEOMETRY_PACK_FORMULAS,
  id: "geometry",
  name: "Geometry",
  description: "Geometric helpers: hypotenuse, the any-three-parts Triangle Solver, circles and arcs, solids. On by default; turn off to declutter.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-triangle-solver",
        label: "Triangle Solver",
        description: "Any three parts — sides a b c, angles A B C in degrees, at least one side — and the rest solve, drawn to scale on the card, plus area and perimeter. Valid answers TRUE/FALSE; give more than three parts and it checks they agree. A genuinely ambiguous SSA says so instead of guessing",
        keywords: "triangle solve sides angles law sines cosines sss sas asa aas ssa",
        create: () => new TriangleSolverNode(),
      },
    },
    // Formula-data nodes — each a pre-set Expression node, no new class.
    // Placement is by SUBJECT, not by wave (2026-07-16 — all first-wave
    // formulas at top level made a 15-row pane): circle/ellipse and solid
    // formulas file under their subcategories, and the two point-distance
    // formulas from the solids wave surface beside Distance (2D). The arrays
    // stay grouped by wave — that's how the tests slice them.
    ...placeFormulas(["Packs", "Geometry"], GEOMETRY_FORMULAS.filter((f) => !CIRCLE_IDS.has(f.type) && !SOLID_IDS.has(f.type))),
    ...placeFormulas(["Packs", "Geometry"], GEOMETRY_SOLIDS.filter((f) => DISTANCE_IDS.has(f.type))),
    ...placeFormulas(["Packs", "Geometry", "Circles & Arcs"], [...GEOMETRY_FORMULAS.filter((f) => CIRCLE_IDS.has(f.type)), ...GEOMETRY_CIRCLES]),
    ...placeFormulas(["Packs", "Geometry", "Solids"], [...GEOMETRY_FORMULAS.filter((f) => SOLID_IDS.has(f.type)), ...GEOMETRY_SOLIDS.filter((f) => !DISTANCE_IDS.has(f.type))]),
  ],
  // Pack contributions to the Format Controller: a unit in an existing group
  // (angle: turns), a unit in a brand-new group (Geometry: pixels), and a number
  // format with custom logic (degrees-minutes-seconds).
  units: [
    { id: "turn", label: " turns", group: "angle" },
    { id: "px", label: " px", group: "geometry", groupLabel: "Geometry" },
  ],
  formats: [
    { id: "dms", label: "D°M′S″ (DMS)", group: "Geometry", apply: toDMS },
  ],
};
