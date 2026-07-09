// The Geometry pack — the original worked example of the formula-data pack
// shape (docs/pack-architecture.md). Trig is in radians (the core Trigonometry
// convention); wire a Convert node to go from degrees.

import type { NodeCatalogEntry } from "../AddNodeMenu";
import { HypotenuseNode } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

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

export const GEOMETRY_PACK: Pack = {
  id: "geometry",
  name: "Geometry",
  description: "Geometric helpers (hypotenuse, …). On by default; turn off to declutter.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    // Formula-data nodes — each a pre-set Expression node, no new class.
    ...placeFormulas(["Numbers", "Geometry"], GEOMETRY_FORMULAS),
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
