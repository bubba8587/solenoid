// [[B15]] leanCore, [[C79]] packActivationIsPresentation, [[C76]] formulaPackDefault, [[C51]] formulaNaming, [[C17]] shareImpl
// Trig is in RADIANS, per the core Trigonometry convention.

import type { NodeCatalogEntry } from "../AddNodeMenu";
import { TwoInputMathNode, TWO_INPUT_MATH_OP_META, TriangleSolverNode, UnitCircleNode, CircleSolverNode, RegularPolygonNode, TwoPointsNode, PolygonPointsNode, SolidNode } from "../nodeClasses";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";
import { GEOMETRY_PACK_FORMULAS } from "./geometryFormulas";

const GEOMETRY_FORMULAS: FormulaPackEntry[] = [
  { type: "geo-circle-area",    label: "Circle Area",          expr: "PI()*r^2",
    varDescriptions: { r: "Radius" },
    description: "Area of a circle from its radius   (in Excel you'd write =PI()*r^2)" },
  { type: "geo-circle-circum",  label: "Circle Circumference", expr: "2*PI()*r",
    varDescriptions: { r: "Radius" },
    description: "Circumference of a circle from its radius   (=2*PI()*r)" },
  { type: "geo-ellipse-area",   label: "Ellipse Area",         expr: "PI()*a*b",
    varDescriptions: { a: "Semi-major axis", b: "Semi-minor axis" },
    description: "Area of an ellipse from its two semi-axes a and b   (=PI()*a*b)" },
  { type: "geo-triangle-area",  label: "Triangle Area",        expr: "b*h/2",
    varDescriptions: { b: "Base length", h: "Height" },
    description: "Area of a triangle, b·h/2, from base and height." },
  { type: "geo-triangle-heron", label: "Triangle Area (Heron)", expr: "SQRT(((a+b+c)/2)*((a+b+c)/2-a)*((a+b+c)/2-b)*((a+b+c)/2-c))",
    varDescriptions: { a: "Side a length", b: "Side b length", c: "Side c length" },
    description: "Area of a triangle from its three side lengths a, b, c, by Heron's formula" },
  { type: "geo-trapezoid-area", label: "Trapezoid Area",       expr: "(a+b)/2*h",
    varDescriptions: { a: "First parallel side", b: "Second parallel side", h: "Height" },
    description: "Area of a trapezoid from its two parallel sides a, b and height   (=(a+b)/2*h)" },
  { type: "geo-sphere-vol",     label: "Sphere Volume",        expr: "4/3*PI()*r^3",
    varDescriptions: { r: "Radius" },
    description: "Volume of a sphere from its radius   (=4/3*PI()*r^3)" },
  { type: "geo-sphere-area",    label: "Sphere Surface Area",  expr: "4*PI()*r^2",
    varDescriptions: { r: "Radius" },
    description: "Surface area of a sphere from its radius   (=4*PI()*r^2)" },
  { type: "geo-cylinder-vol",   label: "Cylinder Volume",      expr: "PI()*r^2*h",
    varDescriptions: { r: "Radius", h: "Height" },
    description: "Volume of a cylinder from radius and height   (=PI()*r^2*h)" },
  { type: "geo-cone-vol",       label: "Cone Volume",          expr: "PI()*r^2*h/3",
    varDescriptions: { r: "Base radius", h: "Height" },
    description: "Volume of a cone from base radius and height   (=PI()*r^2*h/3)" },
  { type: "geo-distance-2d",    label: "Distance (2D)",        expr: "SQRT((x2-x1)^2+(y2-y1)^2)",
    varDescriptions: { x1: "First point x", y1: "First point y", x2: "Second point x", y2: "Second point y" },
    description: "Straight-line distance between two points (x1,y1) and (x2,y2) in the plane" },
  { type: "geo-polygon-area",   label: "Regular Polygon Area", expr: "n*s^2/(4*TAN(PI()/n))",
    varDescriptions: { n: "Number of sides", s: "Side length" },
    description: "Area of a regular n-sided polygon with side length s   (=n*s²/(4·tan(π/n)))" },
];

export const GEOMETRY_CIRCLES: FormulaPackEntry[] = [
  { type: "geo-arc-length", label: "Arc Length", expr: "r*theta",
    varDescriptions: { r: "Radius", theta: "Central angle (rad)" },
    description: "Arc length s = rθ of a circle: radius r × central angle theta in radians." },
  { type: "geo-sector-area", label: "Sector Area", expr: "r^2*theta/2",
    varDescriptions: { r: "Radius", theta: "Central angle (rad)" },
    description: "Pie-slice area A = ½r²θ: radius r, central angle theta in radians." },
  { type: "geo-chord", label: "Chord Length", expr: "2*r*SIN(theta/2)",
    varDescriptions: { r: "Radius", theta: "Central angle (rad)" },
    description: "Straight line across a circle: radius r, central angle theta (radians)   (c = 2r·sin(θ/2))" },
  { type: "geo-segment-area", label: "Circular Segment Area", expr: "r^2/2*(theta-SIN(theta))",
    varDescriptions: { r: "Radius", theta: "Central angle (rad)" },
    description: "Area between a chord and its arc: radius r, central angle theta (radians)   (A = ½r²(θ−sinθ))" },
  { type: "geo-annulus-area", label: "Annulus Area", expr: "PI()*(r2^2-r1^2)",
    varDescriptions: { r2: "Outer radius", r1: "Inner radius" },
    description: "Ring between two concentric circles: outer r2, inner r1   (A = π(r₂²−r₁²))" },
  { type: "geo-ellipse-circum", label: "Ellipse Circumference", expr: "PI()*(3*(a+b)-SQRT((3*a+b)*(a+3*b)))",
    varDescriptions: { a: "Semi-major axis", b: "Semi-minor axis" },
    description: "Perimeter of an ellipse with semi-axes a, b, by Ramanujan's approximation. Error under 0.05%" },
];

export const GEOMETRY_SOLIDS: FormulaPackEntry[] = [
  { type: "geo-distance-3d", label: "Distance (3D)", expr: "SQRT((x2-x1)^2+(y2-y1)^2+(z2-z1)^2)",
    varDescriptions: { x1: "First point x", y1: "First point y", z1: "First point z", x2: "Second point x", y2: "Second point y", z2: "Second point z" },
    description: "Straight-line distance between two points (x1,y1,z1) and (x2,y2,z2) in space" },
  { type: "geo-cuboid-diag", label: "Box Diagonal", expr: "SQRT(a^2+b^2+c^2)",
    varDescriptions: { a: "Box length", b: "Box width", c: "Box height" },
    description: "Space diagonal of an a×b×c box   (d = √(a²+b²+c²))" },
  { type: "geo-cone-slant", label: "Cone Slant Height", expr: "SQRT(r^2+h^2)",
    varDescriptions: { r: "Base radius", h: "Height" },
    description: "Slant height of a right cone from base radius and height   (l = √(r²+h²))" },
  { type: "geo-cone-area", label: "Cone Surface Area", expr: "PI()*r*(r+SQRT(r^2+h^2))",
    varDescriptions: { r: "Base radius", h: "Height" },
    description: "Total surface of a right cone (base + side) from radius and height   (A = πr(r+l))" },
  { type: "geo-cylinder-area", label: "Cylinder Surface Area", expr: "2*PI()*r*(r+h)",
    varDescriptions: { r: "Radius", h: "Height" },
    description: "Total surface of a closed cylinder from radius and height   (A = 2πr(r+h))" },
  { type: "geo-pyramid-vol", label: "Pyramid Volume", expr: "b*h/3",
    varDescriptions: { b: "Base area", h: "Height" },
    description: "Volume V = Bh/3 of any pyramid or cone from base area b and height." },
  { type: "geo-tetra-vol", label: "Tetrahedron Volume", expr: "s^3/(6*SQRT(2))",
    varDescriptions: { s: "Edge length" },
    description: "Volume of a regular tetrahedron with edge s   (V = s³/(6√2))" },
  { type: "geo-torus-vol", label: "Torus Volume", expr: "2*PI()^2*rr*r^2",
    varDescriptions: { rr: "Ring radius", r: "Tube radius" },
    description: "Volume V = 2π²Rr² of a torus: ring radius rr (center of tube), tube radius r." },
  { type: "geo-torus-area", label: "Torus Surface Area", expr: "4*PI()^2*rr*r",
    varDescriptions: { rr: "Ring radius", r: "Tube radius" },
    description: "Surface area A = 4π²Rr of a torus: ring radius rr, tube radius r." },
];

// Decimal degrees → D°M′S″.
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

// Claimed by both Geometry and Timesavers; the catalog builder dedupes by `type` and records both owners.
export const HYPOTENUSE_ENTRY: NodeCatalogEntry = {
  type: "twomath-hypot",
  label: TWO_INPUT_MATH_OP_META.hypot.label,
  description: TWO_INPUT_MATH_OP_META.hypot.description,
  keywords: "hypotenuse pythagoras leg triangle right sqrt distance",
  create: () => new TwoInputMathNode({ op: "hypot" }),
};

const CIRCLE_IDS = new Set(["geo-circle-area", "geo-circle-circum", "geo-ellipse-area"]);
const SOLID_IDS = new Set(["geo-sphere-vol", "geo-sphere-area", "geo-cylinder-vol", "geo-cone-vol"]);
const DISTANCE_IDS = new Set(["geo-distance-3d", "geo-cuboid-diag"]);

export const GEOMETRY_PACK: Pack = {
  formulas: GEOMETRY_PACK_FORMULAS,
  id: "geometry",
  seed: "pack-geometry",
  group: "Everyday",
  name: "Geometry",
  description: "Geometric helpers: hypotenuse, the any-three-parts Triangle Solver, circles and arcs, solids.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-triangle-solver",
        label: "Triangle Solver",
        description: "Any three parts, one a side, solves the rest per row: sides, degrees, area, perimeter, drawn to scale. Extra parts are checked; an ambiguous SSA says so.",
        keywords: "triangle solve sides angles law sines cosines sss sas asa aas ssa",
        create: () => new TriangleSolverNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-unit-circle", added: "1.6",
        label: "Unit Circle",
        description: "An angle on the unit circle, one row per angle: radians, reference angle, the six trig functions and their exact values at every multiple of 15°. A bare number is degrees.",
        warning: "This card suppresses errors on purpose: where a function is undefined (tan and sec at 90° and 270°, cot and csc at 0° and 180°) it answers a blank, not #DIV/0!, so turning the dial past an axis lights nothing up downstream.",
        keywords: "unit circle sine cosine tangent secant cosecant cotangent reference angle quadrant radians exact",
        create: () => new UnitCircleNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-circle-solver", added: "1.6",
        label: "Circle Solver",
        description: "A circle and an arc of it per row: radius, diameter, circumference, area, central angle, arc length, chord, sector, segment and height, from any parts that fix them. Extra parts are checked; two arcs that both fit say so.",
        keywords: "circle arc sector segment chord sagitta radius diameter circumference central angle solve",
        create: () => new CircleSolverNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-regular-polygon", added: "1.6",
        label: "Regular Polygon",
        description: "A regular polygon per row: number of sides, side, circumradius, apothem, perimeter, area, interior and exterior angles, from n or an angle and one size, or from two sizes. Extra parts are checked.",
        keywords: "regular polygon hexagon pentagon octagon apothem circumradius inradius interior exterior angle solve",
        create: () => new RegularPolygonNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-two-points", added: "1.6",
        label: "Two Points",
        description: "Two points per row and the line through them: distance, run and rise, midpoint, slope, direction, both intercepts and the equation.",
        keywords: "two points line slope distance midpoint intercept equation gradient coordinate",
        create: () => new TwoPointsNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-polygon-points", added: "1.6",
        label: "Polygon from Points",
        description: "A polygon from its vertices in order, one per row: each vertex's edge and interior angle, and the polygon's area (the shoelace formula), perimeter, centroid, convexity and winding. Edges that cross have no one area.",
        keywords: "polygon shoelace vertices area perimeter centroid convex coordinates irregular",
        create: () => new PolygonPointsNode(),
      },
    },
    {
      path: ["Packs", "Geometry"],
      entry: {
        type: "geo-solid", added: "1.6",
        label: "Solid",
        description: "A sphere, cube, box, cylinder, cone or square pyramid per row: its dimensions, volume and surface areas, from any parts that fix them. Extra parts are checked; two solids that both fit say so.",
        keywords: "solid volume surface area sphere cube box cuboid cylinder cone pyramid slant lateral 3d",
        create: () => new SolidNode(),
      },
    },
    // Menu placement is by subject, but the arrays stay grouped by wave because the tests slice them that way.
    ...placeFormulas(["Packs", "Geometry"], GEOMETRY_FORMULAS.filter((f) => !CIRCLE_IDS.has(f.type) && !SOLID_IDS.has(f.type))),
    ...placeFormulas(["Packs", "Geometry"], GEOMETRY_SOLIDS.filter((f) => DISTANCE_IDS.has(f.type))),
    ...placeFormulas(["Packs", "Geometry", "Circles & Arcs"], [...GEOMETRY_FORMULAS.filter((f) => CIRCLE_IDS.has(f.type)), ...GEOMETRY_CIRCLES]),
    ...placeFormulas(["Packs", "Geometry", "Solids"], [...GEOMETRY_FORMULAS.filter((f) => SOLID_IDS.has(f.type)), ...GEOMETRY_SOLIDS.filter((f) => !DISTANCE_IDS.has(f.type))]),
  ],
  units: [
    { id: "turn", label: " turns", group: "angle" },
    { id: "px", label: " px", group: "geometry", groupLabel: "Geometry" },
  ],
  formats: [
    { id: "dms", label: "D°M′S″ (DMS)", group: "Geometry", apply: toDMS },
  ],
};
