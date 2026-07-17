// Every recharts-using renderer, in ONE module — so recharts lands in a single
// lazily-loaded chunk. Nothing here is imported statically by the app; chartView.tsx
// wraps these in React.lazy + Suspense. recharts-free helpers live in chartCore.ts.
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, RadialBarChart, RadialBar, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadarChart, Radar, PieChart, Pie, ScatterChart, Scatter, ZAxis, FunnelChart, Funnel, LabelList, Cell, Treemap, Sankey, ComposedChart } from "recharts";
import "./chartView.css";
import { formatScalar } from "./format";
import { VIZ, useChartColors, useSeriesColors, axisTick, type ChartShape } from "./chartCore";
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
  const idx = Number(label);
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <span style={{ color: "var(--text-dim)" }}>#{Number.isFinite(idx) ? Math.round(idx) + 1 : "?"}</span>
      {"  "}
      {tipValue(v)}
    </div>
  );
}

// Coerce a recharts payload value to a renderable string. A number formats via
// formatScalar; anything non-primitive (a SolError object that slipped past the
// series sanitizer) is stringified so React never sees a raw object as a child
// (which throws "Objects are not valid as a React child" and takes down the node).
function tipValue(v: unknown): string {
  if (typeof v === "number") return formatScalar(v);
  if (v == null) return "";
  if (typeof v === "object") return String((v as { code?: string }).code ?? "—");
  return String(v);
}

const TIP = <Tooltip isAnimationActive={false} cursor={{ stroke: "rgba(128,128,128,0.5)", fill: "rgba(128,128,128,0.12)" }} content={<ChartTooltip />} />;

// A slice/segment readout for the polar + categorical charts (pie / radial / funnel),
// where an x-axis index is meaningless — show only the formatted value.
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

// The scatter readout: real x (when the dot carries one) → its value, else the
// 1-based ordinal → its value. Reads the datum off payload[0].payload so it works
// whether the x axis is a real coordinate (dataKey "x") or the row index ("i").
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

/**
 * One recharts renderer for both the inline node charts and the expand popup.
 * `axes` adds gridlines + numbered axes (the big "Chart" look); without it you
 * get a clean Sparkline. `opts` carries the matplotlib-style overrides from a
 * Chart's Options socket (Sparkline passes none). Hover shows a small readout
 * formatted via formatScalar (not recharts' raw full-float).
 */
export function ChartView({
  op, series, width, height, axes, opts, signColors, labels, fontScale,
}: {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
  /** Colour each bar/column by the sign of its value (win/loss): positive → pos,
   *  negative → neg, zero → the grid colour. Ignored by the non-bar ops. */
  signColors?: { pos: string; neg: string };
  /** X-axis category labels (Frame col 0) — the axis shows these instead of 1,2,3… */
  labels?: (string | number)[];
  /** Display-layer text multiplier (an FC on the chart socket) — multiplies the
   *  options' own fontsize (matplotlib points, 10 = the built-in sizes). */
  fontScale?: number;
}) {
  const { grid, axis } = useChartColors();
  const seriesColors = useSeriesColors();
  const paint = (i: number) => seriesColors[i % seriesColors.length];
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const AXIS = { fontSize: 9 * fs, fill: axis } as const;
  // With Frame labels, the axis/category tick shows the label for that index; else
  // the 1-based ordinal (the historical behaviour). A recharts `type="number"`
  // index axis (scatter) can hand us INTERPOLATED fractional ticks (0.5, 1.5…) —
  // round to the nearest datum and drop anything off the ends / non-numeric so the
  // axis never renders a bogus "1.5" or an "[object Object]" from a stray value.
  const tickFmt = (i: number | string) => {
    const n = Number(i);
    if (!Number.isFinite(n)) return "";
    const idx = Math.round(n);
    if (labels) {
      const lab = labels[idx];
      if (lab == null || typeof lab === "object") return "";
      // A numeric label (a wired Frame's numeric first column) is snapped free of
      // float/precision noise so a value that is "really" 3 doesn't read as
      // "3.0000000004"; a string label (category / formatted date) renders as-is.
      return typeof lab === "number" ? axisTick(lab) : String(lab);
    }
    return idx >= 0 ? String(idx + 1) : "";
  };

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
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10 * fs, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10 * fs, fill: axis }
    : undefined;
  // Make room for axis labels / a title when present.
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
          <LabelList position="right" dataKey="v" fill={axis} stroke="none" fontSize={10 * fs} />
          {series.map((_, i) => <Cell key={i} fill={paint(i)} />)}
        </Funnel>
      </FunnelChart>
    );
  } else if (op === "scatter") {
    // A dot plot for a single series. When the wired first column is all numbers
    // (e.g. a "Frame from Lists" X column, or a Point Plotter's X list through
    // Build Frame), place each dot at its REAL x — so the plot honours x spacing
    // and order instead of the ROW INDEX (which made a hand-drawn / unsorted point
    // set read "out of order" and ignored the x values entirely). Category
    // (non-numeric) labels, or a plain values list, keep the index x.
    const numericX = !!labels && series.length > 0 && series.every((d) => typeof labels![d.i] === "number");
    const scatterData = numericX ? series.map((d) => ({ i: d.i, x: Number(labels![d.i]), v: d.v })) : series;
    chart = (
      <ScatterChart width={width} height={chartH} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {/* Index axis: allowDecimals=false stops recharts inventing fractional
            "nice" ticks (0.5, 1.5…). A real-x axis keeps decimals and formats the
            tick value directly (snapped free of float noise). */}
        {axes && <XAxis type="number" dataKey={numericX ? "x" : "i"} tick={AXIS} tickLine={false} tickFormatter={numericX ? (t) => axisTick(Number(t)) : tickFmt} allowDecimals={numericX ? undefined : false} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="number" dataKey="v" tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {SCATTER_TIP}
        <Scatter data={scatterData} fill={color} isAnimationActive={false} />
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
        <Bar dataKey="v" fill={color} fillOpacity={opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false}>
          {/* Win/loss: colour each column by sign (up = green, down = error red). */}
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

// ─── Treemap ──────────────────────────────────────────────────────────────────
// A flat labelled treemap — each name/value is a rectangle sized by value, coloured
// from the categorical set. recharts hands the cell renderer geometry + index.
type TreemapCellProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string; colors?: string[]; fscale?: number;
};
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "", colors = [], fscale = 1 }: TreemapCellProps) {
  const fill = colors[index % (colors.length || 1)] || VIZ;
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
    // recharts 3.x: `content` must be a FUNCTION to receive each node's geometry
    // (x/y/width/height/index). A static element is rendered once with no geometry —
    // every rect collapses to 0×0 and the treemap reads as a blank box.
    <Treemap width={width} height={height} data={data} dataKey="size" isAnimationActive={false} content={(props) => <TreemapCell {...props} colors={colors} fscale={fscale} />}>
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
  index?: number; payload?: { name?: string }; colors?: string[]; containerWidth?: number; fscale?: number;
};
function SankeyNodeShape({ x = 0, y = 0, width = 0, height = 0, index = 0, payload, colors = [], containerWidth = 0, fscale = 1 }: SankeyNodeProps) {
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
      // Function form (not a static element) so each node receives its geometry —
      // same recharts 3.x requirement as Treemap's content (else nodes are 0-size).
      // recharts' node props DON'T carry containerWidth, so pass the figure width
      // through — SankeyNodeShape uses it to flip labels to the outer side (else
      // every node reads as "right half" and the left column's labels fly off-canvas).
      node={(props) => <SankeyNodeShape {...props} colors={colors} containerWidth={width} fscale={fscale} />}
      // Labels sit INWARD (left column → right, right column → left; see
      // SankeyNodeShape), so no wide outer gutter is needed — small even margins
      // let the flow diagram fill the figure width.
      margin={{ top: 6, right: 10, bottom: 6, left: 10 }}
    >
      {SLICE_TIP}
    </Sankey>
  );
}

// ─── Composed (multi-series) ──────────────────────────────────────────────────
// Each COLUMN of the matrix is a series over the row index: column 0 draws as bars,
// the rest as lines (the classic "bars + trend line" combo), coloured categorically.
export function ComposedView({ matrix, width, height, fscale = 1 }: {
  matrix: (number | null)[][]; width: number; height: number; fscale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9 * fscale, fill: axis } as const;
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
export function BubbleView({ matrix, width, height, fscale = 1 }: {
  matrix: (number | null)[][]; width: number; height: number; fscale?: number;
}) {
  const { grid, axis } = useChartColors();
  const colors = useSeriesColors();
  const AXIS = { fontSize: 9 * fscale, fill: axis } as const;
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
// A diverged leaf (its extreme sent the output non-finite) has no finite swing —
// drawn as a full-width MUTED bar so it reads as "off the chart", not as a real
// magnitude to compare against the coloured swings.
const DIVERGED = "var(--text-dim)";

export type TornadoBar = {
  label: string; offset: number; range: number; rising: boolean;
  diverged?: boolean;
  // Carried for the readout so the RAW swing can be read against the width of the
  // perturbation that produced it (the basis marker), not silently normalized.
  outLow?: number; outHigh?: number; inLow?: number; inHigh?: number; basis?: "slider" | "number";
};

// The hover readout: output swing, the INPUT swing that drove it, and the basis
// (slider full-range vs number ±10%) — so a wide slider bar isn't mistaken for a
// like-for-like comparison against a narrow number nudge.
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

// Fits the wide card (240px) minus body padding — a hardcoded 260 overflowed the
// card and clipped on the right (matches ChartNode's W). Exported so the Suspense
// fallback box reserves the same width.
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
