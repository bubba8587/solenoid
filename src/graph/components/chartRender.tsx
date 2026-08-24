// Every recharts-using renderer in ONE module so recharts stays a single lazy
// chunk — nothing here may be imported statically by the app.
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadialBarChart, RadialBar, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadarChart, Radar, PieChart, Pie, ScatterChart, Scatter, ZAxis, FunnelChart, Funnel, LabelList, Cell, Treemap, Sankey, ComposedChart } from "recharts";
import { useState } from "react";
import "./chartView.css";
import { formatScalar } from "./format";
import { useChartColors, useSeriesColors, axisTick, type ChartShape } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";

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
  const titleH = title ? Math.ceil(16 * fs) : 0;
  const chartH = height - titleH;
  const yAxisW = axes ? (yLabel ? 40 : 26) : 0;
  const bottomM = axes ? (xLabel ? 18 : 4) : 2;
  const margin = axes ? { top: 6, right: 8, bottom: bottomM, left: 0 } : { top: 2, right: 2, bottom: 2, left: 2 };

  let chart;
  if (op === "line") {
    chart = (
      <LineChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Line dataKey="v" stroke={color} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: 2 } : false} />
      </LineChart>
    );
  } else if (op === "area") {
    chart = (
      <AreaChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Area dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: 2 } : false} />
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
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={yLabel ? Math.max(32, catW) : catW} tickFormatter={tickFmt} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={fillAlpha < 1 && opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  } else if (op === "pie") {
    const r = Math.max(20, Math.min(width, chartH) / 2 - 6);
    chart = (
      <PieChart width={width} height={chartH}>
        <Pie data={series} dataKey="v" nameKey="i" cx="50%" cy="50%" outerRadius={r} stroke="var(--surface)" isAnimationActive={false}>
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
        <PolarRadiusAxis tick={AXIS} axisLine={false} tickCount={4} domain={yDomain} />
        {TIP}
        <Radar dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: 2 } : false} />
      </RadarChart>
    );
  } else if (op === "radialbar") {
    chart = (
      <RadialBarChart width={width} height={chartH} cx="50%" cy="50%" innerRadius="18%" outerRadius="92%" data={series} startAngle={90} endAngle={-270}>
        <RadialBar dataKey="v" background={{ fill: grid }} cornerRadius={3} isAnimationActive={false}>
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </RadialBar>
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
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {/* allowDecimals=false stops recharts inventing fractional "nice" ticks. */}
        {axes && <XAxis type="number" dataKey={numericX ? "x" : "i"} tick={AXIS} tickLine={false} tickFormatter={numericX ? (t) => axisTick(Number(t)) : tickFmt} allowDecimals={numericX ? undefined : false} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="number" dataKey="v" tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {SCATTER_TIP}
        <Scatter data={scatterData} fill={color} isAnimationActive={false} />
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
      <div style={{ height: titleH, lineHeight: `${titleH}px`, textAlign: "center", fontSize: 11 * fs, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {chart}
    </div>
  );
}

// Lists every series' value at the hovered index (the multi-series counterpart of
// ChartTooltip); the swatch color comes from each recharts payload entry.
function MultiTooltip({ active, payload, label, tickFmt }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: number | string;
  tickFmt: (i: number | string) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ fontSize: 11, padding: "3px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{tickFmt(label ?? "")}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flex: "0 0 auto" }} />
          <span style={{ color: "var(--text-dim)" }}>{p.name}</span>
          <span style={{ marginLeft: "auto" }}>{tipValue(p.value)}</span>
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
  const fillAlpha = opts?.alpha ?? 0.25;
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const title = opts?.title;
  const titleH = title ? Math.ceil(16 * fs) : 0;
  const chartH = height - titleH; // the <Legend height> reserves its own strip within this
  const margin = { top: 6, right: 8, bottom: axes ? 4 : 2, left: 0 };
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
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => op === "area"
          ? <Area key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} dot={showMarkers ? { r: 2 } : false} isAnimationActive={false} />
          : <Line key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} strokeWidth={lw} dot={showMarkers ? { r: 2 } : false} isAnimationActive={false} />)}
      </Container>
    );
  } else if (op === "bar") {
    chart = (
      <BarChart width={width} height={chartH} data={data} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} domain={yDomain} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={40} tickFormatter={tickFmt} />}
        {tip}{legend}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  } else if (op === "radar") {
    chart = (
      <RadarChart width={width} height={chartH} data={data} cx="50%" cy="50%" outerRadius="68%">
        <PolarGrid stroke={grid} />
        <PolarAngleAxis dataKey="i" tick={AXIS} tickFormatter={tickFmt} />
        <PolarRadiusAxis tick={AXIS} axisLine={false} tickCount={4} domain={yDomain} />
        {tip}{legend}
        {series.map((s, j) => <Radar key={j} dataKey={`s${j}`} name={s.name} stroke={paint(j)} strokeOpacity={dim(j)} fill={paint(j)} fillOpacity={fillAlpha * dim(j)} strokeWidth={lw} isAnimationActive={false} />)}
      </RadarChart>
    );
  } else if (op === "scatter") {
    // Each series a cloud; a numeric label column places points at their real x.
    const numericX = !!labels && data.length > 0 && data.every((d) => typeof labels![d.i as number] === "number");
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} tickFormatter={numericX ? (t) => axisTick(Number(t)) : tickFmt} allowDecimals={numericX ? undefined : false} />}
        {axes && <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => (
          <Scatter key={j} name={s.name} fill={paint(j)} fillOpacity={dim(j)} isAnimationActive={false}
            data={data.map((d) => ({ x: numericX ? Number(labels![d.i as number]) : (d.i as number), y: d[`s${j}`] }))} />
        ))}
      </ScatterChart>
    );
  } else {
    // column (the default cartesian) — grouped vertical bars.
    chart = (
      <BarChart width={width} height={chartH} data={data} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={26} domain={yDomain} />}
        {tip}{legend}
        {series.map((s, j) => <Bar key={j} dataKey={`s${j}`} name={s.name} fill={paint(j)} fillOpacity={dim(j)} isAnimationActive={false} />)}
      </BarChart>
    );
  }

  if (!title) return chart;
  return (
    <div style={{ width }}>
      <div style={{ height: titleH, lineHeight: `${titleH}px`, textAlign: "center", fontSize: 11 * fs, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {chart}
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
export function ComposedView({ series, width, height, fscale = 1 }: {
  series: { name: string; values: (number | null)[] }[]; width: number; height: number; fscale?: number;
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
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
      <CartesianGrid stroke={grid} vertical={false} />
      <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={(i) => String(Number(i) + 1)} />
      <YAxis tick={AXIS} tickLine={false} width={26} />
      <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} />
      {series.length > 1 && <Legend verticalAlign="bottom" height={LEGEND_H} iconSize={8} wrapperStyle={{ fontSize: 9 * fscale, color: axis }} />}
      {series.map((s, j) => j === 0
        ? <Bar key={j} dataKey={`s${j}`} name={s.name} fill={colors[j % colors.length]} isAnimationActive={false} />
        : <Line key={j} dataKey={`s${j}`} name={s.name} stroke={colors[j % colors.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} />)}
    </ComposedChart>
  );
}

// The first three NUMBER series are x / y / size columns, one dot per row (a frame's
// first three number columns; a single column plots against itself).
export function BubbleView({ series, width, height, fscale = 1 }: {
  series: { name: string; values: (number | null)[] }[]; width: number; height: number; fscale?: number;
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
  return (
    <ScatterChart width={width} height={height} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
      <CartesianGrid stroke={grid} />
      <XAxis type="number" dataKey="x" tick={AXIS} tickLine={false} />
      <YAxis type="number" dataKey="y" tick={AXIS} tickLine={false} width={26} />
      <ZAxis type="number" dataKey="z" range={[40, 420]} />
      <Tooltip isAnimationActive={false} cursor={{ strokeDasharray: "3 3", stroke: "rgba(128,128,128,0.5)" }} />
      <Scatter data={data} fill={colors[0]} fillOpacity={0.55} isAnimationActive={false} />
    </ScatterChart>
  );
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
