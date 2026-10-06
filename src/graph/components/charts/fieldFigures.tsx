// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
import { useMemo } from "react";
import { createMark, defineChart, dot, frame, vector, type ChartFocusStrategy, type SceneNode } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { canvasChartRenderer } from "@tanstack/charts/canvas";
import { contour } from "@tanstack/charts/spatial/contour";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import "../chartView.css";
import { Fig, tip, useTheme, axisLabel, useForExport } from "./kit";
import { compactTick, canvasFont, niceTicks } from "../chartCore";
import { colormapRgb, heatScale, type HeatScale } from "../../colormaps";
import { heightRampColor, divergingRampColor } from "../../palette";
import { formatScalar } from "../format";
import type { ChartOptions } from "../../nodes/chartOptions";
import type { ContourPayload, QuiverPayload } from "../../chartValue";
import { iterMin, iterMax } from "../../nodes/mathUtils";
import { cellOf, bilinear, contourAt } from "../heatmapLayout";

type Rgb = [number, number, number];
const rgbCss = ([r, g, b]: Rgb) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The color of `t` under the options: the named cmap, else the palette's diverging ramp with a center, else its height ramp. */
function heatColorFn(o: ChartOptions): (t: number) => Rgb {
  if (o.cmap) return (t) => colormapRgb(o.cmap!, t) ?? heightRampColor(t);
  return o.center !== undefined ? divergingRampColor : heightRampColor;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(s: string, px: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return s.length * px * 0.6;
  measureCtx.font = canvasFont(500, px);
  return measureCtx.measureText(s).width;
}

const Empty = () => <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

// ─── Contour ───────────────────────────────────────────────────────────────────

// Fine bands under the iso-lines: enough steps that the fill reads as a smooth gradient, as the bilinear shading did.
const SHADE_STEPS = 64;

/** The grid resampled at `m` by `k` cell centers spanning the data's x and y range, row zero at the bottom, so the
 *  contour mark's even grid lands on true coordinates whatever the spacing or direction of `xs` and `ys`. */
function resample(p: ContourPayload, m: number, k: number, ext: { xmin: number; xmax: number; ymin: number; ymax: number }): number[] {
  const cols = Array.from({ length: m }, (_, j) => cellOf(p.xs, ext.xmin + ((j + 0.5) / m) * (ext.xmax - ext.xmin)));
  const out: number[] = new Array(m * k);
  for (let r = 0; r < k; r++) {
    const cy = cellOf(p.ys, ext.ymin + ((r + 0.5) / k) * (ext.ymax - ext.ymin));
    for (let j = 0; j < m; j++) {
      const cx = cols[j];
      out[r * m + j] = cx && cy ? bilinear(p.z, cx, cy) ?? NaN : NaN;
    }
  }
  return out;
}

/** Iso-line segments by marching squares on the source grid, in data coordinates; saddles split by the cell mean. */
function isoSegments(p: ContourPayload, t: number): number[] {
  const { xs, ys, z } = p;
  const segs: number[] = [];
  for (let iy = 0; iy < ys.length - 1; iy++) for (let ix = 0; ix < xs.length - 1; ix++) {
    const z00 = z[iy]?.[ix], z10 = z[iy]?.[ix + 1], z01 = z[iy + 1]?.[ix], z11 = z[iy + 1]?.[ix + 1];
    if (!fin(z00) || !fin(z10) || !fin(z01) || !fin(z11)) continue;
    const pts: number[] = [];
    const cross = (a: number, b: number, ax: number, ay: number, bx: number, by: number) => {
      if ((a - t) * (b - t) < 0) { const f = (t - a) / (b - a); pts.push(ax + (bx - ax) * f, ay + (by - ay) * f); }
    };
    const X0 = xs[ix], X1 = xs[ix + 1], Y0 = ys[iy], Y1 = ys[iy + 1];
    cross(z00, z10, X0, Y0, X1, Y0);
    cross(z10, z11, X1, Y0, X1, Y1);
    cross(z01, z11, X0, Y1, X1, Y1);
    cross(z00, z01, X0, Y0, X0, Y1);
    if (pts.length === 4) segs.push(...pts);
    else if (pts.length === 8) {
      const order = (z00 + z10 + z01 + z11) / 4 > t ? [0, 1, 2, 3] : [0, 3, 1, 2];
      for (const q of order) segs.push(pts[2 * q], pts[2 * q + 1]);
    }
  }
  return segs;
}

/** The iso-lines as one path per level, drawn in the plot's own coordinates. */
function isoLinesMark(levels: number[][]) {
  return createMark<never, number, number>(({ markIndex }) => {
    const id = `sol-iso-${markIndex}`;
    return {
      id,
      channels: {},
      render: ({ scales }) => {
        const sx = scales.x.map, sy = scales.y.map;
        const nodes: SceneNode[] = levels.map((segs, li) => {
          let d = "";
          for (let s = 0; s < segs.length; s += 4) {
            d += `M${sx(segs[s]).toFixed(2)},${sy(segs[s + 1]).toFixed(2)}L${sx(segs[s + 2]).toFixed(2)},${sy(segs[s + 3]).toFixed(2)}`;
          }
          return { kind: "polyline", key: `${id}:${li}`, points: [], path: d, ariaHidden: true, style: { fill: "none", stroke: "rgba(0,0,0,0.45)", strokeWidth: 0.8, lineCap: "round" } };
        });
        return { nodes };
      },
    };
  });
}

/** A vertical scale bar right of the plot, high at the top, its ticks labeled unless two would collide. */
function colorbarMark(scale: HeatScale, color: (t: number) => Rgb, ticks: number[], o: { gap: number; w: number; fs: number; ink: string; border: string }) {
  return createMark<never, number, number>(({ markIndex }) => {
    const id = `sol-cbar-${markIndex}`;
    return {
      id,
      channels: {},
      render: ({ chart }) => {
        const x = chart.x + chart.width + o.gap, y = chart.y, h = chart.height;
        const span = scale.hi - scale.lo;
        const slices = Math.max(2, Math.min(64, Math.round(h / 2)));
        const nodes: SceneNode[] = [];
        for (let i = 0; i < slices; i++) {
          const v = span > 0 ? scale.hi - (span * (i + 0.5)) / slices : scale.lo;
          const fill = rgbCss(color(scale.t(v)));
          nodes.push({ kind: "rect", key: `${id}:s${i}`, x, y: y + (h * i) / slices, width: o.w, height: h / slices + (i < slices - 1 ? 0.5 : 0), style: { fill } });
        }
        nodes.push({ kind: "rect", key: `${id}:box`, x, y, width: o.w, height: h, style: { fill: "none", stroke: o.border, strokeWidth: 0.5 } });
        const lineH = Math.ceil(10.5 * o.fs);
        const drawn: number[] = [];
        for (const v of ticks) {
          const ty = span > 0 ? y + ((scale.hi - v) / span) * h : y + h / 2;
          if (drawn.some((d) => Math.abs(d - ty) < lineH)) continue;
          drawn.push(ty);
          nodes.push({ kind: "label", key: `${id}:t${drawn.length}`, x: x + o.w + 3, y: ty, text: compactTick(v), anchor: "start", baseline: "middle", fontSize: 9 * o.fs, style: { fill: o.ink } });
        }
        return { nodes: [{ kind: "group", key: id, ariaHidden: true, children: nodes }] };
      },
    };
  });
}

type Probe = { x: number; y: number; z: number | null };

/** Focus on the pointer itself rather than a nearest datum, so the readout follows it across the field. */
function pointerProbe(plot: { x0: number; x1: number; y0: number; y1: number }, ext: { xmin: number; xmax: number; ymin: number; ymax: number }, read: (x: number, y: number) => number | null): ChartFocusStrategy<Probe, number, number> {
  return {
    resolve: (points, { x: px, y: py }) => {
      if (px < plot.x0 || px > plot.x1 || py < plot.y0 || py > plot.y1 || points.length === 0) return [];
      const x = ext.xmin + ((px - plot.x0) / (plot.x1 - plot.x0)) * (ext.xmax - ext.xmin);
      const y = ext.ymax - ((py - plot.y0) / (plot.y1 - plot.y0)) * (ext.ymax - ext.ymin);
      const base = points[0];
      return [{ ...base, key: "sol-probe", datum: { x, y, z: read(x, y) }, xValue: x, yValue: y, x: px, y: py }];
    },
    group: (points) => points,
    navigation: (points) => points,
  };
}

/** One invisible point to give the chart something to focus; the probe strategy moves it to the pointer. */
function probeAnchor(cx: number, cy: number) {
  return createMark<Probe, number, number>(({ markIndex }) => {
    const id = `sol-probe-${markIndex}`;
    const datum: Probe = { x: cx, y: cy, z: null };
    return {
      id,
      channels: {},
      render: ({ scales }) => ({
        nodes: [],
        points: [{ key: `${id}:0`, markId: id, group: null, groupLabel: id, datum, datumIndex: 0, xValue: cx, yValue: cy, x: scales.x.map(cx), y: scales.y.map(cy), color: "transparent" }],
      }),
    };
  });
}

export function ContourView({ payload, options, width, height, fscale = 1 }: { payload: ContourPayload; options: ChartOptions; width: number; height: number; fscale?: number }) {
  const { theme, grid, axis } = useTheme();
  const fs = fscale;
  const definition = useMemo(() => {
    const { xs, ys, z } = payload;
    if (xs.length < 2 || ys.length < 2) return null;
    let zmin = Infinity, zmax = -Infinity;
    for (const row of z) for (const v of row) if (fin(v)) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
    if (!Number.isFinite(zmin)) return null;
    const o = options;
    const scale = heatScale(zmin, zmax, o);
    const color = heatColorFn(o);
    const ext = { xmin: iterMin(xs), xmax: iterMax(xs), ymin: iterMin(ys), ymax: iterMax(ys) };
    if (ext.xmax === ext.xmin || ext.ymax === ext.ymin) return null;

    // Gutters: y ticks and label left, x ticks and label below, the colorbar right, half a tick's text above.
    const tickPx = 9 * fs;
    const lineH = Math.ceil(10.5 * fs);
    const widest = (vs: number[]) => vs.reduce((m, v) => Math.max(m, textWidth(compactTick(v), tickPx)), 0);
    const cbarTicks = [scale.hi, ...(scale.center !== undefined && scale.center > scale.lo && scale.center < scale.hi ? [scale.center] : []), scale.lo];
    const cbarW = o.cbar === false ? 0 : 6 + 8 + 3 + widest(cbarTicks);
    const top = Math.ceil(5 * fs);
    const bottom = lineH + 3 + (o.xlabel ? lineH + 2 : 0);
    const yTicks = niceTicks(ext.ymin, ext.ymax, Math.max(3, Math.floor((height - top - bottom) / (30 * fs)))).filter((t) => t >= ext.ymin && t <= ext.ymax);
    const left = (o.ylabel ? lineH + 2 : 0) + widest(yTicks) + 6;
    const right = Math.ceil(Math.max(cbarW, textWidth(compactTick(ext.xmax), tickPx) / 2 + 1));
    const plot = { x0: left, x1: width - right, y0: top, y1: height - bottom };
    if (plot.x1 - plot.x0 < 10 || plot.y1 - plot.y0 < 10) return null;
    const xTicks = niceTicks(ext.xmin, ext.xmax, Math.max(3, Math.floor((plot.x1 - plot.x0) / (45 * fs)))).filter((t) => t >= ext.xmin && t <= ext.xmax);

    const m = Math.max(2, Math.min(180, Math.round((plot.x1 - plot.x0) / 2)));
    const k = Math.max(2, Math.min(180, Math.round((plot.y1 - plot.y0) / 2)));
    const field = resample(payload, m, k, ext);
    const step = (zmax - zmin) / SHADE_STEPS;
    const thresholds = step > 0 ? Array.from({ length: SHADE_STEPS }, (_, i) => zmin + i * step) : [zmin];
    const levels = Math.max(2, payload.levels | 0);
    const zTop = zmax === zmin ? zmin + 1 : zmax;
    const iso = Array.from({ length: levels }, (_, i) => isoSegments(payload, zmin + ((zTop - zmin) * (i + 1)) / (levels + 1)));

    const axisStyle = (ticks: number[], label: string | undefined) => ({
      ticks: { values: ticks, format: (v: number) => compactTick(v), size: 3, padding: 1 },
      tickLabels: { fontSize: tickPx },
      label: axisLabel(label, fs * 0.9),
    });
    return defineChart({
      marks: [
        contour(field, {
          width: m, height: k, thresholds, smooth: true,
          fill: (d) => rgbCss(color(scale.t(step > 0 ? d.value + step / 2 : d.value))),
        }),
        isoLinesMark(iso),
        frame({ fill: "none", stroke: grid, strokeWidth: 0.5 }),
        ...(o.cbar === false ? [] : [colorbarMark(scale, color, cbarTicks, { gap: 6, w: 8, fs, ink: axis, border: grid })]),
        probeAnchor((ext.xmin + ext.xmax) / 2, (ext.ymin + ext.ymax) / 2),
      ],
      scales: {
        x: { scale: scaleLinear().domain([ext.xmin, ext.xmax]), axis: axisStyle(xTicks, o.xlabel) },
        y: { scale: scaleLinear().domain([ext.ymin, ext.ymax]), axis: axisStyle(yTicks, o.ylabel) },
      },
      margin: { top, right, bottom, left },
      theme, keyboard: false, focusRing: false,
      focus: pointerProbe(plot, ext, (x, y) => contourAt(payload, x, y)),
      tooltip: { ...tip((points) => {
        const d = points[0]?.datum as Probe | undefined;
        return { title: d ? `x ${compactTick(d.x)}, y ${compactTick(d.y)}` : "", rows: [{ label: "", value: d?.z == null ? "—" : formatScalar(d.z) }] };
      }), anchor: "pointer" as const },
    });
  }, [payload, options, width, height, fs, theme, grid, axis]);

  if (!definition) return <Empty />;
  return (
    <Fig width={width} height={height}>
      <Chart definition={definition} width={width} height={height} ariaLabel={options.title || "Contour"} tabIndex={-1} />
    </Fig>
  );
}

// ─── Vector field (quiver) ─────────────────────────────────────────────────────

type Arrow = { ix: number; iy: number; u: number; v: number; mag: number; rotate: number; length: number; stroke: string };
const QUIVER_PAD = 4;
// The vector mark takes one stroke width and head per mark, so arrows are grouped by both, quantized this finely.
const STROKE_STEP = 0.1, HEAD_STEP = 0.25;
// The head's half-angle: 0.9 of its length wide.
const HEAD_ANGLE = (Math.atan(0.45) * 180) / Math.PI;

export function QuiverView({ payload, options, width, height }: { payload: QuiverPayload; options: ChartOptions; width: number; height: number }) {
  const { theme, grid } = useTheme();
  const forExport = useForExport();
  const ny = Math.min(payload.u.length, payload.v.length);
  const nx = Math.min(payload.u[0]?.length ?? 0, payload.v[0]?.length ?? 0);
  const definition = useMemo(() => {
    if (nx === 0 || ny === 0) return null;
    const color = heatColorFn({ cmap: options.cmap });
    const cw = (width - 2 * QUIVER_PAD) / nx, ch = (height - 2 * QUIVER_PAD) / ny;
    const cell = Math.min(cw, ch);
    let maxMag = 0;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const u = payload.u[iy]?.[ix], v = payload.v[iy]?.[ix];
      if (fin(u) && fin(v)) maxMag = Math.max(maxMag, Math.hypot(u, v));
    }
    if (maxMag === 0) maxMag = 1;
    const reach = cell * 0.46;
    const groups = new Map<string, { sw: number; hl: number; rows: Arrow[] }>();
    const holes: { ix: number; iy: number }[] = [];
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const u = payload.u[iy]?.[ix], v = payload.v[iy]?.[ix];
      if (!fin(u) || !fin(v)) { holes.push({ ix, iy }); continue; }
      const mag = Math.hypot(u, v);
      const t = mag / maxMag;
      const len = reach * (0.15 + 0.85 * t);
      const sw = Math.round(Math.max(0.7, cell * 0.07 * (0.55 + 0.45 * t)) / STROKE_STEP) * STROKE_STEP;
      const head = Math.min(4.5, len * 0.55);
      const hl = head >= 2.2 ? Math.round(head / HEAD_STEP) * HEAD_STEP : 0;
      const key = `${sw.toFixed(1)}:${hl}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { sw, hl, rows: [] }));
      g.rows.push({ ix, iy, u, v, mag, rotate: (Math.atan2(u, v) * 180) / Math.PI, length: 2 * len, stroke: rgbCss(color(t)) });
    }
    const renderer = !forExport && nx * ny > 400 ? { renderer: canvasChartRenderer } : {};
    const at = { x: (d: { ix: number }) => d.ix + 0.5, y: (d: { iy: number }) => d.iy + 0.5 };
    return defineChart({
      marks: [
        ...(holes.length ? [dot(holes, { ...at, r: 0.8, fill: grid, fillOpacity: 0.4, ...renderer })] : []),
        ...[...groups.values()].map((g, gi) => vector(g.rows, {
          id: `sol-arrows-${gi}`, ...at, length: "length", rotate: "rotate", anchor: "middle",
          stroke: (d) => d.stroke, strokeWidth: g.sw, headLength: g.hl, headAngle: HEAD_ANGLE, ...renderer,
        })),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, nx]), axis: false },
        y: { scale: scaleLinear().domain([ny, 0]), axis: false },
      },
      guides: false, margin: QUIVER_PAD, theme, keyboard: false, focusRing: false,
      tooltip: tip((points) => {
        const d = points[0]?.datum as Arrow | { ix: number; iy: number } | undefined;
        if (!d || !("u" in d)) return { title: "", rows: [] };
        return { title: `row ${d.iy + 1}, column ${d.ix + 1}`, rows: [{ label: "u", value: formatScalar(d.u) }, { label: "v", value: formatScalar(d.v) }, { label: "magnitude", value: formatScalar(d.mag) }] };
      }),
    });
  }, [payload, options.cmap, width, height, nx, ny, theme, grid, forExport]);

  if (!definition) return <Empty />;
  return (
    <Fig width={width} height={height}>
      <Chart definition={definition} width={width} height={height} ariaLabel={options.title || "Vector field"} tabIndex={-1} />
    </Fig>
  );
}

