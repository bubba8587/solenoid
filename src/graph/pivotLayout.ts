// [[C127]] pivotView
import { isSolError } from "./errorValue";
import { frameRowCount, type FrameCell, type FrameColType, type FrameValue } from "./frame";
import type { AggOp } from "./frameVerbs";

export type PivotItemKind = "leaf" | "sub" | "grand";

/** One place on an axis: a leaf's whole tuple, a subtotal's prefix (`fill` long), or the grand total. */
export interface PivotAxisItem { kind: PivotItemKind; tuple: FrameCell[]; fill: number }

/** How PIVOTBY laid its Frame out: one row item per output row, one column item per value column after the row keys. */
export interface PivotLayout {
  rowFields: string[];
  rowTypes: FrameColType[];
  colFields: string[];
  colTypes: FrameColType[];
  values: string[];
  funcs: AggOp[];
  rows: PivotAxisItem[];
  cols: (PivotAxisItem & { value: number })[];
}

const layouts = new WeakMap<FrameValue, PivotLayout>();

export function setPivotLayout(f: FrameValue, layout: PivotLayout): void {
  layouts.set(f, layout);
}

/** The layout a frame was pivoted with, or null once it no longer has that shape. */
export function pivotLayoutOf(f: FrameValue): PivotLayout | null {
  const l = layouts.get(f);
  if (!l) return null;
  if (l.rows.length !== frameRowCount(f) || l.rowFields.length + l.cols.length !== f.columns.length) return null;
  return l;
}

/** A copy of a pivoted frame (a format stamp) keeps its layout. */
export function carryPivotLayout(from: FrameValue, to: FrameValue): void {
  const l = layouts.get(from);
  if (l && from !== to) layouts.set(to, l);
}

export type PivotForm = "compact" | "outline" | "tabular";
export type PivotEmpty = "blank" | "zero" | "dash";

export interface PivotViewOptions {
  form: PivotForm;
  repeatLabels: boolean;
  blankRows: boolean;
  bandedRows: boolean;
  bandedCols: boolean;
  fieldHeaders: boolean;
  emptyAs: PivotEmpty;
  collapsed: string[];
}

export const DEFAULT_PIVOT_VIEW: PivotViewOptions = {
  form: "compact", repeatLabels: false, blankRows: false, bandedRows: false, bandedCols: false,
  fieldHeaders: true, emptyAs: "blank", collapsed: [],
};

const FORMS: readonly PivotForm[] = ["compact", "outline", "tabular"];
const EMPTIES: readonly PivotEmpty[] = ["blank", "zero", "dash"];

/** A saved view read back whole: anything missing or unknown takes its default. */
export function readPivotView(raw: unknown): PivotViewOptions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof PivotViewOptions) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_PIVOT_VIEW[k] as boolean));
  return {
    form: FORMS.includes(r.form as PivotForm) ? (r.form as PivotForm) : DEFAULT_PIVOT_VIEW.form,
    repeatLabels: bool("repeatLabels"),
    blankRows: bool("blankRows"),
    bandedRows: bool("bandedRows"),
    bandedCols: bool("bandedCols"),
    fieldHeaders: bool("fieldHeaders"),
    emptyAs: EMPTIES.includes(r.emptyAs as PivotEmpty) ? (r.emptyAs as PivotEmpty) : DEFAULT_PIVOT_VIEW.emptyAs,
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((k): k is string => typeof k === "string") : [],
  };
}

/** Only what differs from the defaults is saved; a view left at its defaults saves nothing. */
export function savedPivotView(v: PivotViewOptions): Partial<PivotViewOptions> | undefined {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_PIVOT_VIEW) as (keyof PivotViewOptions)[]) {
    if (k === "collapsed") { if (v.collapsed.length) out.collapsed = [...v.collapsed]; continue; }
    if (v[k] !== DEFAULT_PIVOT_VIEW[k]) out[k] = v[k];
  }
  return Object.keys(out).length ? (out as Partial<PivotViewOptions>) : undefined;
}

const FUNC_CAPTION: Record<AggOp, string> = {
  sum: "Sum", avg: "Average", min: "Min", max: "Max", count: "Count", product: "Product",
  median: "Median", mode: "Mode", stdev: "StdDev", stdevp: "StdDevp", var: "Var", varp: "Varp",
  percentof: "Share",
};

/** Excel's value field caption: "Sum of Revenue". */
export function valueCaption(layout: PivotLayout, v: number): string {
  return `${FUNC_CAPTION[layout.funcs[v]] ?? "Sum"} of ${layout.values[v]}`;
}

/** The key a group is folded under: its prefix of the row tuple. */
export function groupKey(prefix: readonly FrameCell[]): string {
  return JSON.stringify(prefix.map((c) => (isSolError(c) ? { e: c.code } : c)));
}

export interface PivotLabel { text: string; total?: boolean }

export interface PivotBodyRow {
  kind: "header" | "leaf" | "sub" | "grand" | "blank";
  /** The row-field depth of the row's own label: the compact form's indent. */
  level: number;
  /** One per label column: one in Compact, one per row field otherwise. */
  labels: (PivotLabel | null)[];
  /** The frame row whose values the row shows, or null for empty value cells. */
  src: number | null;
  /** Fold buttons, each beside the label in its `col`. */
  folds?: { key: string; collapsed: boolean; col: number }[];
  /** Leaf-row parity, for banding. */
  band?: number;
  /** The label texts from the outermost field down to this row's own. */
  path: string[];
}

export interface PivotHeadCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  /** The body column the cell starts at, or -1 for the label corner. */
  col: number;
  role: "corner" | "field" | "item" | "total" | "value" | "caption";
}

export interface PivotModel {
  labelCols: number;
  head: PivotHeadCell[][];
  body: PivotBodyRow[];
  /** Whether any group can fold: there is a subtotal to show in its place. */
  foldable: boolean;
}

type CellText = (field: number, cell: FrameCell) => string;

/** The pivot table drawn from a layout and the view's options; values stay addressed by frame row and column. */
export function buildPivotModel(layout: PivotLayout, opts: PivotViewOptions, rowText: CellText, colText: CellText): PivotModel {
  const n = layout.rowFields.length;
  const compact = opts.form === "compact";
  const labelCols = n === 0 ? 0 : compact ? 1 : n;
  const collapsed = new Set(opts.collapsed);

  // Each subtotal row by its group, and whether it comes before the group's leaves.
  const subOf = new Map<string, { row: number; top: boolean }>();
  const seenLeaf = new Set<string>();
  layout.rows.forEach((it, i) => {
    if (it.kind === "leaf") for (let p = 1; p < n; p++) seenLeaf.add(groupKey(it.tuple.slice(0, p)));
    else if (it.kind === "sub") {
      const k = groupKey(it.tuple.slice(0, it.fill));
      subOf.set(k, { row: i, top: !seenLeaf.has(k) });
    }
  });
  const foldable = n >= 2 && subOf.size > 0;
  const canFold = (k: string) => foldable && subOf.has(k);
  const isFolded = (k: string) => canFold(k) && collapsed.has(k);
  /** The shallowest folded group holding this prefix, as its level, or -1. */
  const foldedAbove = (t: readonly FrameCell[], upto: number): number => {
    for (let p = 0; p < upto; p++) if (isFolded(groupKey(t.slice(0, p + 1)))) return p;
    return -1;
  };

  const labelCells = (): (PivotLabel | null)[] => Array.from({ length: labelCols }, () => null);
  const put = (labels: (PivotLabel | null)[], level: number, label: PivotLabel) => { labels[compact ? 0 : level] = label; };
  const body: PivotBodyRow[] = [];
  const pathOf = (t: readonly FrameCell[], len: number) => Array.from({ length: len }, (_, l) => rowText(l, t[l] ?? null));
  let band = 0;
  let prevLeaf: FrameCell[] | null = null;
  // Blank Rows: a blank line wherever an outer group ends, compared over the prefix both rows carry.
  let lastOuter: readonly FrameCell[] | null = null;
  const blank = () => body.push({ kind: "blank", level: 0, labels: labelCells(), src: null, path: [] });
  const enterTop = (t: readonly FrameCell[]) => {
    if (!opts.blankRows || n < 2) return;
    const outer = t.slice(0, n - 1);
    const len = Math.min(outer.length, lastOuter?.length ?? 0);
    if (lastOuter && groupKey(outer.slice(0, len)) !== groupKey(lastOuter.slice(0, len))) blank();
    lastOuter = outer;
  };

  layout.rows.forEach((it, i) => {
    if (it.kind === "grand") {
      if (opts.blankRows && n >= 2 && lastOuter) blank();
      lastOuter = null;
      const labels = labelCells();
      if (labelCols) labels[0] = { text: "Grand Total", total: true };
      body.push({ kind: "grand", level: 0, labels, src: i, path: [] });
      return;
    }
    if (it.kind === "sub") {
      const p = it.fill;
      const k = groupKey(it.tuple.slice(0, p));
      if (foldedAbove(it.tuple, p) >= 0) return;
      const top = subOf.get(k)?.top;
      if (top && !compact && opts.form === "tabular") {
        enterTop(it.tuple);
      } else if (top) return; // Compact and Outline draw it on the group's own row.
      const labels = labelCells();
      if (opts.repeatLabels && !compact) for (let l = 0; l < p - 1; l++) labels[l] = { text: rowText(l, it.tuple[l] ?? null) };
      put(labels, p - 1, { text: `${rowText(p - 1, it.tuple[p - 1] ?? null)} Total`, total: true });
      body.push({ kind: "sub", level: p - 1, labels, src: i, path: pathOf(it.tuple, p) });
      return;
    }
    // A leaf: open the groups it starts, then the leaf itself unless a fold hides it.
    const t = it.tuple;
    let d = 0;
    if (prevLeaf) while (d < n && groupKey([prevLeaf[d]]) === groupKey([t[d]])) d++;
    prevLeaf = t;
    if (d === n && n > 0) d = n - 1;
    enterTop(t);
    for (let level = d; level < n - 1; level++) {
      if (foldedAbove(t, level) >= 0) return;
      const k = groupKey(t.slice(0, level + 1));
      const folded = isFolded(k);
      const sub = subOf.get(k);
      if (compact || opts.form === "outline" || folded) {
        const labels = labelCells();
        if (!compact && (opts.repeatLabels || opts.form === "tabular")) {
          for (let l = 0; l < level; l++) labels[l] = { text: rowText(l, t[l] ?? null) };
        }
        put(labels, level, { text: rowText(level, t[level] ?? null) });
        body.push({
          kind: "header", level, labels,
          src: sub && (sub.top || folded) ? sub.row : null,
          ...(canFold(k) ? { folds: [{ key: k, collapsed: folded, col: compact ? 0 : level }] } : {}),
          band: band++,
          path: pathOf(t, level + 1),
        });
      }
      if (folded) return;
    }
    if (foldedAbove(t, n - 1) >= 0) return;
    const labels = labelCells();
    if (labelCols) {
      if (compact) labels[0] = { text: n ? rowText(n - 1, t[n - 1] ?? null) : "" };
      else {
        for (let l = 0; l < n; l++) {
          const shown = l === n - 1 || opts.repeatLabels || (opts.form === "tabular" && l >= d && !isFolded(groupKey(t.slice(0, l + 1))));
          if (shown) labels[l] = { text: rowText(l, t[l] ?? null) };
        }
      }
    }
    // Tabular puts each group's fold on the group's first leaf row.
    const folds = opts.form !== "tabular" ? [] : Array.from({ length: Math.max(0, n - 1 - d) }, (_, x) => d + x)
      .filter((l) => canFold(groupKey(t.slice(0, l + 1))))
      .map((l) => ({ key: groupKey(t.slice(0, l + 1)), collapsed: false, col: l }));
    body.push({ kind: "leaf", level: Math.max(0, n - 1), labels, src: i, ...(folds.length ? { folds } : {}), band: band++, path: pathOf(t, n) });
  });

  return { labelCols, head: buildHead(layout, opts, labelCols, colText), body, foldable };
}

function buildHead(layout: PivotLayout, opts: PivotViewOptions, labelCols: number, colText: CellText): PivotHeadCell[][] {
  const L = layout.colFields.length;
  const V = layout.values.length;
  const cols = layout.cols;
  const caption = opts.fieldHeaders && L > 0;
  const valueRow = V > 1 || L === 0;
  const levelRows = L;
  const H = (caption ? 1 : 0) + levelRows + (valueRow ? 1 : 0);
  const head: PivotHeadCell[][] = Array.from({ length: H }, () => []);
  const firstLevelRow = caption ? 1 : 0;

  // The corner: the value caption above, the row field names on the last header row.
  if (labelCols > 0) {
    if (H > 1) head[0].push({ text: V === 1 && L > 0 ? valueCaption(layout, 0) : "", colSpan: labelCols, rowSpan: H - 1, col: -1, role: "corner" });
    const last = head[H - 1];
    if (opts.form === "compact") {
      last.push({ text: opts.fieldHeaders ? layout.rowFields.join(" / ") : "", colSpan: 1, rowSpan: 1, col: -1, role: "field" });
    } else {
      layout.rowFields.forEach((f) => last.push({ text: opts.fieldHeaders ? f : "", colSpan: 1, rowSpan: 1, col: -1, role: "field" }));
    }
  }
  if (caption) head[0].push({ text: layout.colFields.join(" / "), colSpan: cols.length, rowSpan: 1, col: 0, role: "caption" });

  // Item rows: a run of columns sharing a path merges; a total spans down to the value row.
  for (let lvl = 0; lvl < levelRows; lvl++) {
    const row = head[firstLevelRow + lvl];
    let j = 0;
    while (j < cols.length) {
      const it = cols[j];
      const covered = (it.kind === "grand" && lvl > 0) || (it.kind === "sub" && lvl > it.fill);
      if (covered) { j++; continue; }
      const isTotal = it.kind === "grand" || (it.kind === "sub" && lvl === it.fill);
      const text = it.kind === "grand" ? "Grand Total"
        : isTotal ? `${colText(lvl - 1, it.tuple[lvl - 1] ?? null)} Total`
        : colText(lvl, it.tuple[lvl] ?? null);
      const path = isTotal ? `T${it.kind}${groupKey(it.tuple.slice(0, lvl))}` : `I${groupKey(it.tuple.slice(0, lvl + 1))}`;
      const pathAt = (k: number) => {
        const o = cols[k];
        const oTotal = o.kind === "grand" || (o.kind === "sub" && lvl === o.fill);
        const oCovered = (o.kind === "grand" && lvl > 0) || (o.kind === "sub" && lvl > o.fill);
        if (oCovered) return null;
        return oTotal ? `T${o.kind}${groupKey(o.tuple.slice(0, lvl))}` : `I${groupKey(o.tuple.slice(0, lvl + 1))}`;
      };
      let k = j + 1;
      while (k < cols.length && pathAt(k) === path) k++;
      row.push({ text, colSpan: k - j, rowSpan: isTotal ? levelRows - lvl : 1, col: j, role: isTotal ? "total" : "item" });
      j = k;
    }
  }
  if (valueRow) {
    const row = head[H - 1];
    cols.forEach((it, j) => row.push({ text: valueCaption(layout, it.value), colSpan: 1, rowSpan: 1, col: j, role: "value" }));
  }
  return head;
}

/** The rows whose labels hold every word, with the group rows above them; the grand total always stays. */
export function filterPivotBody(body: readonly PivotBodyRow[], query: string): PivotBodyRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...body];
  const headerAt = new Map<string, number>();
  body.forEach((r, i) => { if (r.kind === "header") headerAt.set(JSON.stringify(r.path), i); });
  const keep = body.map((r) => r.kind === "grand" || (r.kind !== "blank" && words.every((w) => r.path.join(" ").toLowerCase().includes(w))));
  body.forEach((r, i) => {
    if (!keep[i] || r.kind === "grand") return;
    for (let l = 1; l < r.path.length; l++) {
      const h = headerAt.get(JSON.stringify(r.path.slice(0, l)));
      if (h !== undefined) keep[h] = true;
    }
  });
  return body.filter((_, i) => keep[i]);
}

/** The folded groups that still exist: a field change leaves keys behind that fold nothing. */
export function livePivotFolds(layout: PivotLayout, collapsed: readonly string[]): string[] {
  if (!collapsed.length) return [];
  const live = new Set(layout.rows.filter((it) => it.kind === "sub").map((it) => groupKey(it.tuple.slice(0, it.fill))));
  return collapsed.filter((k) => live.has(k));
}

/** The empty-cell text the view's option asks for. */
export function emptyText(e: PivotEmpty): string {
  return e === "zero" ? "0" : e === "dash" ? "–" : "";
}

export type SubtotalMode = "none" | "bottom" | "top";
/** Excel's words: "rows" totals each row (a Grand Total column), "cols" each column (a Grand Total row). */
export type GrandMode = "off" | "both" | "rows" | "cols";

export interface PivotTotals { rowTotalDepth: number; colTotalDepth: number }

/** The ribbon's reading of PIVOTBY's two total depths. */
export function totalsModes(t: PivotTotals): { sub: SubtotalMode; grand: GrandMode } {
  const subDepth = Math.abs(t.rowTotalDepth) >= 2 ? t.rowTotalDepth : Math.abs(t.colTotalDepth) >= 2 ? t.colTotalDepth : 0;
  const sub: SubtotalMode = subDepth === 0 ? "none" : subDepth < 0 ? "top" : "bottom";
  const gRow = t.rowTotalDepth !== 0, gCol = t.colTotalDepth !== 0;
  return { sub, grand: gRow && gCol ? "both" : gCol ? "rows" : gRow ? "cols" : "off" };
}

/** Subtotals for every outer field of an axis with two or more, as Excel's do; PIVOTBY draws them only beside a grand total, so turning them on turns that on too. */
export function withSubtotals(t: PivotTotals, mode: SubtotalMode, rowFields: number, colFields: number): PivotTotals {
  const axis = (d: number, fields: number): number => {
    const sign = mode === "top" ? -1 : 1;
    if (mode === "none") return Math.sign(d) * Math.min(1, Math.abs(d));
    if (fields >= 2) return sign * fields;
    return d === 0 ? 0 : sign * Math.abs(d);
  };
  return { rowTotalDepth: axis(t.rowTotalDepth, rowFields), colTotalDepth: axis(t.colTotalDepth, colFields) };
}

/** Grand totals per axis; turning one off drops that axis's subtotals with it. */
export function withGrand(t: PivotTotals, mode: GrandMode): PivotTotals {
  const { sub } = totalsModes(t);
  const sign = sub === "top" ? -1 : 1;
  const axis = (d: number, on: boolean) => (!on ? 0 : d !== 0 ? d : sign);
  return {
    rowTotalDepth: axis(t.rowTotalDepth, mode === "both" || mode === "cols"),
    colTotalDepth: axis(t.colTotalDepth, mode === "both" || mode === "rows"),
  };
}
