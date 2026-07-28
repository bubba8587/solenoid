// Format Controller annotations: nodeId::socketKey → { format, unit }
// Module-level singleton, readable from any React root.

import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./nodes/date";
import { extremeSci } from "./components/format";
import { groupingApplies, scaleApplies, negativeApplies } from "./formatModel";
import { APP_LOCALE } from "./locale";
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

// ─── Format style (how the number renders) ───────────────────────────────────

export type FormatStyle =
  | "auto"
  | "decimal"      // flexible: N places or N sig figs (decimalDigits/decimalMode)
  | "integer"      // 1,235
  | "percent"      // flexible: N places or N sig figs (decimalDigits/decimalMode)
  | "fraction"     // 1/3
  | "fraction_adv" // π/2, 3π/2, e/4 … (rational multiples of constants)
  | "scientific"   // 1.23e+4
  // NOTE: currency is NOT a format — it's a UNIT ($, €, … in UNIT_ANNOTATIONS).
  // Pick a number format (decimal/integer/…) and set the unit to a currency.
  | "custom"
  // Date styles — applied to a date serial via formatDateSerial.
  | "date_dmy"     // 03-Jun-2026 (the app default)
  | "date_iso"     // 2026-06-03
  | "date_us"      // 6/3/2026
  | "date_long"    // June 3, 2026
  | "date_med"     // Jun 3, 2026
  | "date_dow"     // Wed, Jun 3, 2026
  | "time_24"      // 14:30
  | "time_12"      // 2:30 PM
  | "datetime"     // 2026-06-03 14:30
  | "date_custom";

// A format id that may be a built-in FormatStyle OR a pack-contributed format id.
// The `& {}` keeps the built-in union members in editor autocomplete while still
// accepting any string (pack formats are registered at runtime, see below).
export type FormatStyleId = FormatStyle | (string & {});

export const FORMAT_STYLE_LABELS: Record<FormatStyle, string> = {
  auto:         "Auto",
  decimal:      "Decimal",
  integer:      "Integer",
  percent:      "Percent",
  fraction:     "Fraction",
  fraction_adv: "Fraction (π, e, √…)",
  scientific:   "Scientific",
  custom:       "Custom…",
  date_dmy:     "03-Jun-2026",
  date_iso:     "2026-06-03",
  date_us:      "6/3/2026",
  date_long:    "June 3, 2026",
  date_med:     "Jun 3, 2026",
  date_dow:     "Wed, Jun 3, 2026",
  time_24:      "14:30",
  time_12:      "2:30 PM",
  datetime:     "2026-06-03 14:30",
  date_custom:  "Custom…",
};

export const FORMAT_STYLE_GROUPS: Record<string, FormatStyle[]> = {
  "General":   ["auto"],
  "Number":    ["decimal", "integer", "fraction", "fraction_adv", "scientific"],
  "Percent":   ["percent"],
  // Currency is not a format — it's a unit (see the unit dropdown / UNIT_ANNOTATIONS).
  "Custom":    ["custom"],
};

// Date styles shown by the FC when docked to a date socket (one flat list).
export const DATE_FORMAT_STYLES: FormatStyle[] = [
  "date_dmy", "date_iso", "date_us", "date_long", "date_med", "date_dow",
  "time_24", "time_12", "datetime", "date_custom",
];

const DATE_STYLE_PATTERNS: Partial<Record<FormatStyle, string>> = {
  date_dmy:  "DD-MMM-YYYY",
  date_iso:  "YYYY-MM-DD",
  date_us:   "M/D/YYYY",
  date_long: "MMMM D, YYYY",
  date_med:  "MMM D, YYYY",
  date_dow:  "DDD, MMM D, YYYY",
  time_24:   "HH:mm",
  time_12:   "h:mm A",
  datetime:  "YYYY-MM-DD HH:mm",
};

export function isDateStyle(style: FormatStyleId): boolean {
  return style.startsWith("date_") || style.startsWith("time_") || style === "datetime";
}

export type DecimalMode = "places" | "sigfigs";

// The ONE precision resolver (format-model.md "precision × style resolution
// rule") — every style that supports precision delegates here; no style case
// carries private digit logic. Clamps: places 0–20, sig figs 1–21.
function formatPrecise(n: number, decimalDigits: number, decimalMode: DecimalMode, useGrouping = true): string {
  if (decimalMode === "sigfigs") {
    const s = Math.max(1, Math.min(21, Math.round(decimalDigits) || 1));
    return n.toLocaleString(APP_LOCALE, { minimumSignificantDigits: s, maximumSignificantDigits: s, useGrouping });
  }
  const d = Math.max(0, Math.min(20, Math.round(decimalDigits)));
  return n.toLocaleString(APP_LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping });
}

/** Apply a FormatStyle to a number. Returns the formatted string. */
export function applyFormatStyle(
  n: number,
  style: FormatStyleId,
  customPattern?: string,
  decimalDigits = 2,
  decimalMode: DecimalMode = "places",
  useGrouping = true,
): string {
  if (!Number.isFinite(n)) return String(n);
  switch (style) {
    case "decimal":      return formatPrecise(n, decimalDigits, decimalMode, useGrouping);
    case "percent":      return `${formatPrecise(n * 100, decimalDigits, decimalMode, useGrouping)}%`;
    case "integer":      return Math.round(n).toLocaleString(APP_LOCALE, { useGrouping });
    case "fraction":     return toFraction(n);
    case "fraction_adv": return toFractionAdvanced(n);
    case "scientific": {
      // Honors the precision row (format model): places d → d mantissa fraction
      // digits; s sig figs → s mantissa digits (toExponential(s − 1)).
      const d = decimalMode === "sigfigs"
        ? Math.max(0, Math.min(20, Math.round(decimalDigits) - 1))
        : Math.max(0, Math.min(20, Math.round(decimalDigits)));
      return n.toExponential(d);
    }
    case "custom":       return applyCustomPattern(n, customPattern ?? "0.00");
    default: {
      // Not a built-in style — maybe a pack-contributed format (registered for
      // every known pack, so saved graphs render even with the pack off).
      const pf = _packFormats.get(style);
      return pf ? pf.apply(n) : autoFormat(n);
    }
  }
}

function autoFormat(n: number): string {
  const sci = extremeSci(n); // shared forced-scientific rule (format.ts)
  if (sci !== null) return sci;
  if (Number.isInteger(n)) return n.toString();
  const s = parseFloat(n.toPrecision(6)).toString();
  return s;
}

function toFraction(n: number, maxDen = 99): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-12) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  if (frac < 1e-12) return `${neg ? "-" : ""}${whole}`;
  // Best rational for the fractional part via continued-fraction convergents.
  const { num, den } = cfConvergent(frac, maxDen);
  // Non-aggressive: only render a fraction when it matches to high precision.
  // Otherwise the value isn't a clean fraction — show it as a decimal instead
  // of coercing it into an ugly approximation.
  if (!den || Math.abs(frac - num / den) > 1e-9) return autoFormat(n);
  const sign = neg ? "-" : "";
  return whole > 0 ? `${sign}${whole} ${num}/${den}` : `${sign}${num}/${den}`;
}

// ─── Fraction (advanced): rational multiples of constants ──────────────────────
// Established method (no home-grown heuristic): recognize x ≈ (p/q)·c by dividing
// by each candidate constant c and finding the best low-denominator rational p/q
// via the continued-fraction convergents algorithm — the standard way to get the
// closest rational with a bounded denominator. (This is the lightweight cousin of
// PSLQ / the Inverse Symbolic Calculator, restricted to a single-constant basis.)

/** Best rational p/q ≈ x with q ≤ maxDen, via continued-fraction convergents. */
function cfConvergent(x: number, maxDen: number): { num: number; den: number } {
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0; // numerator/denominator recurrences
  let b = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  return { num: h1, den: k1 };
}

const FRACTION_CONSTANTS: ReadonlyArray<readonly [string, number]> = [
  ["π", Math.PI],
  ["e", Math.E],
  ["√2", Math.SQRT2],
  ["√3", Math.sqrt(3)],
  ["√5", Math.sqrt(5)],
  ["φ", (1 + Math.sqrt(5)) / 2],
  ["π²", Math.PI * Math.PI],
];

function formatConstFraction(num: number, den: number, sym: string): string {
  const neg = num < 0;
  const p = Math.abs(num);
  const top = `${p === 1 ? "" : p}${sym}`;          // "π", "3π"
  const body = den === 1 ? top : `${top}/${den}`;    // "π/2", "3π/2", "2π"
  return (neg ? "-" : "") + body;
}

function toFractionAdvanced(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-12) return "0";
  const maxDen = 36;
  const relTol = 1e-6; // catches ~6-significant-figure inputs like 1.570796 → π/2
  let best: { num: number; den: number; sym: string } | null = null;
  for (const [sym, c] of FRACTION_CONSTANTS) {
    const q = n / c;
    const { num, den } = cfConvergent(Math.abs(q), maxDen);
    if (!den || num === 0) continue;
    const approx = Math.sign(q) * (num / den) * c;
    const err = Math.abs(approx - n) / Math.abs(n);
    // Genuine matches converge to a small-denominator rational within tolerance;
    // arbitrary numbers don't. Prefer the simplest (smallest denominator) hit.
    if (err < relTol && (!best || den < best.den)) {
      best = { num: Math.sign(q) * num, den, sym };
    }
  }
  // No constant fits → fall back to a plain fraction.
  return best ? formatConstFraction(best.num, best.den, best.sym) : toFraction(n);
}

function applyCustomPattern(n: number, pattern: string): string {
  // Minimal Excel-ish custom number format support.
  // Supports: 0, #, ., comma grouping.
  const dp = (pattern.match(/\.([0#]+)/) ?? [, ""])[1]?.length ?? 0;
  const useGrouping = pattern.includes(",");
  return n.toLocaleString(APP_LOCALE, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    useGrouping,
  });
}

// ─── Unit labels (physical/semantic annotation) ───────────────────────────────

export type UnitGroup =
  | "none"
  | "angle"
  | "length"
  | "mass"
  | "temperature"
  | "time"
  | "area"
  | "volume"
  | "speed"
  | "data"
  | "currency"
  | "custom";

export type UnitAnnotation = {
  id: string;
  label: string;     // display affix e.g. "°C", "$"
  group: UnitGroup;
  prefix?: boolean;  // render before the number (currencies: "$1,234")
};

export const UNIT_ANNOTATIONS: UnitAnnotation[] = [
  { id: "none",  label: "",      group: "none" },
  // Angle
  { id: "deg",   label: "°",     group: "angle" },
  { id: "rad",   label: " rad",  group: "angle" },
  { id: "grad",  label: " grad", group: "angle" },
  // Length
  { id: "m",     label: " m",    group: "length" },
  { id: "km",    label: " km",   group: "length" },
  { id: "cm",    label: " cm",   group: "length" },
  { id: "mm",    label: " mm",   group: "length" },
  { id: "in",    label: "\"",    group: "length" },
  { id: "ft",    label: "'",     group: "length" },
  { id: "mi",    label: " mi",   group: "length" },
  // Mass
  { id: "kg",    label: " kg",   group: "mass" },
  { id: "g",     label: " g",    group: "mass" },
  { id: "mg",    label: " mg",   group: "mass" },
  { id: "lb",    label: " lb",   group: "mass" },
  { id: "oz",    label: " oz",   group: "mass" },
  // Temperature
  { id: "degC",  label: " °C",   group: "temperature" },
  { id: "degF",  label: " °F",   group: "temperature" },
  { id: "K",     label: " K",    group: "temperature" },
  // Time
  { id: "s",     label: " s",    group: "time" },
  { id: "ms",    label: " ms",   group: "time" },
  { id: "min",   label: " min",  group: "time" },
  { id: "hr",    label: " hr",   group: "time" },
  { id: "day",   label: " day",  group: "time" },
  // Area
  { id: "m2",    label: " m²",   group: "area" },
  { id: "km2",   label: " km²",  group: "area" },
  { id: "ha",    label: " ha",   group: "area" },
  { id: "ft2",   label: " ft²",  group: "area" },
  { id: "ac",    label: " ac",   group: "area" },
  // Volume
  { id: "m3",    label: " m³",   group: "volume" },
  { id: "L",     label: " L",    group: "volume" },
  { id: "mL",    label: " mL",   group: "volume" },
  { id: "gal",   label: " gal",  group: "volume" },
  // Speed
  { id: "ms1",   label: " m/s",  group: "speed" },
  { id: "kmh",   label: " km/h", group: "speed" },
  { id: "mph",   label: " mph",  group: "speed" },
  // Data
  { id: "b",     label: " B",    group: "data" },
  { id: "kb",    label: " KB",   group: "data" },
  { id: "mb",    label: " MB",   group: "data" },
  { id: "gb",    label: " GB",   group: "data" },
  { id: "tb",    label: " TB",   group: "data" },
  // Currency is a UNIT (a value's currency carries real meaning — $ ≠ € at the
  // exchange rate), not a number format. Rendered as a leading symbol.
  { id: "usd",   label: "$", group: "currency", prefix: true },
  { id: "eur",   label: "€", group: "currency", prefix: true },
  { id: "gbp",   label: "£", group: "currency", prefix: true },
  { id: "jpy",   label: "¥", group: "currency", prefix: true },
  // Custom
  { id: "custom", label: "",     group: "custom" },
];

export const UNIT_GROUP_LABELS: Record<UnitGroup, string> = {
  none:        "—",
  angle:       "Angle",
  length:      "Length",
  mass:        "Mass",
  temperature: "Temperature",
  time:        "Time",
  area:        "Area",
  volume:      "Volume",
  speed:       "Speed",
  data:        "Data",
  currency:    "Currency",
  custom:      "Custom",
};

// ─── Pack extensions (units + number formats) ─────────────────────────────────
// Packs can contribute extra FC units and number formats. Like pack node
// constructors, these are registered for EVERY known pack (active or not) so a
// saved graph that uses a pack's unit/format still renders when the pack is
// deactivated. The FC dropdown offers only ACTIVE packs' entries — see
// fcExtensions.ts, which owns the active filtering; this module stays
// pack-agnostic and only holds the merged resolution maps.

export interface PackUnit {
  id: string;
  label: string;             // display affix, e.g. " psi"
  group: UnitGroup | string; // an existing group id, or a new one (+ groupLabel)
  groupLabel?: string;       // label for a brand-new group
  prefix?: boolean;          // render before the number (currencies)
}

export interface PackFormat {
  id: string;
  label: string;             // dropdown label
  group?: string;            // dropdown optgroup label (default "Pack")
  apply: (n: number) => string;
}

const _packUnits = new Map<string, UnitAnnotation>();
const _packUnitGroupLabels = new Map<string, string>();
const _packFormats = new Map<string, { label: string; group: string; apply: (n: number) => string }>();

/** Register a pack's FC units for resolution (idempotent by id). */
export function registerPackUnits(units: PackUnit[]): void {
  for (const u of units) {
    _packUnits.set(u.id, { id: u.id, label: u.label, group: u.group as UnitGroup, prefix: u.prefix });
    if (u.groupLabel) _packUnitGroupLabels.set(u.group, u.groupLabel);
  }
}

/** Register a pack's FC number formats for resolution (idempotent by id). */
export function registerPackFormats(formats: PackFormat[]): void {
  for (const f of formats) {
    _packFormats.set(f.id, { label: f.label, group: f.group ?? "Pack", apply: f.apply });
  }
}

/** Resolved label for a unit-group id (built-in or pack-contributed). */
export function unitGroupLabel(group: string): string {
  return UNIT_GROUP_LABELS[group as UnitGroup] ?? _packUnitGroupLabels.get(group) ?? group;
}

/** A pack-contributed format's dropdown label, if `id` is one. */
export function packFormatLabel(id: string): string | undefined {
  return _packFormats.get(id)?.label;
}

export function unitById(id: string): UnitAnnotation {
  return UNIT_ANNOTATIONS.find((u) => u.id === id) ?? _packUnits.get(id) ?? UNIT_ANNOTATIONS[0];
}

/** Is `id` a known unit annotation? (Used to map Convert units onto FC units.) */
export function isFcUnit(id: string): boolean {
  return UNIT_ANNOTATIONS.some((u) => u.id === id) || _packUnits.has(id);
}

/** Two unit annotations are compatible if either is "none" or they share a group. */
export function unitsCompatible(a: string, b: string): boolean {
  if (a === "none" || b === "none") return true;
  const ga = unitById(a).group;
  const gb = unitById(b).group;
  if (ga === "custom" || gb === "custom") return true;
  return ga === gb;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export type TextCase = "none" | "upper" | "lower" | "proper";

// Text-value advanced tier (format-model.md): horizontal alignment override
// (the display box is right-aligned by default), render-as-markdown, and a
// monospace toggle (text renders in the sans face by default). All display-only.
export type TextAlign = "left" | "center" | "right";

// Logical "show-as" (format-model.md): how a boolean renders through an FC.
export type LogicalStyle = "truefalse" | "binary" | "yesno" | "check";

export const LOGICAL_STYLE_LABELS: Record<LogicalStyle, string> = {
  truefalse: "TRUE / FALSE",
  binary:    "1 / 0",
  yesno:     "Yes / No",
  check:     "✓ / ✗",
};

// Lambda-socket view-as (display only): how a flowing LambdaValue renders in a
// value box. The value already carries its source (`expr`/`params`), so every
// view derives from the same object — nothing extra travels the cable.
export type LambdaView = "signature" | "katex" | "syntax" | "mono";

export const LAMBDA_VIEW_LABELS: Record<LambdaView, string> = {
  signature: "λ(params)",
  katex:     "Equation (KaTeX)",
  syntax:    "Highlighted formula",
  mono:      "Monospace formula",
};

// Chart-socket text scale (display only): multiplies every text size inside a
// chart figure (axis ticks, title, labels, KPI digits). 1 = the built-in sizes.
export const CHART_FONT_SCALES: number[] = [0.8, 1, 1.25, 1.5, 2];

/** Display-only boolean rendering (default = the Excel TRUE/FALSE form). */
export function applyLogicalStyle(b: boolean, style?: LogicalStyle): string {
  switch (style) {
    case "binary": return b ? "1" : "0";
    case "yesno":  return b ? "Yes" : "No";
    case "check":  return b ? "✓" : "✗";
    default:       return b ? "TRUE" : "FALSE";
  }
}

// The advanced tier (format-model.md): number-family extras behind the chip's
// expander. Scale divides the value and appends K/M/B; negative style is a
// string transform (parens) plus a render hint (red — surfaces apply the color
// via annotationRendersNegativeRed, the string form stays minus/parens).
export type NegativeStyle = "minus" | "paren" | "red" | "redparen";
export type ScaleMode = "none" | "k" | "m" | "b";

export const NEGATIVE_STYLE_LABELS: Record<NegativeStyle, string> = {
  minus:    "-1,234",
  paren:    "(1,234)",
  red:      "-1,234 in red",
  redparen: "(1,234) in red",
};
export const SCALE_MODE_LABELS: Record<ScaleMode, string> = {
  none: "As-is",
  k:    "Thousands (K)",
  m:    "Millions (M)",
  b:    "Billions (B)",
};
const SCALE_DIVISOR: Record<ScaleMode, number> = { none: 1, k: 1e3, m: 1e6, b: 1e9 };
const SCALE_SUFFIX: Record<ScaleMode, string> = { none: "", k: "K", m: "M", b: "B" };

export type FormatAnnotation = {
  format: FormatStyleId;
  customPattern?: string;
  unit: string;       // id from UNIT_ANNOTATIONS, or a custom string
  customUnit?: string;
  // Text-socket display options (non-destructive — display only).
  textCase?: TextCase;
  bold?: boolean;
  italic?: boolean;
  textScale?: number; // font-size multiplier (1 = normal)
  // Text advanced tier (all display-only; default undefined = current behavior).
  textAlign?: TextAlign;    // overrides the box's right-aligned default
  textMarkdown?: boolean;   // render the string as (inline) markdown
  textMono?: boolean;       // render in the monospace face instead of sans
  // Flexible "decimal" format params (digit count + places-vs-sig-figs).
  decimalDigits?: number;
  decimalMode?: DecimalMode;
  // Logical-socket show-as (display only).
  logicalStyle?: LogicalStyle;
  // Lambda-socket view-as (display only).
  lambdaView?: LambdaView;
  // Chart-socket text-scale multiplier (display only; 1 = built-in sizes).
  chartFontScale?: number;
  // Advanced tier (number family).
  grouping?: boolean;           // thousands separator (default true)
  negativeStyle?: NegativeStyle;
  scaleMode?: ScaleMode;
};

/** Should a surface paint this (negative) value in the danger red? The string
 *  form from formatNumberWithAnnotation already carries the minus/parens; red
 *  is a color the render layer applies on top. */
export function annotationRendersNegativeRed(ann: FormatAnnotation | undefined, n: unknown): boolean {
  return !!ann && typeof n === "number" && n < 0 &&
    (ann.negativeStyle === "red" || ann.negativeStyle === "redparen");
}

/** Display-only case transform for a string (UPPER / lower / Proper). */
export function applyTextCase(s: string, c: TextCase | undefined): string {
  switch (c) {
    case "upper": return s.toUpperCase();
    case "lower": return s.toLowerCase();
    case "proper": return s.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\B\w/g, (ch) => ch.toLowerCase());
    default: return s;
  }
}

const _store = new Map<string, FormatAnnotation>();
// Per-node index so getForNode is O(1) — every value box calls it every render,
// and the startsWith scan over the whole map multiplied out on big graphs
// (audit finding 41).
const _byNode = new Map<string, Map<string, FormatAnnotation>>();
// Version bumps on every change so useSyncExternalStore consumers (every node's
// value box) re-render when an annotation is added / edited / removed.
const { notify, subscribe, version } = createNotifier();

function key(nodeId: string, socketKey: string): string {
  return `${nodeId}::${socketKey}`;
}

export const formatAnnotationStore = {
  set(nodeId: string, socketKey: string, ann: FormatAnnotation): void {
    _store.set(key(nodeId, socketKey), ann);
    let inner = _byNode.get(nodeId);
    if (!inner) { inner = new Map(); _byNode.set(nodeId, inner); }
    inner.set(socketKey, ann);
    notify();
  },
  get(nodeId: string, socketKey: string): FormatAnnotation | undefined {
    return _store.get(key(nodeId, socketKey));
  },
  /** The annotation on any socket of a node (a node carries at most one FC). */
  getForNode(nodeId: string): FormatAnnotation | undefined {
    const inner = _byNode.get(nodeId);
    if (!inner) return undefined;
    for (const ann of inner.values()) return ann;
    return undefined;
  },
  delete(nodeId: string, socketKey: string): void {
    if (_store.delete(key(nodeId, socketKey))) {
      const inner = _byNode.get(nodeId);
      if (inner) {
        inner.delete(socketKey);
        if (inner.size === 0) _byNode.delete(nodeId);
      }
      notify();
    }
  },
  /** Drop every annotation of a (deleted) node — the registry forget. */
  removeForNode(nodeId: string): void {
    const inner = _byNode.get(nodeId);
    if (!inner) return;
    for (const socketKey of inner.keys()) _store.delete(key(nodeId, socketKey));
    _byNode.delete(nodeId);
    notify();
  },
  /** Drop ALL node annotations (rebuild). Leaves the pack-contributed format/unit
   *  REGISTRATIONS alone — those are extensions, not node state. */
  clearNodes(): void {
    if (_store.size === 0) return;
    _store.clear();
    _byNode.clear();
    notify();
  },
  subscribe,
  /** Monotonic version for useSyncExternalStore snapshots. */
  version,
  /** All annotations keyed by nodeId::socketKey. */
  snapshot(): ReadonlyMap<string, FormatAnnotation> {
    return _store;
  },
};

// ─── Mismatch store ───────────────────────────────────────────────────────────
// Tracks which Format Controller node IDs are in a "unit mismatch" state
// (a cable connects them to a socket annotated with an incompatible unit group).
// Written by the Canvas connection pipe; read by FormatControllerComponent.

const _mismatch = new Set<string>();
const mismatchNotifier = createNotifier();

export const formatMismatchStore = {
  setMismatch(nodeId: string, has: boolean): void {
    const changed = has ? !_mismatch.has(nodeId) : _mismatch.has(nodeId);
    if (!changed) return;
    if (has) _mismatch.add(nodeId); else _mismatch.delete(nodeId);
    mismatchNotifier.notify();
  },
  has(nodeId: string): boolean {
    return _mismatch.has(nodeId);
  },
  subscribe: mismatchNotifier.subscribe,
};

/** Format a number with a resolved annotation — the format-model pipeline:
 *  scale-divide → style (precision + grouping) → scale suffix → unit affix →
 *  negative wrap. Red negatives are a render-layer color on top of this string
 *  (annotationRendersNegativeRed); parens wrap OUTSIDE the unit, Excel
 *  accounting style: ($1.2K). */
export function formatNumberWithAnnotation(n: number, ann: FormatAnnotation): string {
  if (!Number.isFinite(n)) return String(n);
  // Date styles render the value as a date serial; units don't apply.
  if (isDateStyle(ann.format)) {
    const pattern = ann.format === "date_custom"
      ? (ann.customPattern || DEFAULT_DATE_FORMAT)
      // Guarded by isDateStyle, so format is a built-in date style here.
      : (DATE_STYLE_PATTERNS[ann.format as FormatStyle] ?? DEFAULT_DATE_FORMAT);
    return formatDateSerial(n, pattern);
  }
  const scale: ScaleMode = ann.scaleMode && scaleApplies(ann.format) ? ann.scaleMode : "none";
  const paren = (ann.negativeStyle === "paren" || ann.negativeStyle === "redparen") &&
    negativeApplies(ann.format) && n < 0;
  const magnitude = (paren ? -n : n) / SCALE_DIVISOR[scale];
  const grouping = groupingApplies(ann.format) ? ann.grouping !== false : true;
  const formatted =
    applyFormatStyle(magnitude, ann.format, ann.customPattern, ann.decimalDigits, ann.decimalMode, grouping) +
    SCALE_SUFFIX[scale];
  let out: string;
  if (ann.unit === "custom") {
    const u = ann.customUnit ?? "";
    out = u ? `${formatted}${u}` : formatted;
  } else {
    const u = unitById(ann.unit);
    out = !u.label ? formatted : u.prefix ? `${u.label}${formatted}` : `${formatted}${u.label}`;
  }
  return paren ? `(${out})` : out;
}

/** Format a number using the annotation for a given socket, falling back to auto. */
export function formatWithAnnotation(
  n: number,
  nodeId: string,
  socketKey: string,
): string {
  const ann = formatAnnotationStore.get(nodeId, socketKey);
  if (!ann) return autoFormat(n);
  return formatNumberWithAnnotation(n, ann);
}

// Registered like every node-keyed store (nodeStoreRegistry / STORE-1): a
// deleted node's annotations go with it (they were re-derived per reconcile
// pass but the DEAD-id entries lingered — the recorded leak), and a rebuild
// clears node state in one pass without touching pack registrations.
registerNodeForget((nodeId) => formatAnnotationStore.removeForNode(nodeId));
registerNodeForgetAll(() => formatAnnotationStore.clearNodes());
