import { ClassicPreset } from "rete";
import { numIn, numListIn, numListOut, numOut, tableIn, tableOut, strIn, strOut, chartOut } from "./shared";
import { parseChartOptions, serializeChartOptions, type ChartOptions } from "./chartOptions";
import type { ChartValue, KpiPayload, BulletPayload } from "../chartValue";
import type { MermaidValue } from "../mermaidValue";

// ─── Visual output nodes ────────────────────────────────────────────────────
// Pass-through "sinks" that render a chart of the value flowing through them, so
// they can sit inline in a chain (value in → same value out) the way Display
// does. The chart itself is drawn by the React component (recharts); the class
// only caches the value it received for the component to read.

export type SparklineOp = "line" | "area" | "column";

export const SPARKLINE_OP_META = {
  line:   { label: "Line" },
  area:   { label: "Area" },
  column: { label: "Column" },
} satisfies Record<SparklineOp, { label: string }>;

// ─── Sparkline ────────────────────────────────────────────────────────────────
// A tiny, axis-less inline chart of a list — Excel's SPARKLINE.

export class SparklineNode extends ClassicPreset.Node {
  label: string;
  op: SparklineOp;
  cachedResult: number | number[] | null = null;
  width = 240;
  height = 150;

  constructor(init?: { label?: string; op?: SparklineOp }) {
    super("Sparkline");
    this.label = init?.label ?? "Sparkline";
    // "bar" was the earlier name for the (always-vertical) column sparkline.
    this.op = (init?.op as string) === "bar" ? "column" : (init?.op ?? "line");
    this.addInput("values", numListIn("Values"));
    this.addOutput("result", numListOut("Pass-through"));
  }

  data(inputs: { values?: (number | number[])[] }) {
    const v = inputs.values?.[0] ?? null;
    this.cachedResult = v;
    return { result: v };
  }
}

// ─── Chart ──────────────────────────────────────────────────────────────────
// A larger chart with axes for a list — column / bar / line / area via an op
// dropdown (the composable "one node, op selector" pattern).

export type ChartOp =
  | "column" | "bar" | "line" | "area"
  | "pie" | "radar" | "radialbar" | "funnel" | "scatter";

export const CHART_OP_META = {
  column:    { label: "Column" },
  bar:       { label: "Bar" },
  line:      { label: "Line" },
  area:      { label: "Area" },
  pie:       { label: "Pie" },
  radar:     { label: "Radar" },
  radialbar: { label: "Radial" },
  funnel:    { label: "Funnel" },
  scatter:   { label: "Scatter" },
} satisfies Record<ChartOp, { label: string }>;

export class ChartNode extends ClassicPreset.Node {
  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  // Parsed matplotlib-style options from the `options` socket (Chart Builder, or
  // a string typed into the inline field). The component reads this to apply
  // title/axes/color/grid/etc.; what sets Chart apart from the minimal Sparkline.
  chartOptions: ChartOptions = {};
  // The inline options text (used when the Options socket isn't wired).
  stringLiterals: Record<string, string> = {};
  width = 240;
  height = 240;

  constructor(init?: { label?: string; op?: ChartOp }) {
    super("Chart");
    this.label = init?.label ?? "Chart";
    this.op = init?.op ?? "column";
    this.addInput("values", numListIn("Values"));
    this.addInput("options", strIn("Options"));
    // A Chart is a terminal figure, not a data pass-through (nothing consumed the
    // old numlist `result` — a chart is a sink). Its output is the first-class
    // chart VALUE: the `chart` object socket (identity-only + `any`, like lambda)
    // carries a self-describing figure a consumer redraws — the Report renders it
    // inline where its `=name` ref sits (charts' main destination).
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: (number | number[])[]; options?: string[] }): { chart: ChartValue } {
    const v = inputs.values?.[0] ?? null;
    this.cachedResult = v;
    this.chartOptions = parseChartOptions(inputs.options?.[0] ?? this.stringLiterals.options ?? null);
    const chart: ChartValue = {
      __chart: true,
      op: this.op,
      values: this.cachedResult,
      options: this.chartOptions,
      title: this.chartOptions.title || this.label || "Chart",
    };
    return { chart };
  }
}

// ─── Histogram ────────────────────────────────────────────────────────────────
// Bins a numeric list into `bins` equal-width buckets and plots the counts as a
// column chart. A terminal figure like Chart (emits the chart VALUE), so a Report
// embeds it. Bin ranges are equal-width over the data's own [min, max]; the last
// bin is closed so the maximum lands in it.

/** Count how many values fall in each of `k` equal-width bins over [min,max]. */
export function histogramBins(vals: (number | null)[], k: number): number[] {
  const nums = vals.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const bins = Math.max(1, Math.min(100, Math.floor(k) || 1));
  if (nums.length === 0) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const counts = new Array<number>(bins).fill(0);
  if (min === max) { counts[0] = nums.length; return counts; } // one spike
  const w = (max - min) / bins;
  for (const x of nums) {
    let idx = Math.floor((x - min) / w);
    if (idx >= bins) idx = bins - 1; // closed last bin
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return counts;
}

export class HistogramNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { bins: 10 };
  chartOptions: ChartOptions = {};
  stringLiterals: Record<string, string> = {};
  cachedResult: number[] | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string }) {
    super("Histogram");
    this.label = init?.label ?? "Histogram";
    this.addInput("values", numListIn("Values"));
    this.addInput("bins", numIn("Bins"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: (number | number[])[]; bins?: number[]; options?: string[] }): { chart: ChartValue } {
    const raw = inputs.values?.[0] ?? null;
    const list = Array.isArray(raw) ? raw : raw === null ? [] : [raw];
    const bins = inputs.bins?.[0] ?? this.literals.bins ?? 10;
    this.literals.bins = bins;
    const counts = histogramBins(list as (number | null)[], bins);
    this.cachedResult = counts;
    this.chartOptions = parseChartOptions(inputs.options?.[0] ?? this.stringLiterals.options ?? null);
    const chart: ChartValue = {
      __chart: true,
      op: "column",
      values: counts,
      options: this.chartOptions,
      title: this.chartOptions.title || this.label || "Histogram",
    };
    return { chart };
  }
}

// ─── Mermaid ──────────────────────────────────────────────────────────────────
// A diagram node: mermaid.js source in → a figure out. Emits the first-class
// mermaid VALUE down the same `chart` object socket a Chart uses (the green
// "Special" family), so a Report renders it inline where its `=name` ref sits,
// exactly like a chart. The source is typed on the card (or wired from a Text /
// Note via the `source` socket); the SVG is drawn lazily in the component. Per
// the standing rule, rich visuals are node outputs, not Report markdown features.

const DEFAULT_MERMAID = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]";

export class MermaidNode extends ClassicPreset.Node {
  label: string;
  // The inline diagram source (used when the `source` socket isn't wired). Stored
  // in stringLiterals so it round-trips through persistence with no extra plumbing
  // (persistence.ts restores stringLiterals for every node).
  stringLiterals: Record<string, string> = {};
  cachedSource = "";
  width = 260;
  height = 240;

  constructor(init?: { label?: string }) {
    super("Mermaid");
    this.label = init?.label ?? "Mermaid";
    this.stringLiterals.source = DEFAULT_MERMAID;
    this.addInput("source", strIn("Source"));
    this.addOutput("diagram", chartOut("Diagram"));
  }

  data(inputs: { source?: string[] }): { diagram: MermaidValue } {
    const src = inputs.source?.[0] ?? this.stringLiterals.source ?? "";
    this.cachedSource = src;
    const diagram: MermaidValue = {
      __mermaid: true,
      source: src,
      title: this.label || "Diagram",
    };
    return { diagram };
  }
}

// ─── Gauge ────────────────────────────────────────────────────────────────────
// A radial gauge of a scalar within [min, max]. Pass-through value out.

export class GaugeNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0, min: 0, max: 100 };
  cachedResult: number | null = null;
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Gauge");
    this.label = init?.label ?? "Gauge";
    this.addInput("value", numIn("Value"));
    this.addInput("min",   numIn("Min"));
    this.addInput("max",   numIn("Max"));
    this.addOutput("result", numOut("Pass-through"));
  }

  data(inputs: { value?: number[]; min?: number[]; max?: number[] }) {
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    // min/max read by the component for the dial scale; mirror live inputs so a
    // wired bound is honoured there too.
    this.literals.min = inputs.min?.[0] ?? this.literals.min ?? 0;
    this.literals.max = inputs.max?.[0] ?? this.literals.max ?? 100;
    this.cachedResult = v;
    return { result: v };
  }
}

// ─── KPI / Stat card ──────────────────────────────────────────────────────────
// A big-number readout with a ↑/↓ delta vs a prior value. Emits a chart VALUE so a
// Report embeds it. `goodUp` (1/0) picks whether a rise is green (revenue) or red
// (cost); `unit` is a short suffix typed on the card.

export class KpiNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0, prev: 0, goodUp: 1 };
  stringLiterals: Record<string, string> = { unit: "" };
  chartOptions: ChartOptions = {};
  cachedPayload: KpiPayload | null = null;
  width = 180;
  height = 170;

  constructor(init?: { label?: string }) {
    super("KPI");
    this.label = init?.label ?? "KPI";
    this.addInput("value", numIn("Value"));
    this.addInput("prev", numIn("Prior"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; prev?: number[] }): { chart: ChartValue } {
    const value = inputs.value?.[0] ?? this.literals.value ?? null;
    const prev = inputs.prev?.[0] ?? this.literals.prev ?? null;
    if (inputs.value?.[0] === undefined) this.literals.value = value ?? 0;
    if (inputs.prev?.[0] === undefined) this.literals.prev = prev ?? 0;
    const payload: KpiPayload = {
      kind: "kpi",
      value,
      prev,
      unit: this.stringLiterals.unit ?? "",
      goodUp: (this.literals.goodUp ?? 1) !== 0,
    };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "kpi", values: value, payload, options: this.chartOptions, title: this.label || "KPI" },
    };
  }
}

// ─── Bullet graph ─────────────────────────────────────────────────────────────
// A value bar on a min..max track with a target tick (Stephen Few's bullet graph —
// a compact gauge alternative). Emits a chart VALUE so a Report embeds it.

export class BulletNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0, target: 80, max: 100 };
  chartOptions: ChartOptions = {};
  cachedPayload: BulletPayload | null = null;
  width = 240;
  height = 130;

  constructor(init?: { label?: string }) {
    super("Bullet");
    this.label = init?.label ?? "Bullet";
    this.addInput("value", numIn("Value"));
    this.addInput("target", numIn("Target"));
    this.addInput("max", numIn("Max"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; target?: number[]; max?: number[] }): { chart: ChartValue } {
    const value = inputs.value?.[0] ?? this.literals.value ?? null;
    const target = inputs.target?.[0] ?? this.literals.target ?? null;
    const max = inputs.max?.[0] ?? this.literals.max ?? 100;
    if (inputs.value?.[0] === undefined) this.literals.value = value ?? 0;
    if (inputs.target?.[0] === undefined) this.literals.target = target ?? 0;
    if (inputs.max?.[0] === undefined) this.literals.max = max;
    const payload: BulletPayload = { kind: "bullet", value, target, min: 0, max };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "bullet", values: value, payload, options: this.chartOptions, title: this.label || "Bullet" },
    };
  }
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
// Colours every cell of a Table on a cool→warm gradient spanning the data's own
// min..max (conditional formatting). Pass-through: the Table flows on unchanged;
// the colour grid is drawn in the component.

export class HeatmapCellNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number[][] | null = null;
  width = 240;
  height = 200;

  constructor(init?: { label?: string }) {
    super("HeatmapCell");
    this.label = init?.label ?? "Heatmap";
    this.addInput("table", tableIn("Table"));
    this.addOutput("result", tableOut("Pass-through"));
  }

  data(inputs: { table?: number[][][] }) {
    const t = inputs.table?.[0] ?? null;
    this.cachedResult = t;
    return { result: t };
  }
}

// ─── Chart Builder ────────────────────────────────────────────────────────────
// A labelled "Concat for chart options": many small fields (one per matplotlib
// option) whose values are joined into the `key=value;…` string the Chart node's
// Options socket consumes. Every field is also an input socket, so any value can
// be wired from upstream (e.g. a computed title or a slider-driven Y max).

// The string fields go through `stringLiterals`, the numeric ones through
// `literals` — the same inline stores InlineInputs reads/writes, so they
// round-trip through persistence with no extra plumbing.
const CB_STR_FIELDS = ["title", "xlabel", "ylabel", "color", "grid", "marker"] as const;
const CB_NUM_FIELDS = ["ymin", "ymax", "linewidth", "alpha"] as const;

export class ChartBuilderNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  cachedString = "";
  width = 200;
  height = 200;

  constructor(init?: { label?: string }) {
    super("ChartBuilder");
    this.label = init?.label ?? "Chart Builder";
    this.addInput("title",     strIn("Title"));
    this.addInput("xlabel",    strIn("X label"));
    this.addInput("ylabel",    strIn("Y label"));
    this.addInput("color",     strIn("Color"));
    this.addInput("grid",      strIn("Grid (on/off)"));
    this.addInput("marker",    strIn("Markers (on/off)"));
    this.addInput("ymin",      numIn("Y min"));
    this.addInput("ymax",      numIn("Y max"));
    this.addInput("linewidth", numIn("Line width"));
    this.addInput("alpha",     numIn("Fill alpha"));
    this.addOutput("result", strOut("Options"));
  }

  data(inputs: Record<string, unknown[]>) {
    const str = (k: string) => (inputs[k]?.[0] as string | undefined) ?? this.stringLiterals[k];
    const num = (k: string) => {
      const wired = inputs[k]?.[0] as number | undefined;
      return wired ?? this.literals[k];
    };
    const out = serializeChartOptions({
      title:     str("title"),
      xlabel:    str("xlabel"),
      ylabel:    str("ylabel"),
      color:     str("color"),
      grid:      str("grid"),
      marker:    str("marker"),
      ymin:      num("ymin"),
      ymax:      num("ymax"),
      linewidth: num("linewidth"),
      alpha:     num("alpha"),
    });
    this.cachedString = out;
    return { result: out };
  }
}

// Exported so the component (and tests) share the field lists.
export const CHART_BUILDER_FIELDS = { str: CB_STR_FIELDS, num: CB_NUM_FIELDS };
