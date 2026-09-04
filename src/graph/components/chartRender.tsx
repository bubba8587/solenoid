// Every recharts-using renderer in ONE module so recharts stays a single lazy
// chunk — nothing here may be imported statically by the app.
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadialBarChart, RadialBar, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadarChart, Radar, PieChart, Pie, ScatterChart, Scatter, ZAxis, FunnelChart, Funnel, LabelList, Cell, Treemap, Sankey, ComposedChart, Symbols, type ScatterShapeProps, type SymbolsProps } from "recharts";
import { useState, type SyntheticEvent, type ReactElement } from "react";
import "./chartView.css";
import { formatScalar } from "./format";
import { useChartColors, useSeriesColors, axisTick, type ChartShape } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";
import type { OverlayPayload } from "../chartValue";

const LINE_DOT_R = 2;
const SCATTER_DOT_R = 3;
// The expand ⛶ button sits over the figure's top-right corner: every cartesian plot
// leaves this much headroom so neither the button nor the top tick lands on the plot rect.
const PLOT_TOP = 14;
// All the labels fit while there are few enough of them; past that recharts thins them.
const ALL_TICKS_UPTO = 12;
// recharts' Scatter has no size prop: its default Symbols circle is a fixed 64 px² (r ≈ 4.5).
const scatterDot = (r: number) => (p: ScatterShapeProps) => <Symbols {...(p as unknown as SymbolsProps)} type="circle" size={Math.PI * r * r} />;

// formatScalar precision, not recharts' raw full-float. Point index is 1-based.
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: number | string;
}) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  const idx = Number(label);
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <span style={{ color: "var(--text-dim)" }}>#{Number.isFinite(idx) ? Math.round(idx) + 1 : "?"}</span>
      {"  "}
      {tipValue(v)}
    </div>
  );
}

// A non-primitive (a SolError past the series sanitizer) must be stringified —
// React throws "Objects are not valid as a React child" and takes down the node.
function tipValue(v: unknown): string {
  if (typeof v === "number") return formatScalar(v);
  if (v == null) return "";
  if (typeof v === "object") return String((v as { code?: string }).code ?? "—");
  return String(v);
}

const TIP = <Tooltip isAnimationActive={false} cursor={{ stroke: "rgba(128,128,128,0.5)", fill: "rgba(128,128,128,0.12)" }} content={<ChartTooltip />} />;

// For polar/categorical charts, where an x-axis index is meaningless.
function SliceTooltip({ active, payload }: { active?: boolean; payload?: { value?: number }[] }) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      {tipValue(v)}
    </div>
  );
}
const SLICE_TIP = <Tooltip isAnimationActive={false} content={<SliceTooltip />} />;

const RADIAN = Math.PI / 180;
/** Slice labels can be user text (a Frame's category names): strip control characters,
 *  collapse whitespace, and cap the length so a long or hostile name can't smear across
 *  the figure or break its layout. */
export function sanitizeChartLabel(raw: string, cap = 16): string {
  let clean = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    clean += (c !== undefined && (c < 0x20 || (c >= 0x7f && c <= 0x9f))) ? " " : ch;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  return clean.length > cap ? `${clean.slice(0, cap - 1).trimEnd()}…` : clean;
}

// Reads the datum off payload[0].payload so it works whether the x axis is a real
// coordinate (dataKey "x") or the row index ("i").
function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload?: { x?: number; i?: number; v?: number } }[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const x = typeof d.x === "number" ? axisTick(d.x) : `#${(d.i ?? 0) + 1}`;
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <span style={{ color: "var(--text-dim)" }}>{x}</span>
      {"  "}
      {tipValue(d.v)}
    </div>
  );
}
const SCATTER_TIP = <Tooltip isAnimationActive={false} cursor={{ strokeDasharray: "3 3", stroke: "rgba(128,128,128,0.5)" }} content={<ScatterTooltip />} />;

/** A numeric axis that really carries ROW INDICES: pinned to exactly [0, n−1], one tick
 *  per index while they fit, and padded so the first and last marks don't straddle the
 *  frame. An empty list (a real coordinate x) keeps recharts' own rounded "nice" domain. */
function catDomain(indices: number[]): { domain?: [number, number]; ticks?: number[]; padding?: { left: number; right: number } } {
  const hi = indices.reduce((m, i) => Math.max(m, i), 0);
  if (hi <= 0) return {};
  return {
    domain: [0, hi],
    ticks: indices.length <= ALL_TICKS_UPTO ? indices : undefined,
    padding: { left: 8, right: 8 },
  };
}

/** The figure title strip every view draws above its chart; `titleHeight` reserves
 *  the same band out of the chart's own height. */
const titleHeight = (fs: number) => Math.ceil(16 * fs);
function ChartTitle({ text, fs }: { text: string; fs: number }) {
  const h = titleHeight(fs);
  return (
    <div style={{ height: h, lineHeight: `${h}px`, textAlign: "center", fontSize: 11 * fs, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}

/** One renderer for both the inline node charts and the expand popup; without
 *  `axes` it is a clean Sparkline. */
export function ChartView({
  op, series, width, height, axes, opts, signColors, labels, fontScale,
}: {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
  /** Win/loss coloring: positive → pos, negative → neg, zero → grid. Bar ops only. */
  signColors?: { pos: string; neg: string };
  /** X-axis category labels (Frame col 0), shown instead of 1,2,3… */
  labels?: (string | number)[];
  /** Display-layer multiplier ON TOP of the options' own fontsize. */
  fontScale?: number;
}) {
  const { grid, axis, viz } = useChartColors();
  const seriesColors = useSeriesColors();
  const paint = (i: number) => seriesColors[i % seriesColors.length];
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  // A recharts `type="number"` index axis hands back INTERPOLATED fractional ticks
  // (0.5, 1.5…), so round to the nearest datum and drop anything off the ends.
  const tickFmt = (i: number | string) => {
    const n = Number(i);
    if (!Number.isFinite(n)) return "";
    const idx = Math.round(n);
    if (labels) {
      const lab = labels[idx];
      if (lab == null || typeof lab === "object") return "";
      // Snap a numeric label free of float noise so a "really 3" isn't "3.0000000004".
      return typeof lab === "number" ? axisTick(lab) : String(lab);
    }
    return idx >= 0 ? String(idx + 1) : "";
  };

  const color = opts?.color || viz;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? axes; // lines dot by default when axed
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const dot = scatterDot(opts?.markersize ?? SCATTER_DOT_R);
  const fillAlpha = opts?.alpha ?? 0.25;
  // recharts wants "auto" for an open bound.
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const xLabel = axes && opts?.xlabel
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis }
    : undefined;
  const title = opts?.title;
  const titleH = title ? titleHeight(fs) : 0;
  const chartH = height - titleH;
  const yAxisW = axes ? (yLabel ? 40 : 26) : 0;
  const bottomM = axes ? (xLabel ? 18 : 4) : 2;
  const margin = axes ? { top: PLOT_TOP, right: 8, bottom: bottomM, left: 0 } : { top: 2, right: 2, bottom: 2, left: 2 };
  const catInterval = series.length <= ALL_TICKS_UPTO ? 0 : undefined;

  let chart;
  if (op === "line") {
    chart = (
      <LineChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Line dataKey="v" stroke={color} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </LineChart>
    );
  } else if (op === "area") {
    chart = (
      <AreaChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Area dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </AreaChart>
    );
  } else if (op === "bar") {
    // The 18px gutter fits index digits; real category labels need room for the
    // WIDEST one (else "UltraSlim" prints as "im"), capped so bars keep the card.
    const catW = labels
      ? Math.min(Math.round(width / 3), Math.max(18, 8 + Math.ceil(Math.max(...series.map((d) => tickFmt(d.i).length)) * 5.2 * fs)))
      : 18;
    chart = (
      <BarChart width={width} height={chartH} data={series} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} domain={yDomain} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={yLabel ? Math.max(32, catW) : catW} tickFormatter={tickFmt} interval={catInterval} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={fillAlpha < 1 && opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  } else if (op === "pie") {
    // Category labels ride a hand-drawn two-segment leader (a radial stub, then a
    // horizontal run to a fixed column per side) so every label on a side shares one x —
    // no arc-following, and the line meets the text instead of stopping short. On by
    // default when the frame supplies names; `pielabels=off` (or the Chart Builder
    // toggle) turns them off, and then the pie fills the whole box. Names are sanitized +
    // length-capped (untrusted text); vanishingly thin slices skip their label.
    const pieMode = opts?.pielabels ?? "outside";
    const labeled = !!labels && pieMode !== "off";
    // Inside labels ride the slice, so only the small ones spill outside — the box barely
    // shrinks. Outside labels need the full margin for their leaders.
    const pad = !labeled ? 6 : pieMode === "inside" ? Math.min(16, width * 0.07) : Math.min(30, width * 0.12);
    const r = Math.max(18, Math.min(width, chartH) / 2 - pad);
    const cap = width < 260 ? 10 : 16;
    const stub = 7;
    const font = 9 * fs;
    const pieLabel = (p: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; index?: number; percent?: number; payload?: unknown }) => {
      const cx = p.cx ?? 0, cy = p.cy ?? 0, mid = p.midAngle ?? 0, outerR = p.outerRadius ?? 0, index = p.index ?? 0;
      const rowI = (p.payload as { i?: number } | undefined)?.i ?? series[index]?.i ?? index;
      const name = sanitizeChartLabel(tickFmt(rowI), cap);
      const pct = p.percent ?? 0;
      if (!name || pct < 0.03) return null;
      const cos = Math.cos(-mid * RADIAN), sin = Math.sin(-mid * RADIAN);
      // Inside: centre a backing-plated label on the slice, but a thin slice (< 6%) can't
      // hold it, so it keeps the outside leader.
      if (pieMode === "inside" && pct >= 0.06) {
        const rr = outerR * 0.62;
        const x = cx + rr * cos, y = cy + rr * sin;
        const w = name.length * font * 0.6 + 6, h = font + 4;
        return (
          <g>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={3} fill="var(--surface)" opacity={0.72} />
            <text x={x} y={y} fill={axis} fontSize={font} textAnchor="middle" dominantBaseline="central">{name}</text>
          </g>
        );
      }
      const side = cos >= 0 ? 1 : -1;
      const sx = cx + outerR * cos, sy = cy + outerR * sin;                // slice edge
      const mx = cx + (outerR + stub) * cos, my = cy + (outerR + stub) * sin; // elbow
      const colX = cx + (outerR + stub) * side;                            // shared column x
      return (
        <g>
          <polyline points={`${sx},${sy} ${mx},${my} ${colX},${my}`} stroke={grid} fill="none" />
          <text x={colX + side * 3} y={my} fill={axis} fontSize={font} textAnchor={side > 0 ? "start" : "end"} dominantBaseline="central">{name}</text>
        </g>
      );
    };
    chart = (
      <PieChart width={width} height={chartH}>
        <Pie data={series} dataKey="v" nameKey="i" cx="50%" cy="50%" outerRadius={r} stroke="var(--surface)" isAnimationActive={false}
             label={labeled ? pieLabel : undefined} labelLine={false}>
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </Pie>
        {SLICE_TIP}
      </PieChart>
    );
  } else if (op === "radar") {
    chart = (
      <RadarChart width={width} height={chartH} data={series} cx="50%" cy="50%" outerRadius="72%">
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="i" tick={AXIS} tickFormatter={tickFmt} />
        {/* Radial ticks print rotated ON the polygon; the tooltip carries the raw value. */}
        <PolarRadiusAxis tick={false} axisLine={false} tickCount={4} domain={yDomain} />
        {TIP}
        <Radar dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </RadarChart>
    );
  } else if (op === "radialbar") {
    // Nothing else names a ring, so the legend is the only key: recharts reads each
    // entry's `name`/`fill` off the chart DATA for a radial legend.
    const rings = series.map((d, i) => ({ ...d, name: sanitizeChartLabel(tickFmt(d.i)), fill: paint(i) }));
    chart = (
      <RadialBarChart width={width} height={chartH} cx="50%" cy="50%" innerRadius="18%" outerRadius="92%" data={rings} startAngle={90} endAngle={-270}>
        <RadialBar dataKey="v" background={{ fill: grid }} cornerRadius={3} isAnimationActive={false}>
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </RadialBar>
        {labels && <Legend verticalAlign="bottom" height={LEGEND_H} iconSize={8} wrapperStyle={{ fontSize: 9 * fs, color: axis }} />}
        {SLICE_TIP}
      </RadialBarChart>
    );
  } else if (op === "funnel") {
    chart = (
      <FunnelChart width={width} height={chartH}>
        {SLICE_TIP}
        <Funnel dataKey="v" data={series} isAnimationActive={false}>
          <LabelList position="right" dataKey="v" fill={axis} stroke="none" fontSize={10 * fs} />
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </Funnel>
      </FunnelChart>
    );
  } else if (op === "scatter") {
    // An all-numeric first column places each dot at its REAL x, so the plot honours
    // x spacing and order; category labels or a plain list keep the index x.
    const numericX = !!labels && series.length > 0 && series.every((d) => typeof labels![d.i] === "number");
    const scatterData = numericX ? series.map((d) => ({ i: d.i, x: Number(labels![d.i]), v: d.v })) : series;
    // A row-index x is a CATEGORY axis wearing a number's clothes: pinned to [0, n−1] the
    // points span the plot instead of huddling inside recharts' rounded-up nice domain.
    const catX = catDomain(numericX ? [] : series.map((d) => d.i));
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {/* allowDecimals=false stops recharts inventing fractional "nice" ticks. */}
        {axes && <XAxis type="number" dataKey={numericX ? "x" : "i"} tick={AXIS} tickLine={false} tickFormatter={numericX ? (t) => axisTick(Number(t)) : tickFmt} allowDecimals={numericX ? undefined : false} domain={catX.domain} ticks={catX.ticks} padding={catX.padding} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="number" dataKey="v" tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {SCATTER_TIP}
        <Scatter data={scatterData} fill={color} shape={dot} isAnimationActive={false} />
      </ScatterChart>
    );
  } else {
    chart = (
      <BarChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false}>
          {signColors && series.map((d, i) => (
            <Cell key={i} fill={d.v > 0 ? signColors.pos : d.v < 0 ? signColors.neg : grid} />
          ))}
        </Bar>
      </BarChart>
    );
  }

  if (!title) return chart;
  return (
    <div style={{ width }}>
      <ChartTitle text={title} fs={fs} />
      {chart}
    </div>
  );
}

// Lists every series' value at the hovered index (the multi-series counterpart of
// ChartTooltip); the swatch color comes from each recharts payload entry.
function MultiTooltip({ active, payload, label, tickFmt, rawFromNorm }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, number | null> }[];
  label?: number | string;
  tickFmt: (i: number | string) => string;
  // Radar plots the per-axis-normalized `_n{j}`; show the RAW `s{j}` from the row instead.
  rawFromNorm?: boolean;
}) {
  if (!active || !payload || !payload.length) return null;
  const shown = (p: { value?: number; dataKey?: string; payload?: Record<string, number | null> }) =>
    rawFromNorm && typeof p.dataKey === "string" && p.dataKey.startsWith("_n") && p.payload
      ? p.payload[`s${p.dataKey.slice(2)}`]
      : p.value;
  return (
    <div style={{ fontSize: 11, padding: "3px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{tickFmt(label ?? "")}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flex: "0 0 auto" }} />
          <span style={{ color: "var(--text-dim)" }}>{p.name}</span>
          <span style={{ marginLeft: "auto" }}>{tipValue(shown(p) ?? undefined)}</span>
        </div>
      ))}
    </div>
  );
}

const LEGEND_H = 16;

/** Multi-series cartesian render (column/bar/line/area/scatter/radar) with a legend —
 *  the C2 frame path: each numeric column after the label is one named series, colored
 *  from the palette (Options `color` is single-series only; the palette wins here). */
export function MultiSeriesView({
  op, series, labels, width, height, axes, opts, fontScale,
}: {
  op: ChartShape;
  series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[];
  width: number; height: number; axes: boolean;
  opts?: ChartOptions; fontScale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const paint = (j: number) => colors[j % colors.length];
  // Legend click spotlights one series (the rest dim); clicking it again clears.
  const [focus, setFocus] = useState<number | null>(null);
  const dim = (j: number) => (focus !== null && focus !== j ? 0.18 : 1);
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const data = Array.from({ length: n }, (_, i) => {
    const o: Record<string, number | null> = { i };
    series.forEach((s, j) => { o[`s${j}`] = num(s.values[i]); });
    return o;
  });
  const tickFmt = (i: number | string) => {
    const idx = Math.round(Number(i));
    if (!Number.isFinite(idx)) return "";
    if (labels) { const lab = labels[idx]; return lab == null || typeof lab === "object" ? "" : typeof lab === "number" ? axisTick(lab) : String(lab); }
    return idx >= 0 ? String(idx + 1) : "";
  };
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? false;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const dot = scatterDot(opts?.markersize ?? SCATTER_DOT_R);
  // Overlaid area fills stack, so a shared default would paint the pair into one mass;
  // thinner fills keep both readable and let the overlap read as a blend.
  const fillAlpha = opts?.alpha ?? (op === "area" && series.length >= 2 ? 0.18 : 0.25);
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const title = opts?.title;
  const titleH = title ? titleHeight(fs) : 0;
  const chartH = height - titleH; // the <Legend height> reserves its own strip within this
  const margin = { top: axes ? PLOT_TOP : 6, right: 8, bottom: axes ? 4 : 2, left: 0 };
  const catInterval = n <= ALL_TICKS_UPTO ? 0 : undefined;
  const legend = (
    <Legend
      verticalAlign="bottom" height={LEGEND_H} iconSize={8}
      wrapperStyle={{ fontSize: 9 * fs, color: axis, cursor: "pointer" }}
      onClick={(e) => { const j = series.findIndex((s) => s.name === e.value); if (j >= 0) setFocus((f) => (f === j ? null : j)); }}
      formatter={(value, _entry, idx) => <span style={{ opacity: dim(idx) }}>{value}</span>}
    />
  );
  const tip = <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} content={<MultiTooltip tickFmt={tickFmt} />} />;

  let chart;
  if (op === "line" || op === "area") {
    const Container = op === "area" ? AreaChart : LineChart;
    chart = (
      <Container width={width} height={chartH} data={data} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => op === "area"
          ? <Area key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />
          : <Line key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />)}
      </Container>
    );
  } else if (op === "bar") {
    chart = (
      <BarChart width={width} height={chartH} data={data} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} domain={yDomain} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={40} tickFormatter={tickFmt} interval={catInterval} />}
        {tip}{legend}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  } else if (op === "radar") {
    // Radar spokes carry incommensurable units (a $ column beside /10 scores), so unless the
    // author asked for a shared radius, normalize each spoke (data row) to [0,1] by its own
    // MAX (÷max, not min/max) and plot `_n{j}`; proportional, so the weakest option keeps its
    // real fraction of the axis rather than collapsing to the centre. Raw `s{j}` stays on the
    // row for the tooltip.
    const radarNorm = (opts?.radarscale ?? "axis") === "axis";
    const rData = !radarNorm ? data : data.map((row) => {
      const hi = series.reduce((m, _, j) => { const x = row[`s${j}`]; return x == null ? m : Math.max(m, Math.abs(x)); }, 0);
      const out = { ...row };
      series.forEach((_, j) => { const rv = row[`s${j}`]; out[`_n${j}`] = rv == null ? null : hi > 0 ? rv / hi : 0; });
      return out;
    });
    const key = (j: number) => (radarNorm ? `_n${j}` : `s${j}`);
    const radarTip = <Tooltip isAnimationActive={false} content={<MultiTooltip tickFmt={tickFmt} rawFromNorm={radarNorm} />} />;
    chart = (
      <RadarChart width={width} height={chartH} data={rData} cx="50%" cy="50%" outerRadius="68%">
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="i" tick={AXIS} tickFormatter={tickFmt} />
        {/* Radial ticks print rotated ON the polygons; the tooltip carries the raw value. */}
        <PolarRadiusAxis tick={false} axisLine={false} tickCount={4} domain={radarNorm ? [0, 1] : yDomain} />
        {radarTip}{legend}
        {series.map((s, j) => <Radar key={j} dataKey={key(j)} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} isAnimationActive={false} />)}
      </RadarChart>
    );
  } else if (op === "scatter") {
    // Each series a cloud; a numeric label column places points at their real x.
    const numericX = !!labels && data.length > 0 && data.every((d) => typeof labels![d.i as number] === "number");
    const catX = catDomain(numericX ? [] : data.map((d) => d.i as number));
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} tickFormatter={numericX ? (t) => axisTick(Number(t)) : tickFmt} allowDecimals={numericX ? undefined : false} domain={catX.domain} ticks={catX.ticks} padding={catX.padding} />}
        {axes && <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => (
          <Scatter key={j} name={s.name} fill={paint(j)} fillOpacity={dim(j)} shape={dot} isAnimationActive={false}
            data={data.map((d) => ({ x: numericX ? Number(labels![d.i as number]) : (d.i as number), y: d[`s${j}`] }))} />
        ))}
      </ScatterChart>
    );
  } else {
    // column (the default cartesian) — grouped vertical bars.
    chart = (
      <BarChart width={width} height={chartH} data={data} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  }

  // Inside a card, rete's drag handler takes pointer capture on mousedown, which would
  // deliver the click to the node instead of the legend item — so a press that starts on
  // the legend never reaches rete (the same swallow every in-card control uses).
  const legendPress = (e: SyntheticEvent) => {
    if ((e.target as Element | null)?.closest?.(".recharts-legend-wrapper")) e.stopPropagation();
  };
  const withLegendGuard = (el: ReactElement) => (
    <div style={{ width }} onPointerDown={legendPress} onMouseDown={legendPress}>{el}</div>
  );
  if (!title) return withLegendGuard(chart);
  return withLegendGuard(
    <>
      <ChartTitle text={title} fs={fs} />
      {chart}
    </>,
  );
}

/** Several charts overlaid on ONE cartesian plane (the Merge Plots node): each series
 *  draws in its OWN mark kind (line / area / column / bar / scatter) and keeps the color,
 *  marker size, line width and fill alpha it inherited from its source chart. Legend +
 *  click-to-spotlight match MultiSeriesView; a series with no inherited color takes the
 *  palette. */
export function OverlayView({ payload, width, height, opts, fontScale }: {
  payload: OverlayPayload;
  width: number; height: number; opts?: ChartOptions; fontScale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const series = payload.series;
  const labels = payload.labels;
  const paint = (j: number) => series[j]?.color || colors[j % colors.length];
  const [focus, setFocus] = useState<number | null>(null);
  const dim = (j: number) => (focus !== null && focus !== j ? 0.18 : 1);
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const data = Array.from({ length: n }, (_, i) => {
    const o: Record<string, number | null> = { i };
    series.forEach((s, j) => { o[`s${j}`] = num(s.values[i]); });
    return o;
  });
  const tickFmt = (i: number | string) => {
    const idx = Math.round(Number(i));
    if (!Number.isFinite(idx)) return "";
    if (labels) { const lab = labels[idx]; return lab == null || typeof lab === "object" ? "" : typeof lab === "number" ? axisTick(lab) : String(lab); }
    return idx >= 0 ? String(idx + 1) : "";
  };
  const showGrid = opts?.grid ?? true;
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const title = opts?.title;
  const titleH = title ? titleHeight(fs) : 0;
  const chartH = height - titleH;
  const margin = { top: PLOT_TOP, right: 8, bottom: 4, left: 0 };
  const legend = (
    <Legend
      verticalAlign="bottom" height={LEGEND_H} iconSize={8}
      wrapperStyle={{ fontSize: 9 * fs, color: axis, cursor: "pointer" }}
      // Focus by dataKey (`s{j}`), not name — merged series names can collide.
      onClick={(e) => { const j = Number(String((e as { dataKey?: unknown }).dataKey ?? "").replace(/^s/, "")); if (Number.isInteger(j)) setFocus((f) => (f === j ? null : j)); }}
      formatter={(value, _entry, idx) => <span style={{ opacity: dim(idx) }}>{value}</span>}
    />
  );
  const tip = <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} content={<MultiTooltip tickFmt={tickFmt} />} />;

  const chart = (
    <ComposedChart width={width} height={chartH} data={data} margin={margin}>
      {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
      <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} allowDuplicatedCategory={false} />
      <YAxis tick={AXIS} tickLine={false} width={26} domain={yDomain} />
      {tip}{legend}
      {series.map((s, j) => {
        const c = paint(j);
        const o = dim(j);
        const lw = s.linewidth ?? opts?.linewidth ?? 1.5;
        const fillAlpha = (s.alpha ?? 0.25) * o;
        const lineDotR = s.markersize ?? LINE_DOT_R;
        if (s.kind === "line") {
          return <Line key={j} dataKey={`s${j}`} name={s.name} stroke={c} strokeOpacity={o} strokeWidth={lw} dot={s.marker ? { r: lineDotR } : false} isAnimationActive={false} />;
        }
        if (s.kind === "area") {
          return <Area key={j} dataKey={`s${j}`} name={s.name} stroke={c} strokeOpacity={o} fill={c} fillOpacity={fillAlpha} strokeWidth={lw} dot={s.marker ? { r: lineDotR } : false} isAnimationActive={false} />;
        }
        if (s.kind === "scatter") {
          return <Scatter key={j} dataKey={`s${j}`} name={s.name} fill={c} fillOpacity={o} shape={scatterDot(s.markersize ?? SCATTER_DOT_R)} isAnimationActive={false} />;
        }
        // column / bar — both draw as vertical bars so they share the x-axis.
        return <Bar key={j} dataKey={`s${j}`} name={s.name} fill={c} fillOpacity={(s.alpha ?? 1) * o} isAnimationActive={false} />;
      })}
    </ComposedChart>
  );

  // Same legend-press swallow as MultiSeriesView — rete's drag would otherwise eat the click.
  const legendPress = (e: SyntheticEvent) => {
    if ((e.target as Element | null)?.closest?.(".recharts-legend-wrapper")) e.stopPropagation();
  };
  const wrap = (el: ReactElement) => <div style={{ width }} onPointerDown={legendPress} onMouseDown={legendPress}>{el}</div>;
  if (!title) return wrap(chart);
  return wrap(
    <>
      <ChartTitle text={title} fs={fs} />
      {chart}
    </>,
  );
}

type TreemapCellProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string; colors?: string[]; fscale?: number;
};
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "", colors = [], fscale = 1 }: TreemapCellProps) {
  const fill = colors[index % (colors.length || 1)] || "var(--accent)";
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="var(--surface)" strokeWidth={1} />
      {width > 46 * fscale && height > 20 * fscale ? (
        <text x={x + 5} y={y + 5 + 10 * fscale} fontSize={10 * fscale} fill="#fff" style={{ pointerEvents: "none" }}>{name}</text>
      ) : null}
    </g>
  );
}

export function TreemapView({ names, values, width, height, fscale = 1 }: {
  names: string[]; values: number[]; width: number; height: number; fscale?: number;
}) {
  const colors = useSeriesColors();
  const data = names
    .map((n, i) => ({ name: n || `#${i + 1}`, size: Math.max(0, values[i] ?? 0) }))
    .filter((d) => d.size > 0);
  if (data.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return (
    // recharts 3.x: `content` must be a FUNCTION to receive each node's geometry —
    // a static element renders once with no geometry and every rect collapses to 0×0.
    <Treemap width={width} height={height} data={data} dataKey="size" isAnimationActive={false} content={(props) => <TreemapCell {...props} colors={colors} fscale={fscale} />}>
      {SLICE_TIP}
    </Treemap>
  );
}

// recharts needs numeric source/target indices into the nodes array, and its layout
// assumes a DAG — cycles and self-loops are dropped.
type SankeyNodeProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; payload?: { name?: string }; colors?: string[]; containerWidth?: number; fscale?: number;
};
function SankeyNodeShape({ x = 0, y = 0, width = 0, height = 0, index = 0, payload, colors = [], containerWidth = 0, fscale = 1 }: SankeyNodeProps) {
  const fill = colors[index % (colors.length || 1)] || "var(--accent)";
  const rightHalf = x > containerWidth / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={1} />
      <text
        x={rightHalf ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={rightHalf ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={10 * fscale}
        fill="var(--text)"
        style={{ pointerEvents: "none" }}
      >{payload?.name}</text>
    </g>
  );
}

export function SankeyView({ sources, targets, values, width, height, fscale = 1 }: {
  sources: string[]; targets: string[]; values: number[]; width: number; height: number; fscale?: number;
}) {
  const colors = useSeriesColors();
  const { grid } = useChartColors();
  const nameToIdx = new Map<string, number>();
  const nodes: { name: string }[] = [];
  const idx = (n: string) => {
    let i = nameToIdx.get(n);
    if (i === undefined) { i = nodes.length; nameToIdx.set(n, i); nodes.push({ name: n }); }
    return i;
  };
  const links: { source: number; target: number; value: number }[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] ?? "";
    const t = targets[i] ?? "";
    const v = values[i] ?? 0;
    if (!s || !t || s === t || !(v > 0)) continue; // skip blanks / self-loops / non-positive
    links.push({ source: idx(s), target: idx(t), value: v });
  }
  if (links.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return (
    <Sankey
      width={width}
      height={height}
      data={{ nodes, links }}
      nodePadding={16}
      nodeWidth={10}
      link={{ stroke: grid, strokeOpacity: 0.5 }}
      // Function form so each node receives its geometry (as with Treemap's content),
      // and containerWidth passed through because recharts' node props omit it —
      // without it every node reads as "right half" and left labels fly off-canvas.
      node={(props) => <SankeyNodeShape {...props} colors={colors} containerWidth={width} fscale={fscale} />}
      // Labels sit INWARD, so no wide outer gutter is needed.
      margin={{ top: 6, right: 10, bottom: 6, left: 10 }}
    >
      {SLICE_TIP}
    </Sankey>
  );
}

// Each COLUMN is a series over the row index: column 0 bars, the rest lines.
// One BAR series (column 0) plus a LINE per remaining series — the named columns of a
// frame, the C2 replacement for the old Series matrix socket.
export function ComposedView({ series, labels, width, height, opts, fscale = 1 }: {
  series: { name: string; values: (number | null)[] }[];
  /** X-axis category labels (Frame col 0), as every other cartesian op reads them. */
  labels?: (string | number)[];
  width: number; height: number; opts?: ChartOptions; fscale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9 * fscale, fill: axis } as const;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const data = Array.from({ length: n }, (_, i) => {
    const o: Record<string, number | null> = { i };
    series.forEach((s, j) => { o[`s${j}`] = num(s.values[i]); });
    return o;
  });
  const tickFmt = (i: number | string) => {
    const idx = Math.round(Number(i));
    if (!Number.isFinite(idx)) return "";
    if (labels) { const lab = labels[idx]; return lab == null || typeof lab === "object" ? "" : typeof lab === "number" ? axisTick(lab) : String(lab); }
    return idx >= 0 ? String(idx + 1) : "";
  };
  const lw = opts?.linewidth ?? 1.5;
  const showMarkers = opts?.marker ?? false;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const title = opts?.title;
  const chartH = height - (title ? titleHeight(fscale) : 0);
  const chart = (
    <ComposedChart width={width} height={chartH} data={data} margin={{ top: PLOT_TOP, right: 8, bottom: 4, left: 0 }}>
      <CartesianGrid stroke={grid} vertical={false} />
      <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={n <= ALL_TICKS_UPTO ? 0 : undefined} />
      <YAxis tick={AXIS} tickLine={false} width={26} />
      <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} content={<MultiTooltip tickFmt={tickFmt} />} />
      {series.length > 1 && <Legend verticalAlign="bottom" height={LEGEND_H} iconSize={8} wrapperStyle={{ fontSize: 9 * fscale, color: axis }} />}
      {series.map((s, j) => j === 0
        ? <Bar key={j} dataKey={`s${j}`} name={s.name} fill={colors[j % colors.length]} isAnimationActive={false} />
        : <Line key={j} dataKey={`s${j}`} name={s.name} stroke={colors[j % colors.length]} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />)}
    </ComposedChart>
  );
  if (!title) return chart;
  return <div style={{ width }}><ChartTitle text={title} fs={fscale} />{chart}</div>;
}

// Nothing else on a bubble plot says which column is which: the tooltip names all three.
function BubbleTooltip({ active, payload, names }: {
  active?: boolean;
  payload?: { payload?: { x?: number; y?: number | null; z?: number } }[];
  names: { x?: string; y?: string; z?: string };
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const row = (name: string | undefined, v: number | null | undefined) => (v == null ? null : (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "var(--text-dim)" }}>{name}</span>
      <span style={{ marginLeft: "auto" }}>{tipValue(v)}</span>
    </div>
  ));
  return (
    <div style={{ fontSize: 11, padding: "3px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      {row(names.x, d.x)}
      {row(names.y, d.y)}
      {row(names.z, d.z)}
    </div>
  );
}

// The first three NUMBER series are x / y / size columns, one dot per row (a frame's
// first three number columns; a single column plots against itself).
export function BubbleView({ series, width, height, opts, fscale = 1 }: {
  series: { name: string; values: (number | null)[] }[]; width: number; height: number; opts?: ChartOptions; fscale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9 * fscale, fill: axis } as const;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const xs = series[0]?.values ?? [], ys = series[1]?.values ?? [], zs = series[2]?.values ?? [];
  const n = Math.max(xs.length, ys.length);
  const data = Array.from({ length: n }, (_, i) => {
    const x = num(xs[i]);
    return { x: x ?? i, y: series.length >= 2 ? num(ys[i]) : x, z: num(zs[i]) ?? 1 };
  }).filter((d) => d.y !== null);
  if (data.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  const names = { x: opts?.xlabel ?? series[0]?.name, y: opts?.ylabel ?? series[1]?.name, z: series[2]?.name };
  const xLabel = names.x ? { value: names.x, position: "insideBottom" as const, offset: -3, fontSize: 10 * fscale, fill: axis } : undefined;
  const yLabel = names.y ? { value: names.y, angle: -90, position: "insideLeft" as const, fontSize: 10 * fscale, fill: axis } : undefined;
  const title = opts?.title;
  const chartH = height - (title ? titleHeight(fscale) : 0);
  const chart = (
    <ScatterChart width={width} height={chartH} margin={{ top: PLOT_TOP, right: 12, bottom: xLabel ? 18 : 4, left: 0 }}>
      <CartesianGrid stroke={grid} />
      <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} label={xLabel} height={xLabel ? 28 : undefined} />
      <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} width={yLabel ? 40 : 26} label={yLabel} />
      <ZAxis type="number" dataKey="z" range={[40, 420]} />
      <Tooltip isAnimationActive={false} cursor={{ strokeDasharray: "3 3", stroke: "rgba(128,128,128,0.5)" }} content={<BubbleTooltip names={names} />} />
      <Scatter data={data} fill={colors[0]} fillOpacity={0.55} isAnimationActive={false} />
    </ScatterChart>
  );
  if (!title) return chart;
  return <div style={{ width }}><ChartTitle text={title} fs={fscale} />{chart}</div>;
}

// `pct` is 0–100; `size` is the square drawn into, cropped to its top half by the caller.
export function GaugeArc({ pct, track, size }: { pct: number; track: string; size: number }) {
  const { viz } = useChartColors();
  return (
    <RadialBarChart
      width={size}
      height={size}
      cx="50%"
      cy="50%"
      innerRadius="72%"
      outerRadius="94%"
      barSize={14}
      data={[{ value: pct }]}
      startAngle={180}
      endAngle={0}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
      <RadialBar background={{ fill: track }} dataKey="value" cornerRadius={7} fill={viz} angleAxisId={0} isAnimationActive={false} />
    </RadialBarChart>
  );
}

const RISING = "#e0524d";
const FALLING = "#4c8bf5";
// A diverged leaf has no finite swing — muted full width, so it reads as "off the
// chart" rather than as a magnitude comparable to the colored swings.
const DIVERGED = "var(--text-dim)";

export type TornadoBar = {
  label: string; offset: number; range: number; rising: boolean;
  diverged?: boolean;
  // Carried so the readout can show the RAW swing against the perturbation width.
  outLow?: number; outHigh?: number; inLow?: number; inHigh?: number; basis?: "slider" | "number";
};

// Shows the basis (slider full-range vs number ±10%) so a wide bar isn't mistaken
// for a like-for-like comparison against a narrow number nudge.
function TornadoTooltip({ active, payload }: { active?: boolean; payload?: { payload?: TornadoBar }[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const dim = { color: "var(--text-dim)" };
  return (
    <div style={{ fontSize: 11, padding: "3px 7px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div>
        output{" "}
        {d.diverged
          ? "diverged (non-finite)"
          : `${formatScalar(d.outLow ?? 0)} → ${formatScalar(d.outHigh ?? 0)}`}
      </div>
      {typeof d.inLow === "number" && typeof d.inHigh === "number" && (
        <div style={dim}>
          input {formatScalar(d.inLow)} → {formatScalar(d.inHigh)}{" "}
          ({d.basis === "slider" ? "slider range" : "±10%"})
        </div>
      )}
    </div>
  );
}

// Matches ChartNode's W; exported so the Suspense fallback reserves the same width.
export const TORNADO_W = 218;

export function TornadoBars({ data, grid, axis }: { data: TornadoBar[]; grid: string; axis: string }) {
  return (
    <BarChart
      width={TORNADO_W}
      height={Math.max(70, data.length * 22 + 16)}
      data={data}
      layout="vertical"
      margin={{ top: 2, right: 10, bottom: 2, left: 2 }}
    >
      <CartesianGrid stroke={grid} horizontal={false} />
      <XAxis type="number" tick={{ fontSize: 9, fill: axis }} tickLine={false} />
      <YAxis type="category" dataKey="label" width={64} tick={{ fontSize: 9, fill: axis }} tickLine={false} />
      <Tooltip isAnimationActive={false} content={<TornadoTooltip />} />
      <Bar dataKey="offset" stackId="tornado" fill="transparent" isAnimationActive={false} />
      <Bar dataKey="range" stackId="tornado" isAnimationActive={false}>
        {data.map((d, i) => <Cell key={i} fill={d.diverged ? DIVERGED : d.rising ? RISING : FALLING} fillOpacity={d.diverged ? 0.4 : 1} />)}
      </Bar>
    </BarChart>
  );
}
