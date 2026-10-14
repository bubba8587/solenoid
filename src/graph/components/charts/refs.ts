// [[C100]] chartIsAValue
// A figure's References as TanStack marks: the rows `readChartRefs` read, drawn as rules, rects, dots and labels.
import { dot, rect, ruleX, ruleY, text } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { refShape } from "../chartCore";
import type { ChartRef } from "../../chartValue";
import { formatFrameCell } from "../../frame";
import { PALETTE, resolveColor } from "../../palette";

const VSPAN_ALPHA = 0.16;
const DASH = "4 3";

type RefMark = ReturnType<typeof decorative>;

/** An annotation color: a palette slot name follows the theme, anything else is taken as CSS. */
export function markColor(c: string | undefined, fallback: string): string {
  if (!c) return fallback;
  return c in PALETTE ? resolveColor(c) : c;
}

/** Where a category axis puts a reference's x: the index of the label it names (a date serial matches its formatted
 *  label), or with no labels its 1-based position; null when it names no category. */
export function categoryAt(labels: readonly (string | number)[] | undefined) {
  return (v: number | string): number | null => {
    if (!labels) return typeof v === "number" && Number.isInteger(v) ? v - 1 : null;
    const idx = labels.findIndex((l) => l === v || String(l) === String(v)
      || (typeof v === "number" && typeof l === "string" && l === formatFrameCell("date", v)));
    return idx >= 0 ? idx : null;
  };
}

/** A category position moved to the nearest row a thinned series kept, so a reference never lands on a dropped row. */
export function snapAt(at: (v: number | string) => number | null, kept: readonly number[] | null) {
  if (!kept?.length) return at;
  return (v: number | string): number | null => {
    const i = at(v);
    if (i === null) return null;
    let lo = 0, hi = kept.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (kept[mid] < i) lo = mid + 1; else hi = mid; }
    return lo > 0 && i - kept[lo - 1] < kept[lo] - i ? kept[lo - 1] : kept[lo];
  };
}

type VLinePlace = { row: number; flip: boolean };

/** Each labelled line's label place: right of the line, or left of it when the right would run past the plot or across
 *  another line and the left would not, in the first row where it clears the labels already placed. */
export function vlinePlaces(lines: readonly { x: number; label?: string }[], xLo: number, xHi: number, pw: number, fs: number): VLinePlace[] {
  const pxPerX = xHi > xLo ? pw / (xHi - xLo) : 0;
  const taken: [number, number][][] = [];
  const places: VLinePlace[] = lines.map(() => ({ row: 0, flip: false }));
  [...lines.keys()].sort((a, b) => lines[a].x - lines[b].x).forEach((k) => {
    const label = lines[k].label;
    if (!label) return;
    const at = (lines[k].x - xLo) * pxPerX;
    const w = 6 + label.length * 5.2 * fs;
    const others = lines.filter((_, o) => o !== k).map((l) => (l.x - xLo) * pxPerX);
    const clear = (a: number, b: number) => a >= 0 && b <= pw && others.every((o) => o <= a || o >= b);
    const flip = !clear(at, at + w) && (clear(at - w, at) || (at + w > pw && at - w >= 0));
    const span: [number, number] = flip ? [at - w, at] : [at, at + w];
    let r = taken.findIndex((row) => row.every(([a, b]) => span[1] <= a || span[0] >= b));
    if (r < 0) { r = taken.length; taken.push([]); }
    taken[r].push(span);
    places[k] = { row: r, flip };
  });
  return places;
}

export type RefContext = {
  axis: string; fs: number;
  /** The x (category or number) axis's ends and the value axis's ends, in axis values. */
  x: [number, number]; y: [number, number];
  /** The plot's width in pixels, for placing vertical lines' labels. */
  pw: number;
  /** A horizontal Bar: categories run down the y axis. */
  swap?: boolean;
};

/**
 * A figure's references as marks: `under` (areas) goes before the data, `over` (lines, points, labels) after. `at` maps
 * an x to the axis's own value, or null when it isn't on the axis (the row draws nothing). A value past the axis's ends
 * draws nothing; an area is clipped to them, and an end it leaves blank runs to the plot's edge.
 */
export function refMarks(refs: readonly ChartRef[] | undefined, at: (v: number | string) => number | null, ctx: RefContext): { under: RefMark[]; over: RefMark[] } {
  const under: RefMark[] = [], over: RefMark[] = [];
  if (!refs?.length) return { under, over };
  const { axis, fs, swap } = ctx;
  const [x0, x1] = ctx.x[0] <= ctx.x[1] ? ctx.x : [ctx.x[1], ctx.x[0]];
  const [y0, y1] = ctx.y[0] <= ctx.y[1] ? ctx.y : [ctx.y[1], ctx.y[0]];
  const inX = (v: number) => v >= x0 && v <= x1, inY = (v: number) => v >= y0 && v <= y1;
  // On a horizontal Bar the categories are the y channel and the values the x channel.
  const pos = (x: number, y: number) => (swap ? { x: y, y: x } : { x, y });
  const font = 9 * fs;
  const vlines: { x: number; label?: string; color: string }[] = [];
  refs.forEach((r) => {
    const x = r.x === undefined ? undefined : at(r.x), x2 = r.x2 === undefined ? undefined : at(r.x2);
    if (x === null || x2 === null) return;
    const color = markColor(r.color, axis);
    const shape = refShape(r);
    if (shape === "area") {
      const xa = Math.max(x0, Math.min(x ?? x0, x2 ?? x0)), xb = Math.min(x1, Math.max(x ?? x1, x2 ?? x1));
      const ys = [r.y, r.y2].filter((v): v is number => v !== undefined);
      const ya = Math.max(y0, ys.length === 2 ? Math.min(...ys) : r.y2 === undefined ? (r.y ?? y0) : y0);
      const yb = Math.min(y1, ys.length === 2 ? Math.max(...ys) : r.y === undefined ? (r.y2 ?? y1) : y1);
      if (xa > xb || ya > yb) return;
      const box = swap ? { x1: ya, x2: yb, y1: xa, y2: xb } : { x1: xa, x2: xb, y1: ya, y2: yb };
      under.push(decorative(rect([box], { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: color, fillOpacity: VSPAN_ALPHA, inset: 0 })));
    } else if (shape === "point") {
      if (!inX(x!) || !inY(r.y!)) return;
      const p = pos(x!, r.y!);
      over.push(decorative(dot([p], { x: "x", y: "y", r: 3, fill: color })));
      if (r.label) over.push(decorative(text([{ ...p, t: r.label }], { x: "x", y: "y", text: "t", dy: -8, fill: color, fontSize: font })));
    } else if (shape === "vline") {
      if (inX(x!)) vlines.push({ x: x!, label: r.label, color });
    } else if (shape === "hline") {
      if (!inY(r.y!)) return;
      over.push(decorative(swap
        ? ruleX([r.y!], { stroke: color, strokeOpacity: 1, strokeWidth: 1, strokeDasharray: DASH })
        : ruleY([r.y!], { stroke: color, strokeOpacity: 1, strokeWidth: 1, strokeDasharray: DASH })));
      if (r.label) {
        const p = swap ? { x: r.y!, y: x0, t: r.label } : { x: x0, y: r.y!, t: r.label };
        over.push(decorative(text([p], { x: "x", y: "y", text: "t", anchor: "start", dx: 3, dy: -4, fill: color, fontSize: font })));
      }
    }
  });
  const places = vlinePlaces(vlines, x0, x1, ctx.pw, fs);
  vlines.forEach((l, k) => {
    over.push(decorative(swap
      ? ruleY([l.x], { stroke: l.color, strokeOpacity: 1, strokeWidth: 1, strokeDasharray: DASH })
      : ruleX([l.x], { stroke: l.color, strokeOpacity: 1, strokeWidth: 1, strokeDasharray: DASH })));
    if (!l.label) return;
    if (swap) {
      over.push(decorative(text([{ x: y1, y: l.x, t: l.label }], { x: "x", y: "y", text: "t", anchor: "end", dx: -3, dy: -4, fill: l.color, fontSize: font })));
      return;
    }
    const { row, flip } = places[k];
    over.push(decorative(text([{ x: l.x, y: y1, t: l.label }], {
      x: "x", y: "y", text: "t", anchor: flip ? "end" : "start", dx: flip ? -3 : 3, dy: (row + 0.5) * 11 * fs + 2, fill: l.color, fontSize: font,
    })));
  });
  return { under, over };
}
