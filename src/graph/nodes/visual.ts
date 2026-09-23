// [[C63]], [[B11]], [[C8]] declareOnce
import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, tableIn, tableOut, strIn, strOut, chartIn, chartOut, frameIn, cubeAdoptIn } from "./shared";
import { parseChartOptions, serializeChartOptions, type ChartOptions, type ChartTargetId } from "./chartOptions";
import { clamp, iterMin, iterMax, gridAxes } from "./mathUtils";
import { histogram2d } from "./visualOps";
export { histogram2d } from "./visualOps";
import { isChartValue } from "../chartValue";
import type {
  ChartValue, KpiPayload, ScalePayload, ProportionPayload, SankeyPayload, SurfacePayload,
  ContourPayload, WaterfallPayload, CandlePayload, BoxplotPayload, CalHeatPayload, QuiverPayload,
  RecordPayload, RecordField, RecordSize, OverlaySeries, OverlayPayload,
} from "../chartValue";
import { solError, type SolError } from "../errorValue";
import { columnUnitLabel } from "../unitColumn";
import type { MermaidValue } from "../mermaidValue";
import { readFrame, type FrameInput } from "../frameBackend";
import type { FrameHint } from "../frameHint";
import { formatFrameCell, isFrameValue, isCubeValue, flatCubeToFrame, type FrameColumn } from "../frame";
import { isSolError } from "../errorValue";
import { parseRecordLayout, recordImageSrc, type RecordPlacement } from "../recordLayout";

export type SparklineOp = "line" | "column" | "winloss";

export const SPARKLINE_OP_META = {
  line:    { label: "Line" },
  column:  { label: "Column" },
  winloss: { label: "Win/Loss" },
} satisfies Record<SparklineOp, { label: string }>;

// ─── Sparkline ────────────────────────────────────────────────────────────────

export class SparklineNode extends ClassicPreset.Node {
  label: string;
  op: SparklineOp;
  chartOptions: ChartOptions = {};
  cachedResult: number | number[] | null = null;
  width = 240;
  height = 150;

  constructor(init?: { label?: string; op?: SparklineOp }) {
    super("Sparkline");
    this.label = init?.label ?? "";
    const raw = init?.op as string | undefined;
    this.op = raw === "bar" ? "column" : raw === "area" ? "line" : ((raw as SparklineOp) ?? "line");
    this.addInput("values", numListIn("Values"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: (number | number[])[] }): { chart: ChartValue } {
    const raw = inputs.values?.[0] ?? null;
    this.cachedResult = raw;
    const cells = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
    const signed = this.op === "winloss" ? cells.map((n) => (n === null ? null : Math.sign(n))) : cells;
    const chart: ChartValue = {
      __chart: true,
      op: this.op === "winloss" ? "column" : this.op,
      values: signed.filter((n): n is number => n !== null),
      series: [{ name: this.label || "Sparkline", values: signed }],
      options: this.chartOptions,
      title: this.label || "Sparkline",
    };
    return { chart };
  }
}

// ─── Chart ──────────────────────────────────────────────────────────────────

export type ChartOp =
  | "column" | "bar" | "line" | "area"
  | "pie" | "radar" | "radialbar" | "funnel" | "scatter"
  | "composed" | "bubble";

export const CHART_OP_META = {
  column:    { label: "Column",   group: "Cartesian" },
  bar:       { label: "Bar",      group: "Cartesian" },
  line:      { label: "Line",     group: "Cartesian" },
  area:      { label: "Area",     group: "Cartesian" },
  scatter:   { label: "Scatter",  group: "Cartesian" },
  pie:       { label: "Pie",      group: "Categorical" },
  radar:     { label: "Radar",    group: "Categorical" },
  radialbar: { label: "Radial",   group: "Categorical" },
  funnel:    { label: "Funnel",   group: "Categorical" },
  composed:  { label: "Composed", group: "Multi-series" },
  bubble:    { label: "Bubble",   group: "Multi-series" },
} satisfies Record<ChartOp, { label: string; group: string }>;

export class ChartNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "A list plots by position; a frame's first column is x, later number columns are series. Radar: columns are spokes, rows polygons. Bubble: x, y, size.",
    options: "Accepts key=value pairs separated by semicolons, using matplotlib names such as title, ylim, and grid. Unknown keys are ignored.",
  };

  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  cachedSeries: { name: string; values: (number | null)[] }[] | null = null;
  cachedLabels: (string | number)[] | null = null;
  // Uncoerced, because coercion would widen a wired list into a single frame row.
  rawInputs: ReadonlySet<string> = new Set(["values"]);
  chartOptions: ChartOptions = {};
  stringLiterals: Record<string, string> = {};
  width = 240;
  height = 240;

  static frameHints: Record<string, FrameHint> = {
    values: { columns: [
      { name: "Label", type: "string", cells: ["Jan", "Feb", "Mar"] },
      { name: "Sales", type: "number", cells: [120, 145, 98] },
      { name: "Target", type: "number", cells: [130, 130, 130] },
    ] },
  };

  constructor(init?: { label?: string; op?: ChartOp }) {
    super("Chart (Recharts)");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "column";
    this.addInput("values", cubeAdoptIn("Data"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: unknown[]; options?: string[] }): { chart: ChartValue } {
    const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
    const raw0 = inputs.values?.[0] ?? null;
    const flat = isCubeValue(raw0) ? flatCubeToFrame(raw0, "scalar") : raw0;
    const raw = isSolError(flat) ? null : flat;
    this.cachedLabels = null;
    this.cachedSeries = null;
    let v: number | number[] | null = null;
    if (isFrameValue(raw) && raw.columns.length > 0) {
      const cols = raw.columns;
      const asNums = (col: FrameColumn) => col.values.map(num);
      if (this.op === "bubble") {
        const pts = cols.filter((c) => c.type === "number").slice(0, 3).map((c) => ({ name: c.name, values: asNums(c) }));
        this.cachedSeries = pts.length > 0 ? pts : null;
        v = pts.length > 0 ? (pts[0].values as unknown as number[]) : null;
      } else if (this.op === "radar" && cols.length >= 2) {
        const labelCol = cols[0];
        const numCols = cols.slice(1).filter((c) => c.type === "number");
        this.cachedLabels = numCols.map((c) => c.name);
        const series = labelCol.values.map((cell, r) => ({
          name: String(formatFrameCell(labelCol.type, cell) ?? `Row ${r + 1}`),
          values: numCols.map((c) => num(c.values[r])),
        }));
        v = series.length > 0 ? (series[0].values as unknown as number[]) : null;
        this.cachedSeries = series.length >= 2 ? series : null;
      } else if (cols.length >= 2) {
        this.cachedLabels = cols[0].values.map((c) => formatFrameCell(cols[0].type, c) ?? "");
        const series = cols.slice(1).filter((c) => c.type === "number").map((c) => ({ name: c.name, values: asNums(c) }));
        v = series.length > 0 ? (series[0].values as unknown as number[]) : null;
        this.cachedSeries = series.length >= 2 ? series : null;
      } else {
        v = asNums(cols[0]) as unknown as number[];
      }
    } else if (Array.isArray(raw)) {
      v = raw.map(num) as unknown as number[];
    } else if (typeof raw === "number") {
      v = num(raw);
    }
    this.cachedResult = v;
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    const optStr = typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(optStr);
    if (this.op === "bubble" && this.cachedSeries) {
      const [x, y] = this.cachedSeries;
      if (this.chartOptions.xlabel === undefined && x) this.chartOptions.xlabel = x.name;
      if (this.chartOptions.ylabel === undefined && y) this.chartOptions.ylabel = y.name;
    }
    const chart: ChartValue = {
      __chart: true,
      op: this.op,
      values: this.cachedResult,
      series: this.cachedSeries ?? undefined,
      labels: this.cachedLabels ?? undefined,
      options: this.chartOptions,
      title: this.chartOptions.title || this.label || "Chart",
    };
    return { chart };
  }
}

// ─── Merge Plots ──────────────────────────────────────────────────────────────

export const PLANAR_CHART_OPS = new Set<ChartValue["op"]>(["line", "area", "column", "bar", "scatter"]);

export class MergePlotsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    options: "key=value pairs separated by semicolons, or a Chart Builder. Styles the merged plot's axes and title; each series keeps its own color and marker size.",
  };

  label: string;
  nextInputId = 0;
  chartOptions: ChartOptions = {};
  stringLiterals: Record<string, string> = {};
  cachedChart: ChartValue | SolError | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("MergePlots");
    this.label = init?.label ?? "";
    const plots = (init?.valueKeys ?? []).filter((k) => /^p\d+$/.test(k));
    if (plots.length) {
      for (const k of plots) this.addPlotWithKey(k);
    } else {
      this.addValueInput();
      this.addValueInput();
    }
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  private addPlotWithKey(key: string): void {
    this.addInput(key, chartIn(`Plot ${key.replace(/^p/, "")}`));
    const n = parseInt(key.replace(/^p/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  plotKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => /^p\d+$/.test(k));
  }

  addValueInput(): string {
    const key = `p${this.nextInputId}`;
    this.addPlotWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError } {
    const series: OverlaySeries[] = [];
    let labels: (string | number)[] | undefined;
    let refusal: SolError | null = null;
    this.plotKeys().forEach((key, i) => {
      const cv = inputs[key]?.[0];
      if (cv == null || !isChartValue(cv)) return;
      if (!PLANAR_CHART_OPS.has(cv.op)) {
        refusal ??= solError("#TYPE!", `Plot ${i + 1} is a ${cv.op} chart, which has no x/y plane to overlay`);
        return;
      }
      const kind = cv.op as OverlaySeries["kind"];
      const style = {
        color: cv.options?.color || undefined,
        markersize: cv.options?.markersize,
        linewidth: cv.options?.linewidth,
        alpha: cv.options?.alpha,
        marker: cv.options?.marker,
      };
      if (cv.series && cv.series.length > 0) {
        for (const s of cv.series) series.push({ name: s.name, kind, values: s.values, ...style });
      } else if (Array.isArray(cv.values)) {
        series.push({ name: cv.title ?? "", kind, values: cv.values, ...style });
      } else if (typeof cv.values === "number") {
        series.push({ name: cv.title ?? "", kind, values: [cv.values], ...style });
      }
      if (!labels && cv.labels && cv.labels.length > 0) labels = cv.labels;
    });
    this.chartOptions = parseChartOptions(readInput(inputs.options as string[] | undefined, this.stringLiterals.options ?? null));
    if (refusal) { this.cachedChart = refusal; return { chart: refusal }; }
    const payload: OverlayPayload = { kind: "overlay", series, labels };
    const chart: ChartValue = {
      __chart: true, op: "overlay", values: null, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Merged Plot",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Histogram ────────────────────────────────────────────────────────────────

export function histogramBins(vals: (number | null)[], k: number): number[] | SolError {
  const nums = vals.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!Number.isFinite(k) || Math.floor(k) < 1) return solError("#DOMAIN!", "Bins must be 1 or more");
  const bins = clamp(Math.floor(k), 1, 100);
  if (nums.length === 0) return [];
  const min = iterMin(nums);
  const max = iterMax(nums);
  const counts = new Array<number>(bins).fill(0);
  if (min === max) { counts[0] = nums.length; return counts; }
  const w = (max - min) / bins;
  for (const x of nums) {
    let idx = Math.floor((x - min) / w);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return counts;
}

export type HistogramMode = "1d" | "2d";
export const HISTOGRAM_MODE_META = {
  "1d": { label: "1-D", description: "Bin one list of numbers into equal-width buckets, plotted as columns." },
  "2d": { label: "2-D", description: "Bin paired X and Y numbers into a grid, drawn as a density plot. numpy `histogram2d`." },
} satisfies Record<HistogramMode, { label: string; description: string }>;

const listOf = (raw: number | number[] | null | undefined): (number | null)[] =>
  Array.isArray(raw) ? raw : raw == null ? [] : [raw];

export class HistogramNode extends ClassicPreset.Node {
  label: string;
  mode: HistogramMode;
  literals: Record<string, number> = { bins: 10, ybins: 10 };
  chartOptions: ChartOptions = {};
  stringLiterals: Record<string, string> = {};
  cachedResult: number[] | null = null;
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string; mode?: HistogramMode }) {
    super("Histogram");
    this.label = init?.label ?? "Histogram";
    this.mode = init?.mode === "2d" ? "2d" : "1d";
    this.addInput("values", numListIn(this.mode === "2d" ? "X" : "Values"));
    this.addInput("bins", numIn(this.mode === "2d" ? "X bins" : "Bins"));
    if (this.mode === "2d") {
      this.addInput("y", numListIn("Y"));
      this.addInput("ybins", numIn("Y bins"));
    }
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  keysDroppedByMode(next: HistogramMode): string[] {
    return next === "1d" ? ["y", "ybins"] : [];
  }

  setMode(next: HistogramMode): void {
    if (next === this.mode) return;
    this.mode = next;
    // Re-add Options so it stays the last row.
    if (this.inputs.options) this.removeInput("options");
    if (next === "2d") {
      if (!this.inputs.y) this.addInput("y", numListIn("Y"));
      if (!this.inputs.ybins) this.addInput("ybins", numIn("Y bins"));
    } else {
      if (this.inputs.y) this.removeInput("y");
      if (this.inputs.ybins) this.removeInput("ybins");
    }
    this.addInput("options", strIn("Options"));
    this.literals.ybins ??= 10;
  }

  data(inputs: { values?: (number | number[])[]; bins?: number[]; y?: (number | number[])[]; ybins?: number[]; options?: string[] }): { chart: ChartValue | SolError } {
    const xs = listOf(inputs.values?.[0] ?? null);
    // Mirror to the card only when unwired: a wired value written into `literals` would be saved.
    const kx = readInput(inputs.bins, this.literals.bins ?? 10);
    if (inputs.bins?.[0] === undefined && kx !== null) this.literals.bins = kx;
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const title = this.chartOptions.title || this.label || "Histogram";

    if (this.mode === "2d") {
      const ys = listOf(inputs.y?.[0] ?? null);
      const ky = readInput(inputs.ybins, this.literals.ybins ?? 10);
      if (inputs.ybins?.[0] === undefined && ky !== null) this.literals.ybins = ky;
      const h = kx === null || ky === null ? null : histogram2d(xs, ys, kx, ky);
      this.cachedResult = null;
      const z = h ? h.yEdges.map((_, j) => h.counts.map((col) => col[j])) : [];
      const payload: ContourPayload = { kind: "contour", xs: h?.xEdges ?? [], ys: h?.yEdges ?? [], z, levels: 10 };
      const chart: ChartValue = { __chart: true, op: "contour", values: null, payload, options: this.chartOptions, title };
      this.cachedChart = h ? chart : null;
      return { chart };
    }

    const counts = kx === null ? [] : histogramBins(xs, kx);
    if (isSolError(counts)) { this.cachedResult = null; this.cachedChart = null; return { chart: counts }; }
    this.cachedResult = counts;
    const chart: ChartValue = { __chart: true, op: "column", values: counts, options: this.chartOptions, title };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Mermaid ──────────────────────────────────────────────────────────────────

const DEFAULT_MERMAID = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]";

export class MermaidNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  cachedSource = "";
  width = 260;
  height = 240;

  constructor(init?: { label?: string }) {
    super("Mermaid Charts");
    this.label = init?.label ?? "Mermaid Charts";
    this.stringLiterals.source = DEFAULT_MERMAID;
    this.addInput("source", strIn("Source"));
    this.addOutput("diagram", chartOut("Diagram"));
  }

  data(inputs: { source?: string[] }): { diagram: MermaidValue } {
    const src = readInput(inputs.source, this.stringLiterals.source ?? "") ?? "";
    this.cachedSource = src;
    const diagram: MermaidValue = {
      __mermaid: true,
      source: src,
      title: this.label || "Diagram",
    };
    return { diagram };
  }
}

// ─── Gauge ─────────────────────────────────────────────────────────────────────
export type GaugeStyle = "dial" | "bar";
export const GAUGE_STYLE_META = {
  dial: { label: "Dial" },
  bar:  { label: "Bar" },
} satisfies Record<GaugeStyle, { label: string }>;
export const GAUGE_STYLE_OPTIONS = Object.entries(GAUGE_STYLE_META).map(([value, m]) => ({ value: value as GaugeStyle, label: m.label }));

export class GaugeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Dial reads it as a fraction of one, so 0.75 shows as 75 percent on a dial fixed at 0 to 100 percent; Bar plots it on the 0 to Max track.",
    target: "Bar only: the target tick on the track.",
    max: "Bar only: the track always starts at zero, so this sets only its upper end.",
  };

  label: string;
  mode: GaugeStyle = "dial";
  literals: Record<string, number> = { value: 0, target: 80, max: 100 };
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: ScalePayload | null = null;
  width = 200;
  height = 200;

  constructor(init?: { label?: string; mode?: GaugeStyle }) {
    super("Gauge");
    this.label = init?.label ?? "";
    if (init?.mode === "bar") this.mode = "bar";
    this.addInput("value", numIn("Value"));
    if (this.mode === "bar") this.addBarInputs();
    this.addOutput("chart", chartOut("Chart"));
  }

  private addBarInputs(): void {
    this.addInput("target", numIn("Target"));
    this.addInput("max", numIn("Max"));
    this.addInput("options", strIn("Options"));
  }

  keysDropped(next: GaugeStyle): string[] {
    return next === "dial" && this.mode === "bar" ? ["target", "max", "options"] : [];
  }

  setMode(next: GaugeStyle): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "dial") {
      for (const k of ["target", "max", "options"]) if (this.inputs[k]) this.removeInput(k);
    } else {
      this.addBarInputs();
    }
  }

  data(inputs: { value?: number[]; target?: number[]; max?: number[]; options?: string[] }): { chart: ChartValue } {
    const value = readInput(inputs.value, this.literals.value ?? null);
    if (inputs.value?.[0] === undefined) this.literals.value = value ?? 0;
    let payload: ScalePayload;
    let title: string;
    if (this.mode === "bar") {
      const target = readInput(inputs.target, this.literals.target ?? null);
      const max = readInput(inputs.max, this.literals.max ?? 100) ?? (this.literals.max ?? 100);
      if (inputs.target?.[0] === undefined) this.literals.target = target ?? 0;
      if (inputs.max?.[0] === undefined) this.literals.max = max;
      this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
      payload = { kind: "scale", style: "bar", value, target, min: 0, max };
      title = this.chartOptions.title || this.label || "Gauge";
    } else {
      this.chartOptions = {};
      payload = { kind: "scale", style: "dial", value, target: null, min: 0, max: 1 };
      title = this.label || "Gauge";
    }
    this.cachedPayload = payload;
    return { chart: { __chart: true, op: "scale", values: value, payload, options: this.chartOptions, title } };
  }
}


// ─── KPI / Stat card ──────────────────────────────────────────────────────────

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
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; prev?: number[]; options?: string[] }): { chart: ChartValue } {
    const value = readInput(inputs.value, this.literals.value ?? null);
    const prev = readInput(inputs.prev, this.literals.prev ?? null);
    if (inputs.value?.[0] === undefined) this.literals.value = value ?? 0;
    if (inputs.prev?.[0] === undefined) this.literals.prev = prev ?? 0;
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: KpiPayload = {
      kind: "kpi",
      value,
      prev,
      unit: this.stringLiterals.unit ?? "",
      goodUp: (this.literals.goodUp ?? 1) !== 0,
    };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "kpi", values: value, payload, options: this.chartOptions, title: this.chartOptions.title || this.label || "KPI" },
    };
  }
}

// ─── Frame-column readers (Treemap / Sankey) ────────────────────────────────────
async function readFrameColumns(f: FrameInput | null): Promise<FrameColumn[]> {
  if (f == null) return [];
  const fv = await readFrame(f);
  return isFrameValue(fv) ? fv.columns : [];
}
function colAsStrings(col: FrameColumn | undefined): string[] {
  if (!col) return [];
  return col.values.map((v) => {
    const c = formatFrameCell(col.type, v);
    return c == null ? "" : String(c);
  });
}
function colAsNumbers(col: FrameColumn | undefined): (number | null)[] {
  if (!col) return [];
  return col.values.map((v) => {
    const c = formatFrameCell(col.type, v);
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() !== "") { const n = Number(c); if (Number.isFinite(n)) return n; }
    return null;
  });
}
const knownOnly = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

// ─── Proportion ─────────────────────────────────────────────────────────────────

export type ProportionLayout = "treemap" | "waffle";
export const PROPORTION_OP_META = {
  treemap: { label: "Treemap" },
  waffle:  { label: "Waffle" },
} satisfies Record<ProportionLayout, { label: string }>;
export const PROPORTION_LAYOUT_OPTIONS = Object.entries(PROPORTION_OP_META).map(([value, m]) => ({ value: value as ProportionLayout, label: m.label }));

export class ProportionNode extends ClassicPreset.Node {
  label: string;
  op: ProportionLayout = "treemap";
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Label", type: "string", cells: ["North", "Europe", "Asia"] },
      { name: "Value", type: "number", cells: [4200, 3100, 5600] },
    ] },
  };

  constructor(init?: { label?: string; op?: ProportionLayout }) {
    super("Proportion");
    this.label = init?.label ?? "";
    if (init?.op === "waffle") this.op = "waffle";
    this.addInput("frame", frameIn("Label + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  setOp(next: ProportionLayout): void {
    this.op = next;
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const names = colAsStrings(cols[0]);
    const values = colAsNumbers(cols[1] ?? cols[0]).map((x) => x ?? 0);
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: ProportionPayload = { kind: "proportion", layout: this.op, names, values };
    const chart: ChartValue = {
      __chart: true, op: "proportion", values, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Proportion",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Sankey ───────────────────────────────────────────────────────────────────

export function acyclicFlows(sources: string[], targets: string[], values: number[]): { sources: string[]; targets: string[]; values: number[]; dropped: number } {
  const out = { sources: [] as string[], targets: [] as string[], values: [] as number[], dropped: 0 };
  const adj = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of adj.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] ?? "", t = targets[i] ?? "", v = values[i] ?? 0;
    if (!s || !t || s === t || !(v > 0)) { out.sources.push(s); out.targets.push(t); out.values.push(v); continue; }
    if (reaches(t, s)) { out.dropped++; continue; }
    if (!adj.has(s)) adj.set(s, new Set());
    adj.get(s)!.add(t);
    out.sources.push(s); out.targets.push(t); out.values.push(v);
  }
  return out;
}

export class SankeyNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: SankeyPayload | null = null;
  droppedLoops = 0;
  width = 260;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "From", type: "string", cells: ["Solar", "Wind", "Grid"] },
      { name: "To", type: "string", cells: ["Grid", "Grid", "Homes"] },
      { name: "Value", type: "number", cells: [40, 35, 60] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Sankey");
    this.label = init?.label ?? "Sankey";
    this.addInput("frame", frameIn("From + To + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue | SolError }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const raw = { sources: colAsStrings(cols[0]), targets: colAsStrings(cols[1]), values: colAsNumbers(cols[2]).map((x) => x ?? 0) };
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const { sources, targets, values, dropped } = acyclicFlows(raw.sources, raw.targets, raw.values);
    this.droppedLoops = dropped;
    const drawable = sources.some((s, i) => !!s && !!targets[i] && s !== targets[i] && values[i] > 0);
    if (dropped > 0 && !drawable) {
      const err = solError("#SHAPE!", "The flows form a loop; a Sankey needs a direction");
      this.cachedPayload = null;
      return { chart: err };
    }
    const payload: SankeyPayload = { kind: "sankey", sources, targets, values };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "sankey", values, payload, options: this.chartOptions, title: this.chartOptions.title || this.label || "Sankey" },
    };
  }
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

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

// ─── Surface (shaded 3-D plot) ──────────────────────────────────────────────────

function surfaceAxes(zRaw: unknown, xsRaw: unknown, ysRaw: unknown): { xs: number[]; ys: number[]; z: (number | null)[][] } {
  const axes = gridAxes(zRaw, xsRaw, ysRaw);
  return axes != null && Array.isArray((axes as { z?: unknown }).z)
    ? (axes as { xs: number[]; ys: number[]; z: (number | null)[][] })
    : { xs: [], ys: [], z: [] };
}

export type SurfaceViewOp = "surface" | "contour";

export const SURFACE_VIEW_OP_META = {
  surface: { label: "3-D",  description: "A shaded 3-D surface plot over a table of heights, with optional Xs and Ys coordinate lists; unwired axes count 1, 2, 3…" },
  contour: { label: "Flat", description: "The same table drawn flat: filled height bands with iso-lines." },
} satisfies Record<SurfaceViewOp, { label: string; description: string }>;

export class SurfaceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    xs: "One X coordinate per column; unwired means 1, 2, 3…",
    ys: "One Y coordinate per row; unwired means 1, 2, 3…",
  };

  label: string;
  op: SurfaceViewOp;
  literals: Record<string, number> = { yaw: 45, pitch: 45 };
  stringLiterals: Record<string, string> = { xs: "", ys: "" };
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  constructor(init?: { label?: string; op?: SurfaceViewOp; yaw?: number; pitch?: number; levels?: number }) {
    super("Surface");
    this.op = init?.op ?? "surface";
    this.label = init?.label ?? "";
    if (init?.yaw != null) this.literals.yaw = init.yaw;
    if (init?.pitch != null) this.literals.pitch = init.pitch;
    if (typeof init?.levels === "number") this.literals.levels = init.levels;
    this.addInput("z", tableIn("Table"));
    this.addInput("xs", numListIn("Xs"));
    this.addInput("ys", numListIn("Ys"));
    if (this.op === "contour") {
      this.literals.levels ??= 8;
      this.addInput("levels", numIn("Levels"));
    }
    this.addOutput("chart", chartOut("Chart"));
    this.height = this.op === "contour" ? 240 : 220;
  }

  setOp(next: SurfaceViewOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "contour") {
      this.literals.levels ??= 8;
      if (!this.inputs.levels) this.addInput("levels", numIn("Levels"));
    } else if (this.inputs.levels) {
      this.removeInput("levels");
    }
    this.height = next === "contour" ? 240 : 220;
  }

  data(inputs: { z?: unknown[]; xs?: unknown[]; ys?: unknown[]; levels?: number[] }): { chart: ChartValue } {
    const xsRaw = inputs.xs === undefined ? undefined : (inputs.xs[0] ?? null);
    const ysRaw = inputs.ys === undefined ? undefined : (inputs.ys[0] ?? null);
    const { xs, ys, z } = surfaceAxes(inputs.z?.[0] ?? null, xsRaw, ysRaw);
    if (this.op === "contour") {
      const levelsRaw = readInput(inputs.levels, this.literals.levels ?? 8);
      const levels = levelsRaw === null ? 0 : clamp(Math.round(levelsRaw), 2, 24);
      // Mirror only when unwired, so a wired value never overwrites the saved literal.
      if (inputs.levels?.[0] === undefined && levelsRaw !== null) this.literals.levels = levels;
      const payload: ContourPayload = { kind: "contour", xs, ys, z, levels };
      const chart: ChartValue = { __chart: true, op: "contour", values: null, payload, options: {}, title: this.label || "Contour" };
      this.cachedChart = chart;
      return { chart };
    }
    const payload: SurfacePayload = { kind: "surface", xs, ys, z, yaw: this.literals.yaw ?? 45, pitch: this.literals.pitch ?? 45 };
    const chart: ChartValue = {
      __chart: true, op: "surface", values: null, payload,
      options: {}, title: this.label || "Surface",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Column readers for the frame-fed figures ─────────────────────────────────
function colAsRawNumbers(col: FrameColumn | undefined): (number | null)[] {
  if (!col) return [];
  return col.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ─── Waterfall ────────────────────────────────────────────────────────────────

export class WaterfallNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "Each value is a signed change from the previous bar, and a computed Total bar is appended at the end.",
  };

  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Label", type: "string", cells: ["Revenue", "COGS", "Opex", "Tax"] },
      { name: "Delta", type: "number", cells: [4200, -1700, -900, -300] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Waterfall");
    this.label = init?.label ?? "Waterfall";
    this.addInput("frame", frameIn("Label + Delta"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const names = colAsStrings(cols[0]);
    const values = colAsNumbers(cols[1]);
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: WaterfallPayload = { kind: "waterfall", names, values, total: true };
    const chart: ChartValue = {
      __chart: true, op: "waterfall", values: knownOnly(values), payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Waterfall",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Candlestick ──────────────────────────────────────────────────────────────

export class CandlestickNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "The date column is optional. With exactly four columns all four read as open, high, low, close and rows are numbered instead.",
  };

  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | SolError | null = null;
  width = 260;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Date", type: "date", cells: [46023, 46024, 46025] },
      { name: "Open", type: "number", cells: [102.1, 104.8, 103.6] },
      { name: "High", type: "number", cells: [105.4, 106.0, 105.1] },
      { name: "Low", type: "number", cells: [101.2, 103.0, 102.2] },
      { name: "Close", type: "number", cells: [104.8, 103.6, 104.9] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Candlestick");
    this.label = init?.label ?? "Candlestick";
    this.addInput("frame", frameIn("Date + OHLC"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue | SolError | null }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    if (cols.length === 0) { this.cachedChart = null; return { chart: null }; }
    if (cols.length < 4) {
      const err = solError("#SHAPE!", "Candlestick needs Open, High, Low and Close columns (a date column first is optional)");
      this.cachedChart = err;
      return { chart: err };
    }
    const hasDates = cols.length >= 5;
    const o = colAsNumbers(cols[hasDates ? 1 : 0]);
    const labels = hasDates ? colAsStrings(cols[0]) : o.map((_, i) => String(i + 1));
    const payload: CandlePayload = {
      kind: "candle",
      labels,
      open:  o,
      high:  colAsNumbers(cols[hasDates ? 2 : 1]),
      low:   colAsNumbers(cols[hasDates ? 3 : 2]),
      close: colAsNumbers(cols[hasDates ? 4 : 3]),
    };
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const chart: ChartValue = {
      __chart: true, op: "candle", values: knownOnly(payload.close), payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Candlestick",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Boxplot ──────────────────────────────────────────────────────────────────

export function boxplotStats(sample: (number | null)[]): { lo: number; q1: number; med: number; q3: number; hi: number; outliers: number[] } | null {
  const nums = sample.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const q1 = quantileSorted(nums, 0.25), med = quantileSorted(nums, 0.5), q3 = quantileSorted(nums, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
  const inliers = nums.filter((v) => v >= loFence && v <= hiFence);
  return {
    lo: inliers.length ? inliers[0] : nums[0],
    q1, med, q3,
    hi: inliers.length ? inliers[inliers.length - 1] : nums[nums.length - 1],
    outliers: nums.filter((v) => v < loFence || v > hiFence),
  };
}

export class BoxplotNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "Each numeric column draws as its own box and other columns are skipped. A plain list draws a single box.",
  };

  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  rawInputs: ReadonlySet<string> = new Set(["values"]);
  width = 240;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    values: { columns: [
      { name: "Line A", type: "number", cells: [12, 15, 11, 14] },
      { name: "Line B", type: "number", cells: [18, 13, 16, 17] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Boxplot");
    this.label = init?.label ?? "Boxplot";
    this.addInput("values", frameIn("Data"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { values?: unknown[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const raw = inputs.values?.[0] ?? null;
    const boxes: BoxplotPayload["boxes"] = [];
    if (isFrameValue(raw)) {
      for (const col of raw.columns) {
        if (col.type !== "number") continue;
        const s = boxplotStats(colAsRawNumbers(col));
        if (s) boxes.push({ name: col.name, ...s });
      }
    } else if (Array.isArray(raw)) {
      const s = boxplotStats(raw.map((v) => (typeof v === "number" ? v : null)));
      if (s) boxes.push({ name: "", ...s });
    }
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: BoxplotPayload = { kind: "boxplot", boxes };
    const chart: ChartValue = {
      __chart: true, op: "boxplot", values: null, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Boxplot",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Calendar heatmap ─────────────────────────────────────────────────────────

export class CalendarHeatmapNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 300;
  height = 170;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Date", type: "date", cells: [46023, 46024, 46025] },
      { name: "Value", type: "number", cells: [3, 7, 5] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("CalendarHeatmap");
    this.label = init?.label ?? "Calendar";
    this.addInput("frame", frameIn("Date + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const serials = colAsRawNumbers(cols[0]);
    const vals = colAsRawNumbers(cols[1]);
    const days: number[] = [], values: number[] = [];
    for (let i = 0; i < serials.length; i++) {
      const d = serials[i];
      if (d == null) continue;
      const val = vals[i];
      if (val == null) continue;
      days.push(Math.floor(d));
      values.push(val);
    }
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: CalHeatPayload = { kind: "calheat", days, values };
    const chart: ChartValue = {
      __chart: true, op: "calheat", values, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Calendar",
    };
    this.cachedChart = chart;
    return { chart };
  }
}


// ─── Record card ──────────────────────────────────────────────────────────────

export { parseRecordLayout, recordImageSrc, type RecordPlacement };

export type RecordOp = "card" | "gallery" | "board" | "list";

export const RECORD_OP_META = {
  card:    { label: "Card" },
  gallery: { label: "Gallery" },
  board:   { label: "Board" },
  list:    { label: "List" },
} satisfies Record<RecordOp, { label: string }>;

function readCardSize(optStr: string | null): RecordSize | undefined {
  const m = optStr && /(?:^|;)\s*cardsize\s*=\s*([sml])\b/i.exec(optStr);
  return m ? (m[1].toLowerCase() as RecordSize) : undefined;
}
function readClamp(optStr: string | null): boolean {
  return !!optStr && /(?:^|;)\s*clamp\s*=\s*(on|true|yes|1)\b/i.test(optStr);
}

export const RECORD_CARD_CAP = 60;

export class RecordNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    row: "Selects the 1-based record. Blank or out of range shows the boxes empty.",
    by: "Names the column whose values become the board's lanes. Blank or unmatched draws nothing.",
    layout: "A line per row, names split by |. Repeat to merge. Photo*2 spans two, #Name titles, Qty: 40 is placeholder, a dot is blank. Empty stacks columns.",
    options: "title=Parts;fontsize=12;cardsize=l. Gallery tiles size s, m or l; clamp=on caps long tile values at three lines.",
  };

  label: string;
  op: RecordOp;
  literals: Record<string, number> = { row: 1 };
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Item", type: "string", cells: ["Bolt M4", "Nut M4", "Washer"] },
      { name: "Qty", type: "number", cells: [40, 120, 75] },
      { name: "Price", type: "number", cells: [0.35, 0.12, 0.05] },
    ] },
  };

  constructor(init?: { label?: string; op?: RecordOp }) {
    super("Record");
    this.label = init?.label ?? "Record";
    this.op = init?.op ?? "card";
    this.addInput("frame", frameIn("Frame"));
    if (this.op === "card") this.addInput("row", numIn("Row"));
    if (this.op === "board") this.addInput("by", strIn("Group by"));
    this.addInput("layout", strIn("Layout"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  setOp(next: RecordOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "card") { if (!this.inputs.row) this.addInput("row", numIn("Row")); }
    else if (this.inputs.row) this.removeInput("row");
    if (next === "board") { if (!this.inputs.by) this.addInput("by", strIn("Group by")); }
    else if (this.inputs.by) this.removeInput("by");
  }

  async data(inputs: { frame?: (FrameInput | null)[]; row?: number[]; by?: string[]; layout?: string[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const fv = await readFrame(inputs.frame?.[0] ?? null);
    const cols: FrameColumn[] = isFrameValue(fv) ? fv.columns : [];
    const total = cols[0]?.values.length ?? 0;
    let index = 0;
    if (this.op === "card") {
      const rowRaw = readInput(inputs.row, this.literals.row ?? 1);
      index = rowRaw === null ? 0 : Math.round(rowRaw);
      if (inputs.row?.[0] === undefined && total > 0) {
        index = clamp(index, 1, total);
        this.literals.row = index;
      }
      if (index < 1 || index > total) index = 0;
    }
    const layIn = readInput(inputs.layout, this.stringLiterals.layout ?? null);
    const layStr = typeof layIn === "string" ? layIn : null;
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    const optStr = typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(optStr);
    const size = readCardSize(optStr);
    const clampTiles = readClamp(optStr);

    const byIn = this.op === "board" ? readInput(inputs.by, this.stringLiterals.by ?? "") : "";
    const byKey = typeof byIn === "string" ? byIn.trim().toLowerCase() : "";
    const byCol = this.op === "board" ? (byKey ? cols.find((c) => c.name.trim().toLowerCase() === byKey) ?? null : null) : null;

    const byName = new Map(cols.map((c) => [c.name.trim().toLowerCase(), c]));
    const field = (name: string, col: FrameColumn | undefined, rowIdx: number | null, at: { row: number; col: number; rowSpan: number; colSpan: number; hint?: string; title?: boolean }): RecordField => {
      const label = col
        ? (col.unit ? `${col.name} (${columnUnitLabel(col.unit)})` : col.name)
        : name;
      const raw = col && rowIdx !== null ? col.values[rowIdx] ?? null : null;
      const shown = raw === null ? null : formatFrameCell(col!.type, raw);
      const image = typeof shown === "string" ? recordImageSrc(shown) : null;
      const f: RecordField = { label, value: shown, ...(image ? { image } : {}), ...(at.title ? { isTitle: true } : {}), row: at.row, col: at.col, rowSpan: at.rowSpan, colSpan: at.colSpan };
      if (shown === null && at.hint) f.hint = at.hint;
      return f;
    };
    const placed = layStr && layStr.trim() !== "" ? parseRecordLayout(layStr) : [];
    const stackCols = cols.filter((c) => !(this.op === "board" && c === byCol));
    const cardAt = (rowIdx: number | null): RecordField[] =>
      placed.length > 0
        ? placed.map((p) => field(p.name, byName.get(p.name.toLowerCase()), rowIdx, p))
        : stackCols.map((c, i) => field(c.name, c, rowIdx, { row: i + 1, col: 1, rowSpan: 1, colSpan: 1 }));
    const ncols = placed.length > 0 ? Math.max(...placed.map((p) => p.col + p.colSpan - 1)) : 1;

    let cards: RecordField[][] = [];
    let lanes: RecordPayload["lanes"];
    let more = 0;
    if (this.op === "card") {
      cards = [cardAt(index >= 1 ? index - 1 : null)];
    } else if (this.op === "gallery" || this.op === "list") {
      const drawn = Math.min(total, RECORD_CARD_CAP);
      cards = Array.from({ length: drawn }, (_, r) => cardAt(r));
      more = total - drawn;
    } else if (byCol) {
      const drawn = Math.min(total, RECORD_CARD_CAP);
      const laneList: NonNullable<RecordPayload["lanes"]> = [];
      const laneOf = new Map<string, number>();
      for (let r = 0; r < drawn; r++) {
        const cell = byCol.values[r] ?? null;
        const shown = cell === null ? null : formatFrameCell(byCol.type, cell);
        const label = shown === null ? "—" : String(shown);
        let li = laneOf.get(label);
        if (li === undefined) { li = laneList.length; laneOf.set(label, li); laneList.push({ label, cards: [] }); }
        laneList[li].cards.push(cards.length);
        cards.push(cardAt(r));
      }
      lanes = laneList;
      more = total - drawn;
    }

    const payload: RecordPayload = {
      kind: "record", view: this.op, cols: ncols, cards,
      ...(lanes ? { lanes } : {}), ...(more > 0 ? { more } : {}),
      ...(size ? { size } : {}),
      ...(clampTiles ? { clamp: true } : {}),
      index, total,
    };
    const chart: ChartValue = {
      __chart: true, op: "record", values: null, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Record",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Vector field (quiver) ────────────────────────────────────────────────────

export class QuiverNode extends ClassicPreset.Node {
  label: string;
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string }) {
    super("Quiver");
    this.label = init?.label ?? "Vector Field";
    this.addInput("u", tableIn("ΔX components"));
    this.addInput("v", tableIn("ΔY components"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { u?: (number | null)[][][]; v?: (number | null)[][][] }): { chart: ChartValue } {
    const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const norm = (m: unknown): (number | null)[][] =>
      Array.isArray(m) ? m.map((r) => (Array.isArray(r) ? r.map(num) : [num(r)])) : [];
    const payload: QuiverPayload = { kind: "quiver", u: norm(inputs.u?.[0]), v: norm(inputs.v?.[0]) };
    const chart: ChartValue = { __chart: true, op: "quiver", values: null, payload, options: {}, title: this.label || "Vector Field" };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Chart Builder ────────────────────────────────────────────────────────────

const CB_STR_FIELDS = ["title", "xlabel", "ylabel", "color", "grid", "marker", "pielabels", "radarscale", "zoom", "layout", "tiers", "fit", "critical", "baseline", "arrows", "today", "weekends", "labels", "histogram", "minutes", "window", "columns", "collapse", "week", "fiscal_start", "status", "group_by", "cardsize", "clamp"] as const;
const CB_NUM_FIELDS = ["ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"] as const;

export class ChartBuilderNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Feeds any figure's Options input. Only the fields given a value are included.",
  };

  label: string;
  target: ChartTargetId;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  cachedString = "";
  width = 200;
  height = 200;

  constructor(init?: { label?: string; target?: ChartTargetId }) {
    super("ChartBuilder");
    this.label = init?.label ?? "Chart Builder";
    this.target = init?.target ?? "column";
    this.addInput("title",     strIn("Title"));
    this.addInput("xlabel",    strIn("X label"));
    this.addInput("ylabel",    strIn("Y label"));
    this.addInput("color",     strIn("Color"));
    this.addInput("grid",      strIn("Grid"));
    this.addInput("marker",    strIn("Markers"));
    this.addInput("pielabels", strIn("Pie labels"));
    this.addInput("radarscale", strIn("Radar scale"));
    this.addInput("zoom",      strIn("Zoom"));
    this.addInput("layout",    strIn("Layout"));
    this.addInput("tiers",     strIn("Header rows"));
    this.addInput("fit",       strIn("Fit"));
    this.addInput("critical",  strIn("Critical path"));
    this.addInput("baseline",  strIn("Baseline"));
    this.addInput("arrows",    strIn("Arrows"));
    this.addInput("today",     strIn("Today line"));
    this.addInput("weekends",  strIn("Weekend shading"));
    this.addInput("labels",    strIn("Bar labels"));
    this.addInput("histogram", strIn("Resource band"));
    this.addInput("minutes",   strIn("Times"));
    this.addInput("window",    strIn("Window"));
    this.addInput("columns",   strIn("Columns"));
    this.addInput("collapse",  strIn("Outline"));
    this.addInput("week",      strIn("Week numbers"));
    this.addInput("fiscal_start", strIn("Fiscal year starts"));
    this.addInput("status",    strIn("Status line"));
    this.addInput("group_by",  strIn("Project groups"));
    this.addInput("cardsize",  strIn("Tile size"));
    this.addInput("clamp",     strIn("Clamp tiles"));
    this.addInput("ymin",      numIn("Y min"));
    this.addInput("ymax",      numIn("Y max"));
    this.addInput("linewidth", numIn("Line width"));
    this.addInput("markersize", numIn("Marker size (px)"));
    this.addInput("alpha",     numIn("Fill alpha"));
    this.addInput("fontsize",  numIn("Font size (pt)"));
    this.addOutput("result", strOut("Options"));
  }

  data(inputs: Record<string, unknown[]>) {
    const str = (k: string) => readInput(inputs[k] as string[] | undefined, this.stringLiterals[k]) ?? undefined;
    const num = (k: string) => readInput(inputs[k] as number[] | undefined, this.literals[k]) ?? undefined;
    const out = serializeChartOptions({
      title:     str("title"),
      xlabel:    str("xlabel"),
      ylabel:    str("ylabel"),
      color:     str("color"),
      grid:      str("grid"),
      marker:    str("marker"),
      pielabels: str("pielabels"),
      radarscale: str("radarscale"),
      zoom:      str("zoom"),
      layout: str("layout"),
      tiers: str("tiers"),
      fit: str("fit"),
      critical: str("critical"),
      baseline: str("baseline"),
      arrows: str("arrows"),
      today: str("today"),
      weekends: str("weekends"),
      labels: str("labels"),
      histogram: str("histogram"),
      minutes: str("minutes"),
      window: str("window"),
      columns: str("columns"),
      collapse: str("collapse"),
      week: str("week"),
      fiscal_start: str("fiscal_start"),
      status: str("status"),
      group_by: str("group_by"),
      cardsize: str("cardsize"),
      clamp: str("clamp"),
      ymin:      num("ymin"),
      ymax:      num("ymax"),
      linewidth: num("linewidth"),
      markersize: num("markersize"),
      alpha:     num("alpha"),
      fontsize:  num("fontsize"),
    });
    this.cachedString = out;
    return { result: out };
  }
}

export const CHART_BUILDER_FIELDS = { str: CB_STR_FIELDS, num: CB_NUM_FIELDS };
