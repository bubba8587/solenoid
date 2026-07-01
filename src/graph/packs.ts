// ─── Node packs ─────────────────────────────────────────────────────────────────
// A "pack" is an additive bundle layered on top of the permanent core catalog
// (Solenoid controls + Excel-matcher nodes, which are never toggleable). Packs are
// how node domains — geometry, timesavers, advanced engineering — ship and switch
// on/off.
//
// Placement, not a separate subtree: a pack's nodes are INSERTED into the existing
// Add-menu category tree (or the catch-all "Other" category) at a target path, so
// activating a pack never grows the top-level menu. Each placed node is marked with
// a subtle "from a pack" indicator (see AddNodeMenu). A node `type` may be claimed
// by several packs (e.g. HYPOTENUSE is both Geometry and Timesavers) — the catalog
// builder inserts it once and records every owning pack (catalogUtils.buildCatalog).
//
// Activation is a PRESENTATION filter only:
//   • The Add menu shows a pack's nodes only while it (or another pack claiming the
//     same type) is active.
//   • Every pack's node constructors are ALWAYS registered (nodeRegistry +
//     FLAT_CATALOG over all packs), so a saved graph using a node from a deactivated
//     pack still loads and renders. Deactivating never breaks a file.
//
// Custom packs (dropped into a user data folder) are stubbed: the interface and
// loader exist, but loading real packs is a later step (needs the desktop shell's
// filesystem access + a settled pack format). The web build has no folder.

import type { NodeCatalogEntry } from "./AddNodeMenu";
import { HypotenuseNode, ExpressionNode } from "./rete-nodes";
import { createNotifier } from "./storeKit";
import type { PackUnit, PackFormat } from "./formatAnnotationStore";

// ─── Formula packs: the default, no-new-code pack shape ─────────────────────────
// A formula pack is pure data: a list of {label, expr} records that base Solenoid
// compiles. Each node is a pre-set Expression node — the SAME node the user could
// type by hand, with the formula and its label fixed. The variables in `expr`
// become the node's input sockets automatically (see ExpressionNode._rebuild), so
// no per-node class, component, or registry entry is needed.
//
// Because the result is a plain ExpressionNode, it serializes as one
// (type "ExpressionNode", formula in init.expr) and reloads even when the pack is
// switched off — the "a formula node is just data" guarantee in
// docs/pack-architecture.md. Reach for a real node class ONLY when a node needs
// logic the Expression compiler can't evaluate (native libs, root-finding,
// interpolation); those are the declared exceptions, not the common case.
export interface FormulaPackEntry {
  type: string;          // unique catalog id (prefix by pack, e.g. "geo-circle-area")
  label: string;         // node title
  description: string;   // hover text — show the formula, Excel-style where it helps
  expr: string;          // compiled by the core formula engine; vars → input sockets
}

function formulaNode(e: FormulaPackEntry): NodeCatalogEntry {
  return {
    type: e.type,
    label: e.label,
    description: e.description,
    // No `accent`: the Add-menu highlight is reserved for key nodes (Number, List,
    // the core Expression node…), not these presets. And no `excel`: Solenoid-
    // native, there's no single Excel function for them.
    // `locked`: a preset's formula is fixed (the pack's promise); the title stays
    // editable.
    create: () => new ExpressionNode({ label: e.label, expr: e.expr, locked: true }),
  };
}

// The Geometry pack, authored entirely as formula data. Trig is in radians (the
// core Trigonometry convention); wire a Convert node to go from degrees.
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

// A pack node + where it lands in the core category tree. `path` is the chain of
// category labels to insert under (created if missing); omitted/empty → "Other".
export interface PackPlacement {
  path?: string[];
  entry: NodeCatalogEntry;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  /** Whether the pack starts active the first time it's seen. */
  defaultActive: boolean;
  /** Nodes this pack inserts into the Add-menu tree while active. */
  nodes?: PackPlacement[];
  /** Other pack ids this pack needs — activating it activates them too. */
  dependsOn?: string[];
  /** Extra Format Controller units this pack adds (shown while active). */
  units?: PackUnit[];
  /** Extra Format Controller number formats this pack adds (shown while active). */
  formats?: PackFormat[];
}

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
// (Excel has no HYPOT function). Defined once and claimed by both packs below; the
// catalog builder dedupes by `type` and records both owners.
const HYPOTENUSE_ENTRY: NodeCatalogEntry = {
  type: "hypotenuse",
  label: "HYPOTENUSE",
  description: "Leg lengths → hypotenuse √(x²+y²)   (in Excel you'd write =SQRT(x^2+y^2))",
  create: () => new HypotenuseNode(),
};

export const BUILTIN_PACKS: Pack[] = [
  {
    id: "geometry",
    name: "Geometry",
    description: "Geometric helpers (hypotenuse, …). On by default; turn off to declutter.",
    builtin: true,
    defaultActive: true,
    nodes: [
      { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
      // Formula-data nodes — each a pre-set Expression node, no new class.
      ...GEOMETRY_FORMULAS.map((f) => ({ path: ["Numbers", "Geometry"], entry: formulaNode(f) })),
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
  },
  {
    id: "timesavers",
    name: "Common Excel Timesavers",
    description: "Solenoid conveniences that aren't single Excel functions (rolling aggregates, weighted stats, list utilities, extended logic…). On by default; turn off to declutter.",
    builtin: true,
    defaultActive: true,
    nodes: [
      { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    ],
  },
];

// Reclassification of EXISTING core catalog nodes into add-on packs — a node
// `type` → the pack id(s) that own it. Unlike `nodes` (which add NEW pack-only
// nodes), these tags re-home nodes already defined in NODE_CATALOG: the catalog
// builder marks them with the pack indicator and hides them when all their packs
// are off. Because Timesavers/Geometry ship on, nothing disappears by default.
//
// Best-effort first pass (auto-derived: not core primitives, not Excel matchers).
// Fundamental list ops (Range, LinSpace, Reverse, Slice, Length) are intentionally
// left as core. Refine freely.
export const NODE_PACK_TAGS: Record<string, string[]> = {
  // Rolling window aggregates — Excel does these by hand with OFFSET/ranges.
  "rolling-sum": ["timesavers"], "rolling-avg": ["timesavers"], "rolling-min": ["timesavers"],
  "rolling-max": ["timesavers"], "rolling-stdev": ["timesavers"], "rolling-median": ["timesavers"],
  // Weighted statistics — no single Excel function.
  "weighted-wavg": ["timesavers"], "weighted-wstdev": ["timesavers"], "weighted-wvar": ["timesavers"],
  // Position-of-extreme — Excel uses INDEX/MATCH.
  "arg-argmax": ["timesavers"], "arg-argmin": ["timesavers"],
  // List utilities with no direct Excel equivalent.
  "list-contains": ["timesavers"], "list-diff": ["timesavers"], "list-normalize": ["timesavers"],
  "list-shuffle": ["timesavers"], "list-interleave": ["timesavers"], "list-nthelement": ["timesavers"],
  "list-geometric": ["timesavers"], "list-fibonacci": ["timesavers"], "list-repeat": ["timesavers"],
  // List-wise text transforms (Solenoid extras).
  "text-map": ["timesavers"], "text-filter": ["timesavers"],
  // Excel ships ENCODEURL but not a decoder.
  "url-decode": ["timesavers"],
  // Extended boolean logic (Excel has AND/OR/NOT/XOR, not these).
  "logic-xnor": ["timesavers"], "logic-nand": ["timesavers"], "logic-nor": ["timesavers"],
};

// Custom packs loaded from the user data folder. Stubbed for now.
export interface CustomPack extends Pack { source: string }

/** Where users will drop custom packs. Shown in Settings; not yet read. */
export function customPacksFolder(): string {
  return "<app data>/Solenoid/packs";
}

/** Load custom packs from the user data folder. Stub — returns none until the
 *  desktop shell wires up filesystem access and the pack format is settled. */
export function loadCustomPacks(): CustomPack[] {
  return [];
}

/** Every pack the app knows about (built-in + any loaded custom). */
export function allPacks(): Pack[] {
  return [...BUILTIN_PACKS, ...loadCustomPacks()];
}

// A pack node placement carrying its owning pack's identity — what the catalog
// builder consumes to insert + tag + dedupe.
export interface PlacedPackNode {
  packId: string;
  packName: string;
  placement: PackPlacement;
}

/** Pack node placements, optionally only from active packs. */
export function packPlacements(opts: { activeOnly: boolean }): PlacedPackNode[] {
  if (!_initialised) initPacks();
  const packs = opts.activeOnly ? allPacks().filter((p) => _active.has(p.id)) : allPacks();
  const out: PlacedPackNode[] = [];
  for (const p of packs) {
    for (const placement of p.nodes ?? []) out.push({ packId: p.id, packName: p.name, placement });
  }
  return out;
}

// ─── Active-state store (persisted) ─────────────────────────────────────────────
const LS_KEY = "solenoid.packs";
let _active = new Set<string>();
let _initialised = false;
const { notify, subscribe, version } = createNotifier();
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify([..._active])); }
  catch { /* private mode / quota — non-fatal */ }
}

/** Read persisted pack activation (falling back to each pack's default). */
export function initPacks(): void {
  let saved: string[] | null = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) saved = JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  _active = new Set(
    saved ?? allPacks().filter((p) => p.defaultActive).map((p) => p.id),
  );
  _initialised = true;
}

export const packsStore = {
  isActive: (id: string) => _active.has(id),
  setActive(id: string, on: boolean) {
    if (on === _active.has(id)) return;
    if (on) {
      _active.add(id);
      // Pull in dependencies so the pack's nodes resolve (a pack may build on
      // another's). Transitive, guarded against cycles by the visited set.
      const seen = new Set<string>([id]);
      const queue = [...(allPacks().find((p) => p.id === id)?.dependsOn ?? [])];
      while (queue.length) {
        const dep = queue.shift()!;
        if (seen.has(dep)) continue;
        seen.add(dep);
        _active.add(dep);
        queue.push(...(allPacks().find((p) => p.id === dep)?.dependsOn ?? []));
      }
    } else {
      _active.delete(id);
      // Dependents are left active — harmless, and avoids surprise cascades.
    }
    persist();
    notify();
  },
  toggle(id: string) { this.setActive(id, !_active.has(id)); },
  version,
  subscribe,
};
