// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
import { useId, useMemo } from "react";
import { defineChart, rect, text, type ChartGradient, type ChartPoint } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { canvasChartRenderer } from "@tanstack/charts/canvas";
import { decorative } from "@tanstack/charts/mark/decorative";
import { whenFocused } from "@tanstack/charts/focus/mark";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { colord } from "colord";
import { tip, useForExport, Fig, useInk, EmptyFigure, rgbCss, heatColorFn, measureFont, measureText, fitLabel, type Rgb } from "./kit";
import { compactTick, useAppFaces } from "../chartCore";
import { formatScalar } from "../format";
import { heatmapLayout, heatRowY, calendarLayout, calCellXY, type CalLayout } from "../heatmapLayout";
import { heatScale, type HeatScale } from "../../colormaps";
import { formatNumberSpec } from "../../numberSpec";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../../nodes/dateSerial";
import { serialToJsDate } from "../../nodes/date";
import type { ChartOptions } from "../../nodes/chartOptions";
import type { CalHeatPayload, HeatmapPayload } from "../../chartValue";

// Past this many cells the cell mark paints on a canvas; an export still draws SVG.
const CANVAS_CELLS = 2500;
const ANNOT_ID = "sol-heat-annot";
const ANNOT_CSS = `.ts-chart [data-ts-key*="${ANNOT_ID}"] text { font-family: var(--font-mono); }`;

const inkOn = ([r, g, b]: Rgb) => ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#1a1a1a" : "#ffffff");


const scaleTicks = (s: HeatScale) => [s.hi, ...(s.center !== undefined && s.center > s.lo && s.center < s.hi ? [s.center] : []), s.lo];
const annotText = (v: number, fmt: string | undefined) => (fmt ? formatNumberSpec(v, fmt) : null) ?? compactTick(v);




// The figures lay out in plot pixels: x from the left, y from the top.
const pixelScales = (W: number, H: number) => ({
  x: { scale: scaleLinear().domain([0, W]), axis: false as const },
  y: { scale: scaleLinear().domain([H, 0]), axis: false as const },
});
// Each cell's datum carries its final paint, so the color scale passes it through.
const passColor = { resolver: { id: "sol-heat-paint", resolve: () => ({ type: "identity", domain: [], range: [], map: (v: unknown) => String(v ?? "transparent") }) } };

type Box = { x: number; y: number; w: number; h: number; textX: number };
type TextRow = { x: number; y: number; s: string; k: string };

/** A vertical scale bar, high at the top, its ticks labeled unless two would collide. */
function colorbarMarks(box: Box, scale: HeatScale, paint: (t: number) => string, ticks: number[], lineH: number, fs: number, ink: { border: string; dim: string }, gradientId: string) {
  const span = scale.hi - scale.lo;
  const N = 32;
  const gradient: ChartGradient = {
    id: gradientId,
    stops: Array.from({ length: N + 1 }, (_, k) => ({ offset: k / N, color: paint(scale.t(span > 0 ? scale.lo + (span * k) / N : scale.lo)) })),
  };
  const drawn: number[] = [];
  const labels: TextRow[] = [];
  for (const v of ticks) {
    const ty = span > 0 ? box.y + ((scale.hi - v) / span) * box.h : box.y + box.h / 2;
    if (drawn.some((d) => Math.abs(d - ty) < lineH)) continue;
    drawn.push(ty);
    labels.push({ x: box.textX, y: ty, s: compactTick(v), k: `cb${v}` });
  }
  const bar = [{ x1: box.x, x2: box.x + box.w, y1: box.y, y2: box.y + box.h }];
  return {
    gradient,
    marks: [
      decorative(rect(bar, { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: `url(#${gradientId})`, stroke: ink.border, strokeWidth: 0.5, inset: 0, key: () => "cbar" })),
      decorative(text(labels, { x: "x", y: "y", text: "s", key: "k", anchor: "start", fill: ink.dim, fontSize: 9 * fs })),
    ],
  };
}

const gradientKey = (id: string) => `sol-cbar-${id.replace(/[^\w-]/g, "")}`;

// ─── Heatmap ──────────────────────────────────────────────────────────────────

type HeatCell = { r: number; c: number; v: number | null; x1: number; x2: number; y1: number; y2: number; paint: string; k: string };

export function HeatmapView({ payload: p, options: o, width: W, height: H, fscale: fs = 1 }: { payload: HeatmapPayload; options: ChartOptions; width: number; height: number; fscale?: number }) {
  const ink = useInk();
  const faces = useAppFaces();
  const forExport = useForExport();
  const gid = gradientKey(useId());
  const optsKey = JSON.stringify(o);
  const themeKey = JSON.stringify(ink.theme);
  const empty = p.z.length === 0 || p.cols.length === 0 || !p.z.some((r) => r.some((v) => v != null));

  const definition = useMemo(() => {
    if (empty) return null;
    const nR = p.z.length, nC = p.cols.length;
    let dLo = Infinity, dHi = -Infinity;
    for (const row of p.z) for (const v of row) if (v != null && Number.isFinite(v)) { if (v < dLo) dLo = v; if (v > dHi) dHi = v; }
    const scale = heatScale(dLo, dHi, o);
    const color = heatColorFn(o);
    const cbarTicks = scaleTicks(scale);
    const tickFont = measureFont(500, 9 * fs);
    const widest = (xs: Iterable<string>) => { let m = 0; for (const x of xs) m = Math.max(m, measureText(x, tickFont)); return m; };
    const showCbar = o.cbar !== false;
    const note = p.totalRows !== undefined || p.totalCols !== undefined;
    const L = heatmapLayout({
      nR, nC, W, H, fs,
      rowLabelW: widest(p.rows), colLabelW: widest(p.cols),
      cbarTickW: showCbar ? widest(cbarTicks.map(compactTick)) : 0,
      xlabel: !!o.xlabel, ylabel: !!o.ylabel, cbar: showCbar,
      aspect: o.aspect ?? "equal", lower: o.origin === "lower", note,
    });
    const { gx, cw, ch } = L;

    // Cells touch: each overdraws its right and lower neighbor by half a pixel so antialiasing leaves no seam.
    const cells: HeatCell[] = [];
    for (let r = 0; r < nR; r++) {
      const y = heatRowY(L, r);
      for (let c = 0; c < nC; c++) {
        const v = p.z[r][c] ?? null;
        const x = gx + c * cw;
        cells.push({
          r, c, v, x1: x, x2: x + cw + (c < nC - 1 ? 0.5 : 0), y1: y, y2: y + ch + ((L.lower ? r > 0 : r < nR - 1) ? 0.5 : 0),
          paint: v == null ? ink.sunken : rgbCss(color(scale.t(v))), k: `${r}:${c}`,
        });
      }
    }

    const annots: { size: number; rows: (TextRow & { ink: string })[] }[] = [];
    if (o.annot !== false) {
      const size = Math.min(12 * fs, Math.max(8.5 * fs, Math.min(cw, ch) * 0.3));
      const font = measureFont(500, size, "mono");
      let fits = ch >= size + 3;
      if (fits && o.annot === undefined) {
        outer: for (const row of p.z) for (const v of row) if (v != null && measureText(annotText(v, o.fmt), font) > cw - 4) { fits = false; break outer; }
      }
      if (fits || o.annot === true) {
        // A label that overflows its cell shrinks to fit; labels group by size, one text mark per size.
        const bySize = new Map<number, (TextRow & { ink: string })[]>();
        for (const d of cells) {
          if (d.v == null) continue;
          const s = annotText(d.v, o.fmt);
          const w = measureText(s, font);
          const f = w > cw - 3 ? Math.floor(((size * (cw - 3)) / w) * 2) / 2 : size;
          if (f < 6 || ch < f + 2) continue;
          const list = bySize.get(f) ?? [];
          list.push({ x: d.x1 + cw / 2, y: heatRowY(L, d.r) + ch / 2, s, k: d.k, ink: inkOn(color(scale.t(d.v))) });
          bySize.set(f, list);
        }
        for (const [s, rows] of bySize) annots.push({ size: s, rows });
      }
    }

    const labels: (TextRow & { anchor: "start" | "middle" | "end"; rotate?: number })[] = [];
    if (L.rowLabels) {
      const { x, w, step } = L.rowLabels;
      for (let r = 0; r < nR; r += step) labels.push({ x, y: heatRowY(L, r) + ch / 2, s: fitLabel(p.rows[r] ?? "", w, tickFont), k: `r${r}`, anchor: "end" });
    }
    if (L.colLabels) {
      const { y, h, rotated, step } = L.colLabels;
      for (let c = 0; c < nC; c += step) {
        const cx = gx + c * cw + cw / 2;
        labels.push(rotated
          ? { x: cx, y, s: fitLabel(p.cols[c] ?? "", h, tickFont), k: `c${c}`, anchor: "end", rotate: -90 }
          : { x: cx, y: y + 4.5 * fs, s: fitLabel(p.cols[c] ?? "", Math.max(cw - 2, 8), tickFont), k: `c${c}`, anchor: "middle" });
      }
    }
    if (L.note) {
      const parts: string[] = [];
      if (p.totalRows !== undefined) parts.push(`${nR} of ${p.totalRows} rows`);
      if (p.totalCols !== undefined) parts.push(`${nC} of ${p.totalCols} columns`);
      labels.push({ x: L.note.x, y: L.note.y, s: parts.join(", "), k: "note", anchor: "end" });
    }
    const titleFont = measureFont(600, 9 * fs);
    const titles: (TextRow & { rotate?: number })[] = [];
    if (L.xlabel && o.xlabel) titles.push({ x: L.xlabel.x, y: L.xlabel.y, s: fitLabel(o.xlabel, cw * nC, titleFont), k: "xl" });
    if (L.ylabel && o.ylabel) titles.push({ x: L.ylabel.x, y: L.ylabel.y, s: fitLabel(o.ylabel, ch * nR, titleFont), k: "yl", rotate: -90 });

    const cbar = L.cbar ? colorbarMarks(L.cbar, scale, (t) => rgbCss(color(t)), cbarTicks, L.lineH, fs, ink, gid) : null;
    const big = !forExport && cells.length > CANVAS_CELLS;
    const box = { x1: "x1", x2: "x2", y1: "y1", y2: "y2", key: "k" } as const;

    return defineChart({
      marks: [
        rect(cells, { ...box, color: "paint", inset: 0, ...(big ? { renderer: canvasChartRenderer } : {}) }),
        ...annots.map(({ size, rows }) => decorative(text(rows, { id: `${ANNOT_ID}-${size}`, x: "x", y: "y", text: "s", key: "k", fill: (d) => d.ink, fontSize: size, fontWeight: 500 }))),
        decorative(text(labels, { x: "x", y: "y", text: "s", key: "k", anchor: (d) => d.anchor, rotate: (d) => d.rotate ?? 0, fill: ink.dim, fontSize: 9 * fs, fontWeight: 500 })),
        decorative(text(titles, { x: "x", y: "y", text: "s", key: "k", rotate: (d) => d.rotate ?? 0, fill: ink.dim, fontSize: 9 * fs, fontWeight: 600 })),
        ...(cbar ? cbar.marks : []),
        whenFocused(rect(cells, { ...box, fill: "none", stroke: ink.text, strokeWidth: 1.5, inset: 0.75 }), { match: "key", retarget: true }),
      ],
      scales: pixelScales(W, H),
      color: passColor,
      gradients: cbar ? [cbar.gradient] : [],
      guides: false, margin: 0, theme: ink.theme,
      focusRing: false, keyboard: false, maxFocusDistance: 1,
      tooltip: tip((points: readonly ChartPoint[]) => {
        const d = points[0]?.datum as HeatCell | undefined;
        if (!d) return { rows: [] };
        return { title: `${p.rows[d.r]} · ${p.cols[d.c]}`, rows: [{ label: "", value: d.v == null ? "—" : formatScalar(d.v) }] };
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, optsKey, W, H, fs, themeKey, ink.text, ink.sunken, ink.border, faces, forExport, gid, empty]);

  if (!definition) return <EmptyFigure />;
  return (
    <Fig width={W} height={H}>
      <style href={ANNOT_ID} precedence="default">{ANNOT_CSS}</style>
      <Chart definition={definition} width={W} height={H} ariaLabel="heatmap" tabIndex={-1} />
    </Fig>
  );
}

// ─── Calendar heatmap ──────────────────────────────────────────────────────────

type CalCell = { day: number; v: number | null; x1: number; x2: number; y1: number; y2: number; paint: string };

export function CalHeatView({ payload: p, options: o, width: W, height: H, fscale: fs = 1 }: { payload: CalHeatPayload; options: ChartOptions; width: number; height: number; fscale?: number }) {
  const ink = useInk();
  const faces = useAppFaces();
  const forExport = useForExport();
  const gid = gradientKey(useId());
  const optsKey = JSON.stringify(o);
  const themeKey = JSON.stringify(ink.theme);

  const definition = useMemo(() => {
    if (p.days.length === 0) return null;
    const showCbar = o.cbar !== false;
    const tickFont = measureFont(500, 9 * fs);
    let tickW = 0;
    if (showCbar) {
      let lo = Infinity, hi = -Infinity;
      for (const v of p.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
      for (const v of scaleTicks(heatScale(lo, hi, o))) tickW = Math.max(tickW, measureText(compactTick(v), tickFont));
    }
    const L: CalLayout | null = calendarLayout(p.days, p.values, W, H, fs, showCbar ? tickW : null);
    if (!L) return null;
    const { byDay, start, end, gridStart, weeks, cell, gap, padL, padT, perBand } = L;
    const scale = heatScale(L.lo, L.hi, o);
    // No cmap and no center keeps the accent, at an opacity by value over the empty-day color.
    const color = heatColorFn(o);
    const under = colord(ink.sunken).toRgb(), over = colord(ink.accent).toRgb();
    const paint = o.cmap || o.center !== undefined
      ? (t: number) => rgbCss(color(t))
      : (t: number) => { const a = 0.16 + 0.84 * t; return rgbCss([under.r + (over.r - under.r) * a, under.g + (over.g - under.g) * a, under.b + (over.b - under.b) * a]); };

    const cells: CalCell[] = [];
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        const day = gridStart + w * 7 + r;
        if (day < start || day > end) continue;
        const { x, y } = calCellXY(L, w, r);
        const v = byDay.get(day) ?? null;
        cells.push({ day, v, x1: x, x2: x + cell - gap, y1: y, y2: y + cell - gap, paint: v == null ? ink.sunken : paint(scale.t(v)) });
      }
    }

    const half = 4.5 * fs;
    const labels: (TextRow & { anchor: "start" | "middle" | "end" })[] = [];
    if (L.truncated) labels.push({ x: padL + perBand * cell, y: padT - 2 - half, s: `last ${weeks} wk`, k: "trunc", anchor: "end" });
    // A band's first week labels a month carried over from the band above when two clear weeks follow, so it never crowds the next.
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const m = serialToJsDate(gridStart + w * 7).getUTCMonth();
      const bandStart = w % perBand === 0;
      if (m !== lastMonth || bandStart) {
        const clear = [1, 2].every((k) => serialToJsDate(gridStart + (w + k) * 7).getUTCMonth() === m);
        if (m !== lastMonth ? (w > 0 || weeks < 20) : clear) {
          const { x, y } = calCellXY(L, w, 0);
          labels.push({ x, y: y - 2 - half, s: "JFMAMJJASOND"[m] ?? "", k: `m${w}`, anchor: "start" });
        }
        lastMonth = m;
      }
    }
    for (let b = 0; b < L.bands; b++) {
      for (const [row, ch] of [[0, "M"], [2, "W"], [4, "F"]] as const) {
        labels.push({ x: padL - 3, y: calCellXY(L, b * perBand, row).y + cell / 2, s: ch, k: `d${b}${row}`, anchor: "end" });
      }
    }

    const cbar = L.cbar ? colorbarMarks(L.cbar, scale, paint, scaleTicks(scale), Math.ceil(10.5 * fs), fs, ink, gid) : null;
    const big = !forExport && cells.length > CANVAS_CELLS;
    const box = { x1: "x1", x2: "x2", y1: "y1", y2: "y2", key: "day" } as const;
    const ring = Math.min(1.5, Math.max(1, (cell - gap) / 6));

    return defineChart({
      marks: [
        rect(cells, { ...box, color: "paint", inset: 0, ...(big ? { renderer: canvasChartRenderer } : {}) }),
        decorative(text(labels, { x: "x", y: "y", text: "s", key: "k", anchor: (d) => d.anchor, fill: ink.dim, fontSize: 9 * fs, fontWeight: 500 })),
        ...(cbar ? cbar.marks : []),
        whenFocused(rect(cells, { ...box, fill: "none", stroke: ink.text, strokeWidth: ring, inset: -ring / 2 }), { match: "key", retarget: true }),
      ],
      scales: pixelScales(W, H),
      color: passColor,
      gradients: cbar ? [cbar.gradient] : [],
      guides: false, margin: 0, theme: ink.theme,
      focusRing: false, keyboard: false, maxFocusDistance: Math.max(1, gap),
      tooltip: tip((points: readonly ChartPoint[]) => {
        const d = points[0]?.datum as CalCell | undefined;
        if (!d) return { rows: [] };
        return { title: formatDateSerial(d.day, DEFAULT_DATE_FORMAT), rows: [{ label: "", value: d.v == null ? "—" : formatScalar(d.v) }] };
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, optsKey, W, H, fs, themeKey, ink.text, ink.sunken, ink.accent, ink.border, faces, forExport, gid]);

  if (!definition) return <EmptyFigure />;
  return (
    <Fig width={W} height={H}>
      <Chart definition={definition} width={W} height={H} ariaLabel="calendar heatmap" tabIndex={-1} />
    </Fig>
  );
}
