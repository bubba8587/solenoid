// [[D87]] xyColumnMapping, [[C100]] chartIsAValue
import { formatFrameCell, isFrameValue, type FrameColumn } from "../frame";
import { solError, type SolError } from "../errorValue";
import type { ChartOptions, LineStyle } from "./chartOptions";
import type { ChartValue, XYPayload, XYPoint, XYSeries } from "../chartValue";

export type XYOp = "scatter" | "xyline" | "bubble";

export const XY_CHART_OPS: ReadonlySet<string> = new Set<XYOp>(["scatter", "xyline", "bubble"]);

const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

function rangeOf(vals: Iterable<number>): [number, number] | undefined {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo <= hi ? [lo, hi] : undefined;
}

function lineFor(op: XYOp, opts: ChartOptions): LineStyle {
  return opts.linestyle ?? (op === "xyline" ? "solid" : "none");
}

function markerFor(op: XYOp, opts: ChartOptions, seriesCount: number): boolean {
  if (op !== "xyline") return true;
  return opts.marker ?? seriesCount === 1;
}

function withRanges(series: XYSeries[]): XYSeries[] {
  const pts = series.flatMap((s) => s.points.filter((p): p is XYPoint => p !== null));
  const sRange = rangeOf(pts.flatMap((p) => (p.s === undefined ? [] : [p.s])));
  const cRange = rangeOf(pts.flatMap((p) => (typeof p.c === "number" ? [p.c] : [])));
  const cats = [...new Set(pts.flatMap((p) => (typeof p.c === "string" ? [p.c] : [])))];
  return series.map((s) => ({
    ...s,
    ...(sRange ? { sRange } : {}),
    ...(cRange ? { cRange } : {}),
    ...(cats.length ? { cCats: cats } : {}),
  }));
}

/** A plain list plots at x = 1, 2, 3, …; a number is one point at x = 1. */
function listXY(op: XYOp, raw: unknown, opts: ChartOptions): XYPayload | null {
  const ys = Array.isArray(raw) ? raw : typeof raw === "number" ? [raw] : null;
  if (!ys) return null;
  const points = ys.map((v, i) => { const y = num(v); return y === null ? null : { x: i + 1, y }; });
  return { kind: "xy", names: {}, series: [{ name: "", points, line: lineFor(op, opts), marker: markerFor(op, opts, 1) }] };
}

/**
 * Reads a frame, a list or a number into XY series, the columns picked by the options' `x`, `y`, `s`, `c`,
 * `annotate` and `by` names. A named column the frame lacks is `#REF!`; a text column named for a number role is
 * `#TYPE!`. Null means nothing to plot.
 */
export function buildXY(op: XYOp, raw: unknown, opts: ChartOptions): XYPayload | SolError | null {
  if (!isFrameValue(raw)) return listXY(op, raw, opts);
  const cols = raw.columns;
  if (cols.length === 0) return null;
  const find = (name: string, role: string): FrameColumn | SolError => {
    const key = name.trim().toLowerCase();
    return cols.find((c) => c.name.trim().toLowerCase() === key)
      ?? solError("#REF!", `The options name a ${role} column "${name}", which the data doesn't have`);
  };
  const named = (name: string | undefined, role: string): FrameColumn | SolError | undefined =>
    name === undefined ? undefined : find(name, role);
  const xNamed = named(opts.x, "x");
  const sNamed = named(opts.s, "size");
  const cNamed = named(opts.c, "color");
  const tNamed = named(opts.annotate, "annotate");
  const byNamed = named(opts.by, "by");
  const yNamed = opts.y?.map((n) => find(n, "y"));
  for (const r of [xNamed, sNamed, cNamed, tNamed, byNamed, ...(yNamed ?? [])]) if (r && "code" in r) return r;
  const col = (r: FrameColumn | SolError | undefined) => r as FrameColumn | undefined;
  const taken = new Set<FrameColumn>(
    [col(xNamed), col(sNamed), col(cNamed), col(tNamed), col(byNamed), ...((yNamed ?? []) as FrameColumn[])]
      .filter((c): c is FrameColumn => !!c),
  );
  const pool = cols.filter((c) => c.type === "number" && !taken.has(c));
  const take = () => { const c = pool.shift(); if (c) taken.add(c); return c; };

  let xCol = col(xNamed);
  if (!xCol) {
    if (op === "bubble") xCol = take();
    else if (cols.length >= 2) {
      xCol = cols.find((c) => !taken.has(c));
      if (xCol) {
        taken.add(xCol);
        const k = pool.indexOf(xCol);
        if (k >= 0) pool.splice(k, 1);
      }
    }
  }
  let yCols: FrameColumn[] = (yNamed ?? []) as FrameColumn[];
  if (!yNamed) {
    if (op === "bubble") { const y = take(); yCols = y ? [y] : []; }
    else yCols = pool.splice(0);
  }
  let sCol = col(sNamed);
  if (!sCol && op === "bubble") sCol = take();
  const cCol = col(cNamed), tCol = col(tNamed), byCol = col(byNamed);
  if (op === "bubble" && !yNamed && yCols.length === 0 && xCol) yCols = [xCol];

  for (const [c, role] of [...yCols.map((c) => [c, "y"] as const), [sCol, "size"] as const]) {
    if (c && c.type !== "number") return solError("#TYPE!", `Column "${c.name}" is the ${role} column but holds ${c.type}, not numbers`);
  }
  if (yCols.length === 0) return null;

  const rows = Math.max(...cols.map((c) => c.values.length));
  const text = (c: FrameColumn, r: number): string | null => {
    const f = formatFrameCell(c.type, c.values[r] ?? null, c.format);
    return f === null ? null : String(f);
  };
  let xcats: string[] | undefined;
  const xAt: (r: number) => number | null = !xCol
    ? (r) => r + 1
    : xCol.type === "number"
      ? (r) => num(xCol!.values[r])
      : (() => {
        const cats: string[] = [];
        const idx = new Map<string, number>();
        const out = Array.from({ length: rows }, (_, r) => {
          const t = text(xCol!, r);
          if (t === null) return null;
          if (!idx.has(t)) { idx.set(t, cats.length); cats.push(t); }
          return idx.get(t)!;
        });
        xcats = cats;
        return (r: number) => out[r];
      })();
  const cAt = (r: number): number | string | undefined => {
    if (!cCol) return undefined;
    if (cCol.type === "number") return num(cCol.values[r]) ?? undefined;
    return text(cCol, r) ?? undefined;
  };

  const groups: { key: string | null; rows: number[] }[] = [];
  if (byCol) {
    const at = new Map<string, number[]>();
    for (let r = 0; r < rows; r++) {
      const k = text(byCol, r) ?? "—";
      if (!at.has(k)) { at.set(k, []); groups.push({ key: k, rows: at.get(k)! }); }
      at.get(k)!.push(r);
    }
  } else {
    groups.push({ key: null, rows: Array.from({ length: rows }, (_, r) => r) });
  }

  const series: XYSeries[] = [];
  for (const y of yCols) {
    for (const g of groups) {
      const points = g.rows.map((r): XYPoint | null => {
        const xv = xAt(r), yv = num(y.values[r]);
        if (xv === null || yv === null) return null;
        const p: XYPoint = { x: xv, y: yv };
        const sv = sCol ? num(sCol.values[r]) : null;
        if (sv !== null) p.s = sv;
        const cv = cAt(r);
        if (cv !== undefined) p.c = cv;
        const tv = tCol ? text(tCol, r) : null;
        if (tv !== null && tv !== "") p.text = tv;
        return p;
      });
      const name = g.key === null ? y.name : yCols.length > 1 ? `${y.name} · ${g.key}` : g.key;
      series.push({ name, points, line: lineFor(op, opts), marker: true });
    }
  }
  const marker = markerFor(op, opts, series.length);
  return {
    kind: "xy",
    series: withRanges(series.map((s) => ({ ...s, marker }))),
    ...(xcats ? { xcats } : {}),
    names: {
      ...(xCol ? { x: xCol.name } : {}),
      ...(yCols.length === 1 ? { y: yCols[0].name } : {}),
      ...(sCol ? { s: sCol.name } : {}),
      ...(cCol ? { c: cCol.name } : {}),
      ...(tCol ? { text: tCol.name } : {}),
    },
  };
}

/** One Merge Plots source as XY series on a shared numeric plane, its own options baked in as each series' style. */
export function sourceAsXY(cv: ChartValue, plotNo: number): { series: XYSeries[]; xcats?: string[] } | SolError {
  const o = cv.options ?? {};
  const style = (many: boolean) => ({
    ...(o.color && !many ? { color: o.color } : {}),
    ...(o.markersize !== undefined ? { markersize: o.markersize } : {}),
    ...(o.linewidth !== undefined ? { linewidth: o.linewidth } : {}),
    ...(o.alpha !== undefined ? { alpha: o.alpha } : {}),
  });
  if (cv.payload?.kind === "xy") {
    const many = cv.payload.series.length > 1;
    const st = style(many);
    return {
      series: cv.payload.series.map((s) => ({ ...s, ...st, name: (many ? s.name : cv.title || s.name) ?? "" })),
      xcats: cv.payload.xcats,
    };
  }
  if (cv.op === "column" || cv.op === "bar") {
    return solError("#TYPE!", `Plot ${plotNo} is a ${cv.op} chart; bars can't share an x/y plane with a scatter or XY line`);
  }
  const labels = cv.labels;
  if (labels && labels.length > 0 && !labels.every((l) => typeof l === "number" && Number.isFinite(l))) {
    return solError("#TYPE!", `Plot ${plotNo} plots against text labels, so it can't share an x/y plane with a scatter or XY line`);
  }
  const xAt = (i: number) => (labels && labels.length > 0 ? (labels[i] as number) : i + 1);
  const toPoints = (vals: (number | null)[]) => vals.map((v, i) => { const y = num(v); return y === null ? null : { x: xAt(i), y }; });
  const raw = cv.series && cv.series.length > 0
    ? cv.series.map((s) => ({ name: s.name, values: s.values }))
    : Array.isArray(cv.values) ? [{ name: cv.title ?? "", values: cv.values }]
      : typeof cv.values === "number" ? [{ name: cv.title ?? "", values: [cv.values] }] : [];
  const st = style(raw.length > 1);
  return {
    series: raw.map((s) => ({ name: s.name, points: toPoints(s.values), line: "solid" as const, marker: o.marker ?? false, ...st })),
  };
}
