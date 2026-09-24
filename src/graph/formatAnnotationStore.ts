// [[C94]] formatFamilyGates, [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[D47]] noMixCurrencies, [[C44]] dateSerials, [[C79]] packActivationIsPresentation

import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./nodes/dateSerial";
import { extremeSci } from "./components/format";
import { groupingApplies, scaleApplies, negativeApplies, COMPLEX_FORMAT_STYLES } from "./formatModel";
import { assembleCx, type Cx } from "./cxValue";
import { APP_LOCALE } from "./locale";
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export type FormatStyle =
  | "auto"
  | "decimal"
  | "integer"
  | "percent"
  | "fraction"
  | "fraction_adv"
  | "scientific"
  | "custom"
  | "date_dmy"
  | "date_iso"
  | "date_us"
  | "date_long"
  | "date_med"
  | "date_dow"
  | "time_24"
  | "time_12"
  | "datetime"
  | "date_custom";

// `& {}` keeps the built-in members in autocomplete while accepting runtime pack format ids.
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
  "Custom":    ["custom"],
};

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

export function dateAnnotationPattern(ann: FormatAnnotation): string | null {
  if (!isDateStyle(ann.format)) return null;
  return ann.format === "date_custom"
    ? (ann.customPattern || DEFAULT_DATE_FORMAT)
    : (DATE_STYLE_PATTERNS[ann.format as FormatStyle] ?? DEFAULT_DATE_FORMAT);
}

export type DecimalMode = "places" | "sigfigs";

function formatPrecise(n: number, decimalDigits: number, decimalMode: DecimalMode, useGrouping = true): string {
  if (decimalMode === "sigfigs") {
    const s = Math.max(1, Math.min(21, Math.round(decimalDigits) || 1));
    return n.toLocaleString(APP_LOCALE, { minimumSignificantDigits: s, maximumSignificantDigits: s, useGrouping });
  }
  const d = Math.max(0, Math.min(20, Math.round(decimalDigits)));
  return n.toLocaleString(APP_LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping });
}

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
      const d = decimalMode === "sigfigs"
        ? Math.max(0, Math.min(20, Math.round(decimalDigits) - 1))
        : Math.max(0, Math.min(20, Math.round(decimalDigits)));
      return n.toExponential(d);
    }
    case "custom":       return applyCustomPattern(n, customPattern ?? "0.00");
    default: {
      const pf = _packFormats.get(style);
      return pf ? pf.apply(n) : autoFormat(n);
    }
  }
}

function autoFormat(n: number): string {
  const sci = extremeSci(n);
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
  const { num, den } = cfConvergent(frac, maxDen);
  if (!den || Math.abs(frac - num / den) > 1e-9) return autoFormat(n);
  const sign = neg ? "-" : "";
  return whole > 0 ? `${sign}${whole} ${num}/${den}` : `${sign}${num}/${den}`;
}

function cfConvergent(x: number, maxDen: number): { num: number; den: number } {
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
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
  const top = `${p === 1 ? "" : p}${sym}`;
  const body = den === 1 ? top : `${top}/${den}`;
  return (neg ? "-" : "") + body;
}

function toFractionAdvanced(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) < 1e-12) return "0";
  const maxDen = 36;
  const relTol = 1e-6;
  let best: { num: number; den: number; sym: string } | null = null;
  for (const [sym, c] of FRACTION_CONSTANTS) {
    const q = n / c;
    const { num, den } = cfConvergent(Math.abs(q), maxDen);
    if (!den || num === 0) continue;
    const approx = Math.sign(q) * (num / den) * c;
    const err = Math.abs(approx - n) / Math.abs(n);
    if (err < relTol && (!best || den < best.den)) {
      best = { num: Math.sign(q) * num, den, sym };
    }
  }
  return best ? formatConstFraction(best.num, best.den, best.sym) : toFraction(n);
}

function applyCustomPattern(n: number, pattern: string): string {
  const dp = pattern.match(/\.([0#]+)/)?.[1].length ?? 0;
  const useGrouping = pattern.includes(",");
  return n.toLocaleString(APP_LOCALE, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    useGrouping,
  });
}

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
  label: string;
  group: UnitGroup;
  prefix?: boolean;
};

export const UNIT_ANNOTATIONS: UnitAnnotation[] = [
  { id: "none",  label: "",      group: "none" },
  { id: "deg",   label: "°",     group: "angle" },
  { id: "rad",   label: " rad",  group: "angle" },
  { id: "grad",  label: " grad", group: "angle" },
  { id: "m",     label: " m",    group: "length" },
  { id: "km",    label: " km",   group: "length" },
  { id: "cm",    label: " cm",   group: "length" },
  { id: "mm",    label: " mm",   group: "length" },
  { id: "in",    label: "\"",    group: "length" },
  { id: "ft",    label: "'",     group: "length" },
  { id: "mi",    label: " mi",   group: "length" },
  { id: "kg",    label: " kg",   group: "mass" },
  { id: "g",     label: " g",    group: "mass" },
  { id: "mg",    label: " mg",   group: "mass" },
  { id: "lb",    label: " lb",   group: "mass" },
  { id: "oz",    label: " oz",   group: "mass" },
  { id: "degC",  label: " °C",   group: "temperature" },
  { id: "degF",  label: " °F",   group: "temperature" },
  { id: "K",     label: " K",    group: "temperature" },
  { id: "s",     label: " s",    group: "time" },
  { id: "ms",    label: " ms",   group: "time" },
  { id: "min",   label: " min",  group: "time" },
  { id: "hr",    label: " hr",   group: "time" },
  { id: "day",   label: " day",  group: "time" },
  { id: "m2",    label: " m²",   group: "area" },
  { id: "km2",   label: " km²",  group: "area" },
  { id: "ha",    label: " ha",   group: "area" },
  { id: "ft2",   label: " ft²",  group: "area" },
  { id: "ac",    label: " ac",   group: "area" },
  { id: "m3",    label: " m³",   group: "volume" },
  { id: "L",     label: " L",    group: "volume" },
  { id: "mL",    label: " mL",   group: "volume" },
  { id: "gal",   label: " gal",  group: "volume" },
  { id: "ms1",   label: " m/s",  group: "speed" },
  { id: "kmh",   label: " km/h", group: "speed" },
  { id: "mph",   label: " mph",  group: "speed" },
  { id: "b",     label: " B",    group: "data" },
  { id: "kb",    label: " KB",   group: "data" },
  { id: "mb",    label: " MB",   group: "data" },
  { id: "gb",    label: " GB",   group: "data" },
  { id: "tb",    label: " TB",   group: "data" },
  { id: "usd",   label: "$", group: "currency", prefix: true },
  { id: "eur",   label: "€", group: "currency", prefix: true },
  { id: "gbp",   label: "£", group: "currency", prefix: true },
  { id: "jpy",   label: "¥", group: "currency", prefix: true },
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

export interface PackUnit {
  id: string;
  label: string;
  group: string;
  groupLabel?: string;
  prefix?: boolean;
}

export interface PackFormat {
  id: string;
  label: string;
  group?: string;
  apply: (n: number) => string;
}

const _packUnits = new Map<string, UnitAnnotation>();
const _packUnitGroupLabels = new Map<string, string>();
const _packFormats = new Map<string, { label: string; group: string; apply: (n: number) => string }>();

export function registerPackUnits(units: PackUnit[]): void {
  for (const u of units) {
    _packUnits.set(u.id, { id: u.id, label: u.label, group: u.group as UnitGroup, prefix: u.prefix });
    if (u.groupLabel) _packUnitGroupLabels.set(u.group, u.groupLabel);
  }
}

export function registerPackFormats(formats: PackFormat[]): void {
  for (const f of formats) {
    _packFormats.set(f.id, { label: f.label, group: f.group ?? "Pack", apply: f.apply });
  }
}

export function unitGroupLabel(group: string): string {
  return UNIT_GROUP_LABELS[group as UnitGroup] ?? _packUnitGroupLabels.get(group) ?? group;
}

export function packFormatLabel(id: string): string | undefined {
  return _packFormats.get(id)?.label;
}

export function unitById(id: string): UnitAnnotation {
  return UNIT_ANNOTATIONS.find((u) => u.id === id) ?? _packUnits.get(id) ?? UNIT_ANNOTATIONS[0];
}

export function isFcUnit(id: string): boolean {
  return UNIT_ANNOTATIONS.some((u) => u.id === id) || _packUnits.has(id);
}

export function unitsCompatible(a: string, b: string): boolean {
  if (a === "none" || b === "none") return true;
  const ga = unitById(a).group;
  const gb = unitById(b).group;
  if (ga === "custom" || gb === "custom") return true;
  return ga === gb;
}

export type TextCase = "none" | "upper" | "lower" | "proper";

export const TEXT_CASE_LABELS: Record<TextCase, string> = {
  none:   "Aa (as-is)",
  upper:  "UPPER",
  lower:  "lower",
  proper: "Proper",
};

export type TextAlign = "left" | "center" | "right";

export type LogicalStyle = "truefalse" | "binary" | "yesno" | "check";

export const LOGICAL_STYLE_LABELS: Record<LogicalStyle, string> = {
  truefalse: "TRUE / FALSE",
  binary:    "1 / 0",
  yesno:     "Yes / No",
  check:     "✓ / ✗",
};

export type LambdaView = "signature" | "katex" | "syntax" | "mono";

export const LAMBDA_VIEW_LABELS: Record<LambdaView, string> = {
  signature: "λ(params)",
  katex:     "Equation (KaTeX)",
  syntax:    "Highlighted formula",
  mono:      "Monospace formula",
};

export const CHART_FONT_SCALES: number[] = [0.8, 1, 1.25, 1.5, 2];

export function applyLogicalStyle(b: boolean, style?: LogicalStyle): string {
  switch (style) {
    case "binary": return b ? "1" : "0";
    case "yesno":  return b ? "Yes" : "No";
    case "check":  return b ? "✓" : "✗";
    default:       return b ? "TRUE" : "FALSE";
  }
}

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
  unit: string;
  customUnit?: string;
  textCase?: TextCase;
  bold?: boolean;
  italic?: boolean;
  textScale?: number;
  textAlign?: TextAlign;
  textMarkdown?: boolean;
  textMono?: boolean;
  chip?: boolean;
  decimalDigits?: number;
  decimalMode?: DecimalMode;
  logicalStyle?: LogicalStyle;
  lambdaView?: LambdaView;
  chartFontScale?: number;
  grouping?: boolean;
  negativeStyle?: NegativeStyle;
  scaleMode?: ScaleMode;
};

export function annotationRendersNegativeRed(ann: FormatAnnotation | undefined, n: unknown): boolean {
  return !!ann && typeof n === "number" && n < 0 &&
    (ann.negativeStyle === "red" || ann.negativeStyle === "redparen");
}

export function applyTextCase(s: string, c: TextCase | undefined): string {
  switch (c) {
    case "upper": return s.toUpperCase();
    case "lower": return s.toLowerCase();
    case "proper": return s.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\B\w/g, (ch) => ch.toLowerCase());
    default: return s;
  }
}

const _store = new Map<string, FormatAnnotation>();
// Indexed by node because every value box calls getForNode on every render.
const _byNode = new Map<string, Map<string, FormatAnnotation>>();
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
  removeForNode(nodeId: string): void {
    const inner = _byNode.get(nodeId);
    if (!inner) return;
    for (const socketKey of inner.keys()) _store.delete(key(nodeId, socketKey));
    _byNode.delete(nodeId);
    notify();
  },
  clearNodes(): void {
    if (_store.size === 0) return;
    _store.clear();
    _byNode.clear();
    notify();
  },
  subscribe,
  version,
  snapshot(): ReadonlyMap<string, FormatAnnotation> {
    return _store;
  },
};

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

export function formatNumberWithAnnotation(n: number, ann: FormatAnnotation): string {
  if (!Number.isFinite(n)) return String(n);
  if (isDateStyle(ann.format)) {
    return formatDateSerial(n, dateAnnotationPattern(ann) ?? DEFAULT_DATE_FORMAT);
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

export function formatCxWithAnnotation(z: Cx, ann: FormatAnnotation): string {
  const style: FormatStyleId =
    (COMPLEX_FORMAT_STYLES as readonly string[]).includes(ann.format) ? ann.format : "auto";
  const { text, hasBothParts } = assembleCx(z, (n) =>
    style === "auto"
      ? (Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/\.?0+$/, ""))
      : applyFormatStyle(n, style, ann.customPattern, ann.decimalDigits, ann.decimalMode, true),
    true);
  if (text === "NaN") return text;
  const unit = ann.unit === "custom" ? (ann.customUnit ?? "") : unitById(ann.unit).label;
  if (!unit) return text;
  const body = hasBothParts ? `(${text})` : text;
  return ann.unit !== "custom" && unitById(ann.unit).prefix ? `${unit}${body}` : `${body}${unit}`;
}

export function formatWithAnnotation(
  n: number,
  nodeId: string,
  socketKey: string,
): string {
  const ann = formatAnnotationStore.get(nodeId, socketKey);
  if (!ann) return autoFormat(n);
  return formatNumberWithAnnotation(n, ann);
}

registerNodeForget((nodeId) => formatAnnotationStore.removeForNode(nodeId));
registerNodeForgetAll(() => formatAnnotationStore.clearNodes());
