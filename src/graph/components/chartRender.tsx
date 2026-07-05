// Every recharts-using renderer, in ONE module — so recharts lands in a single
// lazily-loaded chunk. Nothing here is imported statically by the app; chartView.tsx
// wraps these in React.lazy + Suspense. recharts-free helpers live in chartCore.ts.
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, RadialBarChart, RadialBar, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadarChart, Radar, PieChart, Pie, ScatterChart, Scatter, ZAxis, FunnelChart, Funnel, LabelList, Cell, Treemap, Sankey, ComposedChart } from "recharts";
import "./chartView.css";
import { formatScalar } from "./format";
import { VIZ, useChartColors, useSeriesColors, type ChartShape } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";

// A hover readout that shows the value at a sensible precision (formatScalar),
// not recharts' raw full-float. Point index is 1-based.
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: number | string;
}) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <span style={{ color: "var(--text-dim)" }}>#{Number(label) + 1}</span>
      {"  "}
      {typeof v === "number" ? formatScalar(v) : v}
    </div>
  );
}

const TIP = <Tooltip isAnimationActive={false} cursor={{ stroke: "rgba(128,128,128,0.5)", fill: "rgba(128,128,128,0.12)" }} content={<ChartTooltip />} />;

// A slice/segment readout for the polar + categorical charts (pie / radial / funnel),
// where an x-axis index is meaningless — show only the formatted value.
function SliceTooltip({ active, payload }: { active?: boolean; payload?: { value?: number }[] }) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      {typeof v === "number" ? formatScalar(v) : v}
    </div>
  );
}
const SLICE_TIP = <Tooltip isAnimationActive={false} content={<SliceTooltip />} />;

/**
 * One recharts renderer for both the inline node charts and the expand popup.
 * `axes` adds gridlines + numbered axes (the big "Chart" look); without it you
 * get a clean Sparkline. `opts` carries the matplotlib-style overrides from a
 * Chart's Options socket (Sparkline passes none). Hover shows a small readout
 * formatted via formatScalar (not recharts' raw full-float).
 */
export function ChartView({
  op, series, width, height, axes, opts,
}: {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
}) {
  const { grid, axis } = useChartColors();
  const seriesColors = useSeriesColors();
  const paint = (i: number) => seriesColors[i % seriesColors.length];
  const AXIS = { fontSize: 9, fill: axis } as const;
  const tickFmt = (i: number | string) => String(Number(i) + 1);

  // Resolved style from the options (fall back to the defaults that shipped).
  const color = opts?.color || VIZ;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? axes; // lines dot by default when axed
  const fillAlpha = opts?.alpha ?? 0.25;
  // YAxis domain when ylim is given; recharts uses "auto" for an open bound.
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const xLabel = axes && opts?.xlabel
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10, fill: axis }
    : undefined;
  // Make room for axis labels / a title when present.
  const title = opts?.title;
  const titleH = title ? 16 : 0;
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
    // Horizontal bars (category down the Y axis).
    chart = (
      <BarChart width={width} height={chartH} data={series} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} domain={yDomain} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={yLabel ? 32 : 18} tickFormatter={tickFmt} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={fillAlpha < 1 && opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  } else if (op === "pie") {
    // Each value is a slice, coloured from the categorical set.
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
    // A polygon over the values on a shared radial scale.
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
    // Concentric bars, one per value, coloured categorically.
    chart = (
      <RadialBarChart width={width} height={chartH} cx="50%" cy="50%" innerRadius="18%" outerRadius="92%" data={series} startAngle={90} endAngle={-270}>
        <RadialBar dataKey="v" background={{ fill: grid }} cornerRadius={3} isAnimationActive={false}>
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </RadialBar>
        {SLICE_TIP}
      </RadialBarChart>
    );
  } else if (op === "funnel") {
    // Descending stages — top value widest.
    chart = (
      <FunnelChart width={width} height={chartH}>
        {SLICE_TIP}
        <Funnel dataKey="v" data={series} isAnimationActive={false}>
          <LabelList position="right" dataKey="v" fill={axis} stroke="none" fontSize={10} />
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </Funnel>
      </FunnelChart>
    );
  } else if (op === "scatter") {
    // Index (x) vs value (y) — a dot plot for a single series.
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis type="number" dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="number" dataKey="v" tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Scatter data={series} fill={color} isAnimationActive={false} />
      </ScatterChart>
    );
  } else {
    // "column" — vertical bars.
    chart = (
      <BarChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  }

  if (!title) return chart;
  return (
    <div style={{ width }}>
      <div style={{ height: titleH, lineHeight: `${titleH}px`, textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {chart}
    </div>
  );
}

// ─── Treemap ──────────────────────────────────────────────────────────────────
// A flat labelled treemap — each name/value is a rectangle sized by value, coloured
// from the categorical set. recharts hands the cell renderer geometry + index.
type TreemapCellProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string; colors?: string[];
};
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "", colors = [] }: TreemapCellProps) {
  const fill = colors[index % (colors.length || 1)] || VIZ;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="var(--surface)" strokeWidth={1} />
      {width > 46 && height > 20 ? (
        <text x={x + 5} y={y + 15} fontSize={10} fill="#fff" style={{ pointerEvents: "none" }}>{name}</text>
      ) : null}
    </g>
  );
}

export function TreemapView({ names, values, width, height }: {
  names: string[]; values: number[]; width: number; height: number;
}) {
  const colors = useSeriesColors();
  const data = names
    .map((n, i) => ({ name: n || `#${i + 1}`, size: Math.max(0, values[i] ?? 0) }))
    .filter((d) => d.size > 0);
  if (data.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return (
    <Treemap width={width} height={height} data={data} dataKey="size" isAnimationActive={false} content={<TreemapCell colors={colors} />}>
      {SLICE_TIP}
    </Treemap>
  );
}

// ─── Sankey ───────────────────────────────────────────────────────────────────
// Flow edges: source[i] → target[i] carries value[i]. Nodes are the unique names.
// recharts needs numeric source/target indices into the nodes array; cycles/self-
// loops are dropped (recharts' layout assumes a DAG).
type SankeyNodeProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; payload?: { name?: string }; colors?: string[]; containerWidth?: number;
};
function SankeyNodeShape({ x = 0, y = 0, width = 0, height = 0, index = 0, payload, colors = [], containerWidth = 0 }: SankeyNodeProps) {
  const fill = colors[index % (colors.length || 1)] || VIZ;
  const rightHalf = x > containerWidth / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={1} />
      <text
        x={rightHalf ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={rightHalf ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={10}
        fill="var(--text)"
        style={{ pointerEvents: "none" }}
      >{payload?.name}</text>
    </g>
  );
}

export function SankeyView({ sources, targets, values, width, height }: {
  sources: string[]; targets: string[]; values: number[]; width: number; height: number;
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
      node={<SankeyNodeShape colors={colors} />}
      margin={{ top: 6, right: 70, bottom: 6, left: 6 }}
    >
      {SLICE_TIP}
    </Sankey>
  );
}

// ─── Composed (multi-series) ──────────────────────────────────────────────────
// Each COLUMN of the matrix is a series over the row index: column 0 draws as bars,
// the rest as lines (the classic "bars + trend line" combo), coloured categorically.
export function ComposedView({ matrix, width, height }: {
  matrix: (number | null)[][]; width: number; height: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9, fill: axis } as const;
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const data = matrix.map((row, i) => {
    const o: Record<string, number | null> = { i };
    for (let j = 0; j < ncols; j++) o[`c${j}`] = typeof row[j] === "number" ? row[j] : null;
    return o;
  });
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
      <CartesianGrid stroke={grid} vertical={false} />
      <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={(i) => String(Number(i) + 1)} />
      <YAxis tick={AXIS} tickLine={false} width={26} />
      <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(128,128,128,0.12)" }} />
      {Array.from({ length: ncols }, (_, j) => (
        j === 0
          ? <Bar key={j} dataKey={`c${j}`} fill={colors[j % colors.length]} isAnimationActive={false} />
          : <Line key={j} dataKey={`c${j}`} stroke={colors[j % colors.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      ))}
    </ComposedChart>
  );
}

// ─── Bubble ───────────────────────────────────────────────────────────────────
// Each ROW is a point: column 0 = x, 1 = y, 2 = bubble size (defaults if absent).
export function BubbleView({ matrix, width, height }: {
  matrix: (number | null)[][]; width: number; height: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9, fill: axis } as const;
  const data = matrix
    .map((row, i) => ({
      x: typeof row[0] === "number" ? row[0] : i,
      y: typeof row[1] === "number" ? row[1] : (typeof row[0] === "number" ? row[0] : null),
      z: typeof row[2] === "number" ? row[2] : 1,
    }))
    .filter((d) => d.y !== null);
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

// ─── Gauge dial (RadialBarChart) ──────────────────────────────────────────────
// The semicircular arc for GaugeComponent. `pct` is 0–100, `size` the square the
// polar chart draws into (cropped to the top half by the caller's wrapper).
export function GaugeArc({ pct, track, size }: { pct: number; track: string; size: number }) {
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
      <RadialBar background={{ fill: track }} dataKey="value" cornerRadius={7} fill={VIZ} angleAxisId={0} isAnimationActive={false} />
    </RadialBarChart>
  );
}

// ─── Tornado bars (stacked horizontal BarChart) ───────────────────────────────
const RISING = "#e0524d";
const FALLING = "#4c8bf5";

export type TornadoBar = { label: string; offset: number; range: number; rising: boolean };

export function TornadoBars({ data, grid, axis }: { data: TornadoBar[]; grid: string; axis: string }) {
  return (
    <BarChart
      width={260}
      height={Math.max(70, data.length * 22 + 16)}
      data={data}
      layout="vertical"
      margin={{ top: 2, right: 10, bottom: 2, left: 2 }}
    >
      <CartesianGrid stroke={grid} horizontal={false} />
      <XAxis type="number" tick={{ fontSize: 9, fill: axis }} tickLine={false} />
      <YAxis type="category" dataKey="label" width={72} tick={{ fontSize: 9, fill: axis }} tickLine={false} />
      <Tooltip isAnimationActive={false} />
      <Bar dataKey="offset" stackId="tornado" fill="transparent" isAnimationActive={false} />
      <Bar dataKey="range" stackId="tornado" isAnimationActive={false}>
        {data.map((d, i) => <Cell key={i} fill={d.rising ? RISING : FALLING} />)}
      </Bar>
    </BarChart>
  );
}
