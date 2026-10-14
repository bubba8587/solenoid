// [[C100]] chartIsAValue
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadialBarChart, RadialBar, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadarChart, Radar, PieChart, Pie, ScatterChart, Scatter, FunnelChart, Funnel, LabelList, Cell, Treemap, Sankey, ComposedChart, ReferenceLine, ReferenceArea } from "recharts";
import { type SyntheticEvent, type ComponentProps, useId, type ReactElement } from "react";
import "./chartView.css";
import { formatScalar } from "./format";
import { useChartColors, useSeriesColors, axisTick, compactTick, valueAxisWidth, valueTickFormat, categoryAxisWidth, niceTicks, logTicks, legendRows, dateTicks, partSlices, useSeriesSpotlight, minMaxDecimate, type ChartShape } from "./chartCore";
import type { ChartOptions, LineStyle } from "../nodes/chartOptions";
import type { OverlayPayload, XYPayload, XYPoint, ChartRef } from "../chartValue";
import { formatDateSerial } from "../nodes/dateSerial";
import { formatFrameCell } from "../frame";
import { heightRampColor, resolveColor, PALETTE } from "../palette";
import { colormapRgb } from "../colormaps";
import { ChartTitle, titleHeight } from "./chartTitle";
import { iterMin, iterMax } from "../nodes/mathUtils";

const LINE_DOT_R = 2;
const SCATTER_DOT_R = 3;
const PLOT_TOP = 14;
const ALL_TICKS_UPTO = 12;

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

// An object value must become a string here, or React throws on it as a child.
function tipValue(v: unknown): string {
  if (typeof v === "number") return formatScalar(v);
  if (v == null) return "";
  if (typeof v === "object") return String((v as { code?: string }).code ?? "—");
  return String(v);
}

const TIP = <Tooltip isAnimationActive={false} cursor={{ stroke: "rgba(128,128,128,0.5)", fill: "rgba(128,128,128,0.12)" }} content={<ChartTooltip />} />;

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
export function sanitizeChartLabel(raw: string, cap = 16): string {
  let clean = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    clean += (c !== undefined && (c < 0x20 || (c >= 0x7f && c <= 0x9f))) ? " " : ch;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  const cps = [...clean]; // code points, so the cap never splits a surrogate pair
  return cps.length > cap ? `${cps.slice(0, cap - 1).join("").trimEnd()}…` : clean;
}

function yDomainOf(opts: ChartOptions | undefined): [number | string, number | string] | undefined {
  return opts?.ymin !== undefined || opts?.ymax !== undefined ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] : undefined;
}

export function ChartView({
  op, series: given, width, height, axes, opts, signColors, labels, fontScale, refs,
}: {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
  signColors?: { pos: string; neg: string };
  labels?: (string | number)[];
  fontScale?: number;
  refs?: readonly ChartRef[];
}) {
  const { grid, axis, viz } = useChartColors();
  const seriesColors = useSeriesColors();
  const series = op === "line" || op === "area" ? minMaxDecimate(given, width) : given;
  const paint = (i: number) => seriesColors[i % seriesColors.length];
  // A Pie, Funnel or Radial slice spotlights on a click, as a legend entry does on a multi-series chart.
  const { dim: sliceDim, pick: pickSlice } = useSeriesSpotlight(series.map((d) => String(d.i)));
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  // A numeric index axis hands back fractional ticks (0.5, 1.5), so round to a datum.
  const tickFmt = (i: number | string) => {
    const n = Number(i);
    if (!Number.isFinite(n)) return "";
    const idx = Math.round(n);
    if (labels) {
      const lab = labels[idx];
      if (lab == null || typeof lab === "object") return "";
      return typeof lab === "number" ? axisTick(lab) : String(lab);
    }
    return idx >= 0 ? String(idx + 1) : "";
  };

  const color = opts?.color || viz;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? axes;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const fillAlpha = opts?.alpha ?? 0.25;
  const yDomain = yDomainOf(opts);
  const xLabel = axes && opts?.xlabel
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis }
    : undefined;
  const title = opts?.title;
  const titleH = title ? titleHeight(fs) : 0;
  const chartH = height - titleH;
  const yFmt = valueTickFormat([...series.map((d) => d.v), opts?.ymin, opts?.ymax]);
  const yAxisW = axes ? valueAxisWidth([...series.map((d) => d.v), opts?.ymin, opts?.ymax], fs, !!yLabel, yFmt) : 0;
  const bottomM = axes ? (xLabel ? 18 : 4) : 2;
  const margin = axes ? { top: PLOT_TOP, right: 8, bottom: bottomM, left: 0 } : { top: 2, right: 2, bottom: 2, left: 2 };
  const catInterval = series.length <= ALL_TICKS_UPTO ? 0 : undefined;
  const refCtx = { axis, fs, xLo: 0, xHi: Math.max(1, (labels?.length ?? series.length) - 1), pw: width - yAxisW - 8 };
  const refEls = refMarks(refs, categoryAt(labels), refCtx);
  const refElsSwap = refMarks(refs, categoryAt(labels), { ...refCtx, swap: true });

  let chart;
  if (op === "line") {
    chart = (
      <LineChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />}
        {axes && refEls}
        {TIP}
        <Line dataKey="v" stroke={color} strokeOpacity={opts?.alpha ?? 1} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </LineChart>
    );
  } else if (op === "area") {
    chart = (
      <AreaChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />}
        {axes && refEls}
        {TIP}
        <Area dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </AreaChart>
    );
  } else if (op === "bar") {
    const catW = categoryAxisWidth(series.map((d) => tickFmt(d.i)), width, fs, !!yLabel);
    chart = (
      <BarChart width={width} height={chartH} data={series} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} tickFormatter={yFmt} domain={yDomain} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={catW} tickFormatter={tickFmt} interval={catInterval} label={yLabel} />}
        {axes && refElsSwap}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={fillAlpha < 1 && opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  } else if (op === "pie") {
    const slices = partSlices(op, series);
    const pieMode = opts?.pielabels ?? "outside";
    const labeled = !!labels && pieMode !== "off";
    const pad = !labeled ? 6 : pieMode === "inside" ? Math.min(16, width * 0.07) : Math.min(30, width * 0.12);
    const r = Math.max(18, Math.min(width, chartH) / 2 - pad);
    const cap = width < 260 ? 10 : 16;
    const stub = 7;
    const font = 9 * fs;
    const pieLabel = (p: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; index?: number; percent?: number; payload?: unknown }) => {
      const cx = p.cx ?? 0, cy = p.cy ?? 0, mid = p.midAngle ?? 0, outerR = p.outerRadius ?? 0, index = p.index ?? 0;
      const rowI = (p.payload as { i?: number } | undefined)?.i ?? slices[index]?.i ?? index;
      const name = sanitizeChartLabel(tickFmt(rowI), cap);
      const pct = p.percent ?? 0;
      if (!name || pct < 0.03) return null;
      const cos = Math.cos(-mid * RADIAN), sin = Math.sin(-mid * RADIAN);
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
      const sx = cx + outerR * cos, sy = cy + outerR * sin;
      const mx = cx + (outerR + stub) * cos, my = cy + (outerR + stub) * sin;
      const colX = cx + (outerR + stub) * side;
      return (
        <g>
          <polyline points={`${sx},${sy} ${mx},${my} ${colX},${my}`} stroke={grid} fill="none" />
          <text x={colX + side * 3} y={my} fill={axis} fontSize={font} textAnchor={side > 0 ? "start" : "end"} dominantBaseline="central">{name}</text>
        </g>
      );
    };
    chart = (
      <PieChart width={width} height={chartH}>
        <Pie data={slices} dataKey="v" nameKey="i" cx="50%" cy="50%" outerRadius={r} stroke="var(--surface)" isAnimationActive={false}
             label={labeled ? pieLabel : undefined} labelLine={false} onClick={(_e, k) => pickSlice(slices[k]?.i ?? -1)}>
          {slices.map((d) => <Cell key={d.i} fill={paint(d.i)} fillOpacity={sliceDim(d.i)} className="sol-slice" />)}
        </Pie>
        {SLICE_TIP}
      </PieChart>
    );
  } else if (op === "radar") {
    chart = (
      <RadarChart width={width} height={chartH} data={series} cx="50%" cy="50%" outerRadius="72%">
        {(opts?.grid ?? true) && <PolarGrid stroke={grid} />}
        <PolarAngleAxis dataKey="i" tick={AXIS} tickFormatter={tickFmt} />
        {/* Radial tick text would print rotated on the polygon. */}
        <PolarRadiusAxis tick={false} axisLine={false} tickCount={4} domain={yDomain} />
        {TIP}
        {/* The palette, never `color`. */}
        <Radar dataKey="v" stroke={paint(0)} fill={paint(0)} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: dotR } : false} />
      </RadarChart>
    );
  } else if (op === "radialbar") {
    // recharts reads a radial legend's `name` and `fill` off the chart data.
    const rings = partSlices(op, series).map((d) => ({ ...d, name: sanitizeChartLabel(tickFmt(d.i)), fill: paint(d.i) }));
    chart = (
      <RadialBarChart width={width} height={chartH} cx="50%" cy="50%" innerRadius="18%" outerRadius="92%" data={rings} startAngle={90} endAngle={-270}>
        <RadialBar dataKey="v" background={{ fill: grid }} cornerRadius={3} isAnimationActive={false} onClick={(_e, k) => pickSlice(rings[k]?.i ?? -1)}>
          {rings.map((d) => <Cell key={d.i} fill={d.fill} fillOpacity={sliceDim(d.i)} className="sol-slice" />)}
        </RadialBar>
        {labels && <Legend verticalAlign="bottom" height={LEGEND_H} iconSize={8} wrapperStyle={{ fontSize: 9 * fs, color: axis }} />}
        {SLICE_TIP}
      </RadialBarChart>
    );
  } else if (op === "funnel") {
    const stages = partSlices(op, series);
    chart = (
      <FunnelChart width={width} height={chartH}>
        {SLICE_TIP}
        <Funnel dataKey="v" data={stages} isAnimationActive={false} onClick={(_e: unknown, k: number) => pickSlice(stages[k]?.i ?? -1)}>
          <LabelList position="right" dataKey="v" fill={axis} stroke="none" fontSize={10 * fs} />
          {stages.map((d) => <Cell key={d.i} fill={paint(d.i)} fillOpacity={sliceDim(d.i)} className="sol-slice" />)}
        </Funnel>
      </FunnelChart>
    );
  } else {
    chart = (
      <BarChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />}
        {axes && refEls}
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

function MultiTooltip({ active, payload, label, tickFmt, rawFromNorm }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, number | null> }[];
  label?: number | string;
  tickFmt: (i: number | string) => string;
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
const MULTI_LEGEND_H = 18;
// A legend takes at most a quarter of its figure's height, so a card-sized chart keeps its plot.
const legendCap = (height: number) => Math.max(1, Math.floor(height / 4 / MULTI_LEGEND_H));

function SeriesLegend({ series, paint, dim, onPick, fs, color, insetLeft, insetRight, isLine, rows = 1 }: {
  series: { name: string }[];
  paint: (j: number) => string;
  dim: (j: number) => number;
  onPick: (j: number) => void;
  fs: number; color: string; insetLeft: number; insetRight: number; isLine: (j: number) => boolean;
  rows?: number;
}) {
  return (
    <div
      className="sol-chart-legend"
      style={{ height: rows * MULTI_LEGEND_H, paddingLeft: insetLeft, paddingRight: insetRight, display: "flex", flexWrap: "wrap", alignItems: "center", alignContent: "flex-start", justifyContent: "center", columnGap: 10, rowGap: 0, fontSize: 9 * fs, color, lineHeight: 1, overflow: "hidden", cursor: "pointer", userSelect: "none" }}
    >
      {series.map((s, j) => (
        <span key={j} onClick={() => onPick(j)} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: MULTI_LEGEND_H, whiteSpace: "nowrap", opacity: dim(j) }}>
          <span aria-hidden="true" style={{ width: 8, height: isLine(j) ? 2 : 8, borderRadius: isLine(j) ? 1 : 2, background: paint(j), flex: "none" }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function MultiSeriesView({
  op, series, labels, width, height, axes, opts, fontScale, refs,
}: {
  op: ChartShape;
  series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[];
  width: number; height: number; axes: boolean;
  opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[];
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const paint = (j: number) => colors[j % colors.length];
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  const xLabel = axes && opts?.xlabel
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis }
    : undefined;
  const yFmt = valueTickFormat([...series.flatMap((s) => s.values), opts?.ymin, opts?.ymax]);
  const yAxisW = valueAxisWidth([...series.flatMap((s) => s.values), opts?.ymin, opts?.ymax], fs, !!yLabel, yFmt);
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
  const fillAlpha = opts?.alpha ?? (op === "area" && series.length >= 2 ? 0.18 : 0.25);
  const markAlpha = opts?.alpha ?? 1;
  const yDomain = yDomainOf(opts);
  const title = opts?.title;
  const titleH = title ? titleHeight(fs) : 0;
  const margin = { top: axes ? PLOT_TOP : 6, right: 8, bottom: axes ? 4 : 2, left: 0 };
  const catInterval = n <= ALL_TICKS_UPTO ? 0 : undefined;
  const catW = op === "bar" ? categoryAxisWidth(data.map((d) => tickFmt(d.i as number)), width, fs, !!yLabel) : 0;
  const legendInsetLeft = op === "radar" ? 0 : op === "bar" ? catW : yAxisW;
  const legendInsetRight = op === "radar" ? 0 : margin.right;
  const legendN = legendRows(series.map((s) => s.name), width - legendInsetLeft - legendInsetRight, fs, legendCap(height));
  const refCtx = { axis, fs, xLo: 0, xHi: Math.max(1, n - 1), pw: width - legendInsetLeft - legendInsetRight };
  const refEls = refMarks(refs, categoryAt(labels), refCtx);
  const refElsSwap = refMarks(refs, categoryAt(labels), { ...refCtx, swap: true });
  const chartH = height - titleH - legendN * MULTI_LEGEND_H;
  const legend = (
    <SeriesLegend
      series={series} paint={paint} dim={dim} fs={fs} color={axis} rows={legendN}
      insetLeft={legendInsetLeft} insetRight={legendInsetRight}
      isLine={() => op === "line"}
      onPick={pick}
    />
  );
  const tip = <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} content={<MultiTooltip tickFmt={tickFmt} />} />;

  let chart;
  if (op === "line" || op === "area") {
    const Container = op === "area" ? AreaChart : LineChart;
    chart = (
      <Container width={width} height={chartH} data={data} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />}
        {axes && refEls}
        {tip}
        {series.map((s, j) => op === "area"
          ? <Area key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />
          : <Line key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={markAlpha * dim(j)} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />)}
      </Container>
    );
  } else if (op === "bar") {
    chart = (
      <BarChart width={width} height={chartH} data={data} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} tickFormatter={yFmt} domain={yDomain} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={catW} tickFormatter={tickFmt} interval={catInterval} label={yLabel} />}
        {axes && refElsSwap}
        {tip}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={markAlpha * dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  } else if (op === "radar") {
    const radarNorm = (opts?.radarscale ?? "axis") === "axis";
    const rData = !radarNorm ? data : data.map((row) => {
      const hi = series.reduce((m, _, j) => { const x = row[`s${j}`]; return x == null ? m : Math.max(m, x); }, 0);
      const out = { ...row };
      series.forEach((_, j) => { const rv = row[`s${j}`]; out[`_n${j}`] = rv == null ? null : hi > 0 ? Math.max(0, rv / hi) : 0; });
      return out;
    });
    const key = (j: number) => (radarNorm ? `_n${j}` : `s${j}`);
    const radarTip = <Tooltip isAnimationActive={false} content={<MultiTooltip tickFmt={tickFmt} rawFromNorm={radarNorm} />} />;
    chart = (
      <RadarChart width={width} height={chartH} data={rData} cx="50%" cy="50%" outerRadius="68%">
        {(opts?.grid ?? true) && <PolarGrid stroke={grid} />}
        <PolarAngleAxis dataKey="i" tick={AXIS} tickFormatter={tickFmt} />
        {/* Radial tick text would print rotated on the polygons. */}
        <PolarRadiusAxis tick={false} axisLine={false} tickCount={4} domain={radarNorm ? [0, 1] : yDomain} />
        {radarTip}
        {series.map((s, j) => <Radar key={j} dataKey={key(j)} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} dot={showMarkers ? { r: dotR } : false} isAnimationActive={false} />)}
      </RadarChart>
    );
  } else {
    chart = (
      <BarChart width={width} height={chartH} data={data} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} interval={catInterval} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />}
        {axes && refEls}
        {tip}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={markAlpha * dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  }

  // rete's drag takes pointer capture on mousedown and would steal the legend's click.
  const legendPress = (e: SyntheticEvent) => {
    if ((e.target as Element | null)?.closest?.(".sol-chart-legend")) e.stopPropagation();
  };
  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      {chart}
      {legend}
    </div>
  );
}

export function OverlayView({ payload, width, height, opts, fontScale, refs }: {
  payload: OverlayPayload;
  width: number; height: number; opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[];
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const series = payload.series;
  const labels = payload.labels;
  const paint = (j: number) => series[j]?.color || colors[j % colors.length];
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
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
  const xLabel = opts?.xlabel ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis } : undefined;
  const yLabel = opts?.ylabel ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis } : undefined;
  const margin = { top: PLOT_TOP, right: 8, bottom: xLabel ? 18 : 4, left: 0 };
  const yFmt = valueTickFormat([...series.flatMap((s) => s.values), opts?.ymin, opts?.ymax]);
  const yAxisW = valueAxisWidth([...series.flatMap((s) => s.values), opts?.ymin, opts?.ymax], fs, !!yLabel, yFmt);
  const legendN = legendRows(series.map((s) => s.name), width - yAxisW - margin.right, fs, legendCap(height));
  const refEls = refMarks(refs, categoryAt(payload.labels), { axis, fs, xLo: 0, xHi: Math.max(1, (payload.labels?.length ?? 1) - 1), pw: width - yAxisW - margin.right });
  const chartH = height - titleH - legendN * MULTI_LEGEND_H;
  const legend = (
    <SeriesLegend
      series={series} paint={paint} dim={dim} fs={fs} color={axis} rows={legendN}
      insetLeft={yAxisW} insetRight={margin.right}
      isLine={(j) => series[j]?.kind === "line"}
      onPick={pick}
    />
  );
  const tip = <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} content={<MultiTooltip tickFmt={tickFmt} />} />;

  const chart = (
    <ComposedChart width={width} height={chartH} data={data} margin={margin}>
      {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
      <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} allowDuplicatedCategory={false} label={xLabel} height={xLabel ? 28 : undefined} />
      <YAxis tick={AXIS} tickLine={false} tickFormatter={yFmt} width={yAxisW} domain={yDomain} label={yLabel} />
      {refEls}
      {tip}
      {series.map((s, j) => {
        const c = paint(j);
        const o = dim(j);
        const lw = s.linewidth ?? opts?.linewidth ?? 1.5;
        const fillAlpha = (s.alpha ?? 0.25) * o;
        const lineDotR = s.markersize ?? LINE_DOT_R;
        if (s.kind === "line") {
          return <Line key={j} dataKey={`s${j}`} name={s.name} stroke={c} strokeOpacity={(s.alpha ?? 1) * o} strokeWidth={lw} dot={s.marker ? { r: lineDotR } : false} isAnimationActive={false} />;
        }
        if (s.kind === "area") {
          return <Area key={j} dataKey={`s${j}`} name={s.name} stroke={c} strokeOpacity={o} fill={c} fillOpacity={fillAlpha} strokeWidth={lw} dot={s.marker ? { r: lineDotR } : false} isAnimationActive={false} />;
        }
        return <Bar key={j} dataKey={`s${j}`} name={s.name} fill={c} fillOpacity={(s.alpha ?? 1) * o} isAnimationActive={false} />;
      })}
    </ComposedChart>
  );

  // rete's drag takes pointer capture on mousedown and would steal the legend's click.
  const legendPress = (e: SyntheticEvent) => {
    if ((e.target as Element | null)?.closest?.(".sol-chart-legend")) e.stopPropagation();
  };
  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      {chart}
      {legend}
    </div>
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
    // recharts 3 passes geometry only to a function `content`; an element collapses every cell to 0×0.
    <Treemap width={width} height={height} data={data} dataKey="size" isAnimationActive={false} content={(props) => <TreemapCell {...props} colors={colors} fscale={fscale} />}>
      {SLICE_TIP}
    </Treemap>
  );
}

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
    if (!s || !t || s === t || !(v > 0)) continue;
    links.push({ source: idx(s), target: idx(t), value: v });
  }
  if (links.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return (
    <Sankey
      className="sol-sankey"
      width={width}
      height={height}
      data={{ nodes, links }}
      nodePadding={16}
      nodeWidth={10}
      link={{ stroke: grid, strokeOpacity: 0.5 }}
      // recharts' node props omit containerWidth; without it every label sits in the right half.
      node={(props) => <SankeyNodeShape {...props} colors={colors} containerWidth={width} fscale={fscale} />}
      margin={{ top: 6, right: 10, bottom: 6, left: 10 }}
    >
      {SLICE_TIP}
    </Sankey>
  );
}

const LINE_DASH: Record<LineStyle, string | undefined> = {
  solid: undefined, dashed: "6 4", dotted: "1.5 3", dashdot: "6 3 1.5 3", none: undefined,
};
const BUBBLE_AREA: [number, number] = [40, 420];

type XYRow = XYPoint & { _j: number; label?: string };

function XYTooltip({ active, payload, names, xcats, xDate, multi, seriesName }: {
  active?: boolean;
  payload?: { payload?: XYRow }[];
  names: XYPayload["names"]; xcats?: string[]; xDate?: boolean; multi: boolean; seriesName: (j: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const row = (name: string, v: string | undefined) => (v === undefined ? null : (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "var(--text-dim)" }}>{name}</span>
      <span style={{ marginLeft: "auto" }}>{v}</span>
    </div>
  ));
  const xText = xcats ? xcats[d.x] : xDate ? String(formatFrameCell("date", d.x)) : axisTick(d.x);
  return (
    <div style={{ fontSize: 11, padding: "3px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      {multi && <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{seriesName(d._j)}</div>}
      {row(names.x ?? "x", xText)}
      {row(names.y ?? "y", tipValue(d.y))}
      {row(names.s ?? "size", d.s === undefined ? undefined : tipValue(d.s))}
      {row(names.c ?? "color", d.c === undefined ? undefined : typeof d.c === "number" ? tipValue(d.c) : d.c)}
      {row(names.text ?? "label", d.text)}
    </div>
  );
}

const rampCss = (t: number, cmap?: string) => { const [r, g, b] = (cmap ? colormapRgb(cmap, t) : null) ?? heightRampColor(t); return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; };

// Past this many segments a gradient per segment costs more than it shows; each takes its first point's color.
const GRADIENT_SEGMENTS_MAX = 400;

/** A joint line whose color runs between its points' marker colors, one segment at a time. */
function rampLine(id: string, colors: string[], width: number, dash: string | undefined, opacity: number) {
  const RampLine = ({ points }: { points?: { x: number | null; y: number | null }[] }) => {
    if (!points || points.length < 2) return null;
    const lines: ReactElement[] = [];
    const stops: ReactElement[] = [];
    const smooth = points.length - 1 <= GRADIENT_SEGMENTS_MAX;
    let run = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const ca = colors[i], cb = colors[i + 1];
      let stroke = ca;
      if (ca !== cb && smooth) {
        stroke = `url(#${id}-${i})`;
        stops.push(
          <linearGradient key={i} id={`${id}-${i}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
            <stop offset="0" stopColor={ca} /><stop offset="1" stopColor={cb} />
          </linearGradient>,
        );
      }
      lines.push(<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeDashoffset={dash ? -run : undefined} />);
      run += Math.hypot(b.x - a.x, b.y - a.y);
    }
    // Opacity on the group, so the round caps where segments meet don't darken.
    return (
      <g opacity={opacity} fill="none" strokeWidth={width} strokeDasharray={dash} strokeLinecap={dash ? "butt" : "round"}>
        {stops.length > 0 && <defs>{stops}</defs>}
        {lines}
      </g>
    );
  };
  return RampLine;
}

/** Pads [lo, hi] so a unit spans the same pixels on both axes. */
function equalDomains(x: [number, number], y: [number, number], pw: number, ph: number): { x: [number, number]; y: [number, number] } {
  const dx = x[1] - x[0] || 1, dy = y[1] - y[0] || 1;
  const u = Math.max(dx / Math.max(1, pw), dy / Math.max(1, ph));
  const grow = (d: [number, number], span: number): [number, number] => {
    const mid = (d[0] + d[1]) / 2;
    return [mid - span / 2, mid + span / 2];
  };
  return { x: grow(x, u * pw), y: grow(y, u * ph) };
}

const VSPAN_ALPHA = 0.16;

/** An annotation color: a palette slot name follows the theme, anything else is taken as CSS. */
function markColor(c: string | undefined, fallback: string): string {
  if (!c) return fallback;
  return c in PALETTE ? resolveColor(c) : c;
}

type VLinePlace = { row: number; flip: boolean };

/** Each labelled line's label place: right of the line, or left of it when the right would run past the plot or across
 *  another line and the left would not, in the first row where it clears the labels already placed. */
function vlinePlaces(lines: readonly { x: number; label?: string }[], xLo: number, xHi: number, pw: number, fs: number): VLinePlace[] {
  const pxPerX = xHi > xLo ? pw / (xHi - xLo) : 0;
  const taken: [number, number][][] = [];
  const places: VLinePlace[] = lines.map(() => ({ row: 0, flip: false }));
  [...lines.keys()].sort((a, b) => lines[a].x - lines[b].x).forEach((k) => {
    const label = lines[k].label;
    if (!label) return;
    const at = (lines[k].x - xLo) * pxPerX;
    const w = 6 + label.length * 5.2 * fs;
    // Right of the line unless that runs past the plot or across another line and the left side doesn't.
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

function VLineLabel({ viewBox, text, place, fs, fill }: {
  viewBox?: { x?: number; y?: number }; text: string; place: VLinePlace; fs: number; fill: string;
}) {
  if (viewBox?.x == null || viewBox.y == null) return null;
  return (
    <text x={viewBox.x + (place.flip ? -3 : 3)} y={viewBox.y + (place.row + 1) * 11 * fs} fontSize={9 * fs} fill={fill}
      textAnchor={place.flip ? "end" : "start"}>{text}</text>
  );
}

/** Where a category axis puts a reference's x: the index of the label it names (a date serial matches its formatted
 *  label), or with no labels its 1-based position; null when it names no category. */
function categoryAt(labels: readonly (string | number)[] | undefined) {
  return (v: number | string): number | null => {
    if (!labels) return typeof v === "number" && Number.isInteger(v) ? v - 1 : null;
    const idx = labels.findIndex((l) => l === v || String(l) === String(v)
      || (typeof v === "number" && typeof l === "string" && l === formatFrameCell("date", v)));
    return idx >= 0 ? idx : null;
  };
}

/** A figure's references as recharts marks: bands first so they sit behind, then lines. `at` maps an x to the axis's
 *  own value, or null when it isn't on the axis. On a horizontal Bar (`swap`) the categories run down the y axis. */
function refMarks(refs: readonly ChartRef[] | undefined, at: (v: number | string) => number | null,
  ctx: { axis: string; fs: number; xLo: number; xHi: number; pw: number; swap?: boolean }): ReactElement[] {
  if (!refs?.length) return [];
  const { axis, fs, swap } = ctx;
  const out: ReactElement[] = [];
  const xs = refs.map((r) => ({ r, x: r.x === undefined ? null : at(r.x), x2: r.x2 === undefined ? null : at(r.x2) }));
  const band = (k: string, a: number, b: number, across: boolean, color?: string) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    out.push(<ReferenceArea key={k} {...(across ? { x1: lo, x2: hi } : { y1: lo, y2: hi })} fill={markColor(color, axis)} fillOpacity={VSPAN_ALPHA} stroke="none" ifOverflow="hidden" />);
  };
  xs.forEach(({ r, x, x2 }, k) => { if (x !== null && x2 !== null) band(`rxb${k}`, x, x2, !swap, r.color); });
  refs.forEach((r, k) => { if (r.y !== undefined && r.y2 !== undefined) band(`ryb${k}`, r.y, r.y2, !!swap, r.color); });
  const vlines = xs.filter((v): v is { r: ChartRef; x: number; x2: null } => v.x !== null && v.x2 === null);
  const places = vlinePlaces(vlines.map(({ r, x }) => ({ x, label: r.label })), ctx.xLo, ctx.xHi, ctx.pw, fs);
  vlines.forEach(({ r, x }, k) => {
    const color = markColor(r.color, axis);
    out.push(<ReferenceLine key={`rx${k}`} {...(swap ? { y: x } : { x })} stroke={color} strokeDasharray="4 3" strokeWidth={1} ifOverflow="hidden"
      label={r.label ? (swap ? { value: r.label, position: "insideTopRight", fill: color, fontSize: 9 * fs } : <VLineLabel text={r.label} place={places[k]} fs={fs} fill={color} />) : undefined} />);
  });
  refs.forEach((r, k) => {
    if (r.y === undefined || r.y2 !== undefined) return;
    const color = markColor(r.color, axis);
    out.push(<ReferenceLine key={`ry${k}`} {...(swap ? { x: r.y } : { y: r.y })} stroke={color} strokeDasharray="4 3" strokeWidth={1} ifOverflow="hidden"
      label={r.label ? { value: r.label, position: swap ? "insideTopRight" : "insideTopLeft", fill: color, fontSize: 9 * fs } : undefined} />);
  });
  return out;
}

/** Scatter, XY Line, Bubble and an XY Merge Plots: every series on one numeric plane, broken at each gap. */
export function XYView({ payload, width, height, opts, fontScale, refs }: {
  payload: XYPayload; width: number; height: number; opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[];
}) {
  const { grid, axis, viz } = useChartColors();
  const colors = useSeriesColors();
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  const { series, xcats, names, xDate } = payload;
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
  const gradId = useId().replace(/:/g, "");
  const multi = series.length > 1;
  const paint = (j: number) => series[j]?.color || (multi ? colors[j % colors.length] : markColor(opts?.color, viz));
  const pts = series.flatMap((s) => s.points.filter((p): p is XYPoint => p !== null));
  if (pts.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

  const cats = series.find((s) => s.cCats)?.cCats;
  const cRange = series.find((s) => s.cRange)?.cRange;
  const catLegend = !multi && !!cats && cats.length > 0;
  const pointFill = (p: XYPoint, j: number): string => {
    const s = series[j];
    if (typeof p.c === "number" && s.cRange) {
      const [lo, hi] = s.cRange;
      return rampCss(hi > lo ? (p.c - lo) / (hi - lo) : 0.5, opts?.cmap);
    }
    if (typeof p.c === "string" && s.cCats) return colors[Math.max(0, s.cCats.indexOf(p.c)) % colors.length];
    return paint(j);
  };
  const pointR = (p: XYPoint, j: number): number => {
    const s = series[j];
    if (s.sRange) {
      const [lo, hi] = s.sRange;
      const t = p.s === undefined ? 0 : hi > lo ? (p.s - lo) / (hi - lo) : 0.2;
      return Math.sqrt((BUBBLE_AREA[0] + t * (BUBBLE_AREA[1] - BUBBLE_AREA[0])) / Math.PI);
    }
    return s.markersize ?? opts?.markersize ?? (s.line === "none" ? SCATTER_DOT_R : LINE_DOT_R);
  };

  const xLabel = opts?.xlabel ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis } : undefined;
  const yLabel = opts?.ylabel ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis } : undefined;
  const title = opts?.title;
  const margin = { top: PLOT_TOP, right: 12, bottom: xLabel ? 18 : 4, left: 0 };
  const yVals = [...pts.map((p) => p.y), opts?.ymin, opts?.ymax];
  const yAxisW = valueAxisWidth(yVals, fs, !!yLabel, valueTickFormat(yVals));
  const legendW = width - yAxisW - margin.right;
  const seriesRows = multi ? legendRows(series.map((s) => s.name), legendW, fs, legendCap(height)) : catLegend ? legendRows(cats!, legendW, fs, legendCap(height)) : 0;
  const chartH = height - (title ? titleHeight(fs) : 0) - (seriesRows + (cRange ? 1 : 0)) * MULTI_LEGEND_H;
  const xAxisH = xLabel ? 28 : 30;

  const ext = (vals: number[], lo?: number, hi?: number): [number, number] =>
    [lo ?? iterMin(vals), hi ?? iterMax(vals)];
  let xDomain: [number | string, number | string] = [opts?.xmin ?? "auto", opts?.xmax ?? "auto"];
  let yDomain: [number | string, number | string] = [opts?.ymin ?? "auto", opts?.ymax ?? "auto"];
  let xTicks: number[] | undefined = xcats && xcats.length <= ALL_TICKS_UPTO ? xcats.map((_, i) => i) : undefined;
  let yTicks: number[] | undefined;
  const pw = width - yAxisW - margin.left - margin.right, ph = chartH - margin.top - margin.bottom - xAxisH;
  if (!xcats && opts?.xmin !== undefined && opts?.xmax !== undefined) xTicks = niceTicks(opts.xmin, opts.xmax, Math.max(3, Math.round(pw / 60)));
  // A date axis spans its data exactly (round serials mean nothing) and ticks on calendar boundaries.
  let byYear = false;
  if (xDate) {
    const [lo, hi] = ext(pts.map((p) => p.x), opts?.xmin, opts?.xmax);
    xDomain = [lo, hi];
    ({ ticks: xTicks, byYear } = dateTicks(lo, hi, Math.max(3, Math.round(pw / 70))));
  }
  if (opts?.ymin !== undefined && opts?.ymax !== undefined) yTicks = niceTicks(opts.ymin, opts.ymax, Math.max(3, Math.round(ph / 40)));
  if (opts?.aspect === "equal" && !xcats) {
    const eq = equalDomains(ext(pts.map((p) => p.x), opts?.xmin, opts?.xmax), ext(pts.map((p) => p.y), opts?.ymin, opts?.ymax), pw, ph);
    xDomain = eq.x;
    yDomain = eq.y;
    xTicks = niceTicks(eq.x[0], eq.x[1], Math.max(3, Math.round(pw / 60)));
    yTicks = niceTicks(eq.y[0], eq.y[1], Math.max(3, Math.round(ph / 40)));
  }
  // A log axis has no place for zero or less: such points drop out as gaps, and the domain snaps out to whole decades.
  const logY = opts?.yscale === "log";
  if (logY) {
    const pos = pts.map((p) => p.y).filter((v) => v > 0);
    if (pos.length) {
      const lo = opts?.ymin !== undefined && opts.ymin > 0 ? opts.ymin : 10 ** Math.floor(Math.log10(iterMin(pos)));
      const hi = opts?.ymax ?? 10 ** Math.ceil(Math.log10(iterMax(pos)));
      yDomain = [lo, hi];
      yTicks = logTicks(lo, hi);
    }
  }
  const xFmt = (t: number | string) => {
    const n = Number(t);
    if (!Number.isFinite(n)) return "";
    if (xcats) { const lab = xcats[Math.round(n)]; return lab ?? ""; }
    if (xDate) return formatDateSerial(n, byYear ? "YYYY" : "MMM YYYY");
    return axisTick(n);
  };

  const runs: { j: number; rows: XYRow[] }[] = [];
  series.forEach((s, j) => {
    let cur: XYRow[] = [];
    for (const p of s.points) {
      if (p === null || (logY && !(p.y > 0))) { if (cur.length) runs.push({ j, rows: cur }); cur = []; continue; }
      if (cur.length && opts?.maxgap !== undefined && Math.abs(p.x - cur[cur.length - 1].x) > opts.maxgap) { runs.push({ j, rows: cur }); cur = []; }
      cur.push({ ...p, _j: j, ...(p.text ? { label: sanitizeChartLabel(p.text, 12) } : {}) });
    }
    if (cur.length) runs.push({ j, rows: cur });
  });
  const anyText = pts.some((p) => p.text);
  const refAt = (v: number | string) => xcats ? (typeof v === "string" && xcats.includes(v) ? xcats.indexOf(v) : null) : typeof v === "number" ? v : null;
  const refX = (refs ?? []).flatMap((r) => [r.x, r.x2]).map((v) => (v === undefined ? null : refAt(v))).filter((v): v is number => v !== null);
  const xExt = ext([...pts.map((p) => p.x), ...refX], opts?.xmin, opts?.xmax);
  const refEls = refMarks(refs, refAt, { axis, fs, xLo: xExt[0], xHi: xExt[1], pw });

  const chart = (
    <ScatterChart width={width} height={chartH} margin={margin}>
      {(opts?.grid ?? true) && <CartesianGrid stroke={grid} />}
      <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} tickFormatter={xFmt}
        domain={xcats ? [0, Math.max(0, xcats.length - 1)] : xDomain} ticks={xTicks} allowDecimals={xcats ? false : undefined}
        padding={xcats ? { left: 8, right: 8 } : undefined} allowDataOverflow={opts?.xmin !== undefined || opts?.xmax !== undefined}
        label={xLabel} height={xAxisH} />
      <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} tickFormatter={valueTickFormat(yVals, yTicks)} width={yAxisW}
        scale={logY ? "log" : undefined} domain={yDomain} ticks={yTicks} allowDataOverflow={opts?.ymin !== undefined || opts?.ymax !== undefined} label={yLabel} />
      {refEls}
      <Tooltip isAnimationActive={false} cursor={{ strokeDasharray: "3 3", stroke: "rgba(128,128,128,0.5)" }}
        content={<XYTooltip names={names} xcats={xcats} xDate={xDate} multi={multi} seriesName={(j) => series[j]?.name ?? ""} />} />
      {runs.map(({ j, rows }, k) => {
        const s = series[j];
        const o = dim(j);
        const alpha = s.alpha ?? opts?.alpha ?? (s.sRange ? 0.55 : 1);
        const lw = s.linewidth ?? opts?.linewidth ?? 1.5;
        const lineAlpha = (s.alpha ?? opts?.alpha ?? 1) * o;
        const line = s.line === "none" || rows.length < 2 ? false
          : s.cRange && rows.some((d) => typeof d.c === "number")
            ? rampLine(`${gradId}-${k}`, rows.map((d) => pointFill(d, j)), lw, LINE_DASH[s.line], lineAlpha)
            : { stroke: paint(j), strokeWidth: lw, strokeDasharray: LINE_DASH[s.line], strokeOpacity: lineAlpha, fill: "none" };
        const shape = (p: { cx?: number; cy?: number; payload?: XYRow }) => {
          const d = p.payload;
          // A lone point on a markerless line would draw nothing, so it draws as a dot.
          if (!d || p.cx == null || p.cy == null || (!s.marker && (rows.length > 1 || s.line === "none"))) return <g />;
          return <circle cx={p.cx} cy={p.cy} r={pointR(d, j)} fill={pointFill(d, j)} fillOpacity={alpha * o} />;
        };
        return (
          <Scatter key={k} name={s.name} data={rows} line={line as ComponentProps<typeof Scatter>["line"]} lineType="joint" shape={shape as ComponentProps<typeof Scatter>["shape"]} isAnimationActive={false}>
            {anyText && <LabelList dataKey="label" position="right" fill={axis} fontSize={8.5 * fs} />}
          </Scatter>
        );
      })}
    </ScatterChart>
  );

  const legendPress = (e: SyntheticEvent) => {
    if ((e.target as Element | null)?.closest?.(".sol-chart-legend")) e.stopPropagation();
  };
  const colorbar = cRange && (
    <div style={{ height: MULTI_LEGEND_H, paddingLeft: yAxisW, paddingRight: margin.right, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 9 * fs, color: axis, whiteSpace: "nowrap", overflow: "hidden" }}>
      {names.c && <span>{names.c}</span>}
      <span>{compactTick(cRange[0])}</span>
      <span aria-hidden="true" style={{ width: 60, height: 7, borderRadius: 2, flex: "none", background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rampCss(t, opts?.cmap)).join(", ")})` }} />
      <span>{compactTick(cRange[1])}</span>
    </div>
  );
  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      {chart}
      {multi && (
        <SeriesLegend
          series={series} paint={paint} dim={dim} fs={fs} color={axis} rows={seriesRows}
          insetLeft={yAxisW} insetRight={margin.right} isLine={() => series.some((s) => s.line !== "none")}
          onPick={pick}
        />
      )}
      {catLegend && (
        <SeriesLegend
          series={cats!.map((name) => ({ name }))} paint={(k) => colors[k % colors.length]} dim={() => 1} fs={fs} color={axis} rows={seriesRows}
          insetLeft={yAxisW} insetRight={margin.right} isLine={() => false} onPick={() => {}}
        />
      )}
      {colorbar}
    </div>
  );
}

// `pct` is 0 to 100; the caller crops the `size` square to its top half.
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

const RISING = "var(--sol-error)";
const DIVERGED = "var(--text-dim)";

export type TornadoBar = {
  label: string; offset: number; range: number; rising: boolean;
  diverged?: boolean;
  outLow?: number; outHigh?: number; inLow?: number; inHigh?: number; basis?: "slider" | "number";
};

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

export const TORNADO_W = 218;

export function TornadoBars({ data, grid, axis }: { data: TornadoBar[]; grid: string; axis: string }) {
  const falling = resolveColor("blue");
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
        {data.map((d, i) => <Cell key={i} fill={d.diverged ? DIVERGED : d.rising ? RISING : falling} fillOpacity={d.diverged ? 0.4 : 1} />)}
      </Bar>
    </BarChart>
  );
}
