import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, tableIn, tableOut, strIn, strOut, chartOut, frameIn } from "./shared";
import { parseChartOptions, serializeChartOptions, CHART_BUILDER_TARGETS, type ChartOptions, type ChartTargetId } from "./chartOptions";
import { clamp, iterMin, iterMax, gridAxes } from "./mathUtils";
import { histogram2d } from "./visualOps";
export { histogram2d } from "./visualOps";
import type {
  ChartValue, KpiPayload, ScalePayload, TreemapPayload, SankeyPayload, SurfacePayload,
  ContourPayload, WaterfallPayload, CandlePayload, BoxplotPayload, CalHeatPayload, WafflePayload, QuiverPayload, SevenSegPayload,
  RecordPayload, RecordField,
} from "../chartValue";
import { columnUnitLabel } from "../unitColumn";
import type { MermaidValue } from "../mermaidValue";
import { readFrame, type FrameInput } from "../frameBackend";
import type { FrameHint } from "../frameHint";
import { formatFrameCell, isFrameValue, type FrameColumn } from "../frame";

// Terminal figures: each node emits a chart VALUE and is never a pass-through.

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
    this.label = init?.label ?? "Sparkline";
    // Normalize retired ops from old saves: "bar" → column, "area" → line.
    const raw = init?.op as string | undefined;
    this.op = raw === "bar" ? "column" : raw === "area" ? "line" : ((raw as SparklineOp) ?? "line");
    this.addInput("values", numListIn("Values"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: (number | number[])[] }): { chart: ChartValue } {
    const raw = inputs.values?.[0] ?? null;
    this.cachedResult = raw;
    // Finite numbers only — the emitted chart value must never carry a NaN/Infinity/error
    // the sign / toSeries path would render as garbage (parity with ChartNode.data()).
    const nums = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0));
    const chart: ChartValue = {
      __chart: true,
      op: this.op === "winloss" ? "column" : this.op,
      values: this.op === "winloss" ? nums.map((n) => Math.sign(n)) : nums,
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

// The card dropdown DERIVES from this table (declareOnce) — never hand-write a second list.
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
    values: "A list plots by position. In a frame, column 0 supplies the x-axis labels and every number column after it is a series (Bubble reads three number columns as x, y, and size).",
    options: "Accepts key=value pairs separated by semicolons, using matplotlib names such as title, ylim, and grid. Unknown keys are ignored.",
  };

  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  // Named series from a frame's numeric columns; null unless ≥ 2 survive the label column
  // (bubble stores its x/y/size columns here too).
  cachedSeries: { name: string; values: (number | null)[] }[] | null = null;
  // X-axis category labels from a wired Frame's FIRST column (dates as dates, etc.).
  cachedLabels: (string | number)[] | null = null;
  // The data feed arrives UNCOERCED so a list stays a list; data() branches on raw shape.
  rawInputs: ReadonlySet<string> = new Set(["values"]);
  chartOptions: ChartOptions = {};
  // The inline options text (used when the Options socket isn't wired).
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
    super("Chart");
    this.label = init?.label ?? "Chart";
    this.op = init?.op ?? "column";
    // A frame socket kept UNCOERCED by `rawInputs` — coerced, it would widen a wired list
    // into a single ROW instead of leaving it a list.
    this.addInput("values", frameIn("Data"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: unknown[]; options?: string[] }): { chart: ChartValue } {
    // A FRAME drives the figure: the numeric columns are named series (a legend at ≥ 2).
    // Every non-finite cell becomes null IN PLACE, so row-indexed labels stay aligned.
    const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
    const raw = inputs.values?.[0] ?? null;
    this.cachedLabels = null;
    this.cachedSeries = null;
    let v: number | number[] | null = null;
    if (isFrameValue(raw) && raw.columns.length > 0) {
      const cols = raw.columns;
      const asNums = (col: FrameColumn) => col.values.map(num);
      if (this.op === "bubble") {
        // A point chart has NO category axis, so it bypasses the label rule: the first three
        // NUMBER columns (col 0 included) are x / y / size. No labels, no legend.
        const pts = cols.filter((c) => c.type === "number").slice(0, 3).map((c) => ({ name: c.name, values: asNums(c) }));
        this.cachedSeries = pts.length > 0 ? pts : null;
        v = pts.length > 0 ? (pts[0].values as unknown as number[]) : null;
      } else if (cols.length >= 2) {
        // Column 0 is ALWAYS the x-axis label column at ≥ 2 columns (a numeric col 0 —
        // Year, an epoch — is a real axis; scatter promotes it to a coordinate x).
        // formatFrameCell renders errors and date serials as label text.
        this.cachedLabels = cols[0].values.map((c) => formatFrameCell(cols[0].type, c) ?? "");
        // The series are the NUMBER-typed columns after the label; others are skipped.
        const series = cols.slice(1).filter((c) => c.type === "number").map((c) => ({ name: c.name, values: asNums(c) }));
        v = series.length > 0 ? (series[0].values as unknown as number[]) : null;
        // A legend/multi-series render only when 2+ numeric series survive.
        this.cachedSeries = series.length >= 2 ? series : null;
      } else {
        // A one-column frame plots positionally, like a plain list.
        v = asNums(cols[0]) as unknown as number[];
      }
    } else if (Array.isArray(raw)) {
      v = raw.map(num) as unknown as number[];
    } else if (typeof raw === "number") {
      v = num(raw);
    }
    this.cachedResult = v;
    // Only a real string configures the options — a wired SolError/number falls back to the
    // inline literal, but a wired BLANK means "no styling given" and must not.
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    const optStr = typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(optStr);
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

// ─── Histogram ────────────────────────────────────────────────────────────────

/** Count how many values fall in each of `k` equal-width bins over [min,max]. */
export function histogramBins(vals: (number | null)[], k: number): number[] {
  const nums = vals.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const bins = clamp(Math.floor(k) || 1, 1, 100);
  if (nums.length === 0) return [];
  const min = iterMin(nums);
  const max = iterMax(nums);
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

export type HistogramMode = "1d" | "2d";
export const HISTOGRAM_MODE_META = {
  "1d": { label: "1-D", description: "Bin one list of numbers into equal-width buckets, plotted as columns." },
  "2d": { label: "2-D", description: "Bin paired X and Y numbers into a grid, drawn as a density plot. numpy histogram2d." },
} satisfies Record<HistogramMode, { label: string; description: string }>;

const listOf = (raw: number | number[] | null | undefined): (number | null)[] =>
  Array.isArray(raw) ? raw : raw == null ? [] : [raw];

// One card, two modes (oneRunningNode-style combine): 1-D bins one list into columns;
// 2-D pairs X/Y into a count grid drawn as a contour density plot. The `mode` selector
// adds/removes the Y + Y-bins inputs; `bins` carries across as the X-bin count. The plain
// count matrix is exposed via the WRAPTEXT-style HISTOGRAM2D formula, not a socket.
export class HistogramNode extends ClassicPreset.Node {
  label: string;
  mode: HistogramMode;
  literals: Record<string, number> = { bins: 10, ybins: 10 };
  chartOptions: ChartOptions = {};
  stringLiterals: Record<string, string> = {};
  cachedResult: number[] | null = null; // 1-D counts (null in 2-D)
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

  /** Keys a switch to `next` would drop — the component prunes their cables BEFORE
   *  `setMode` (onePrunePath). */
  keysDroppedByMode(next: HistogramMode): string[] {
    return next === "1d" ? ["y", "ybins"] : [];
  }

  setMode(next: HistogramMode): void {
    if (next === this.mode) return;
    this.mode = next;
    // The `options` input trails the swap set, so drop and re-add it to keep the row order
    // Values/X · bins · [Y · Y bins] · Options.
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

  data(inputs: { values?: (number | number[])[]; bins?: number[]; y?: (number | number[])[]; ybins?: number[]; options?: string[] }): { chart: ChartValue } {
    const xs = listOf(inputs.values?.[0] ?? null);
    // Bins is a SHAPE, not styling — a wired blank empties the figure. Mirror to the card
    // ONLY when unwired; writing a WIRED value into `literals` would overwrite and persist it.
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
      // z[iy][ix] = count in x-bin ix, y-bin iy; edges are the axis coordinates.
      const z = h ? h.yEdges.map((_, j) => h.counts.map((col) => col[j])) : [];
      const payload: ContourPayload = { kind: "contour", xs: h?.xEdges ?? [], ys: h?.yEdges ?? [], z, levels: 10 };
      const chart: ChartValue = { __chart: true, op: "contour", values: null, payload, options: this.chartOptions, title };
      this.cachedChart = h ? chart : null;
      return { chart };
    }

    const counts = kx === null ? [] : histogramBins(xs, kx);
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
  // The inline diagram source (used when the `source` socket isn't wired).
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
    // The diagram IS the source — a wired blank renders empty, not the card's text.
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

// ─── Gauge — a value on a fixed scale (Dial or Bar) ─────────────────────────────
// One card, a style selector. DIAL reads Value as a fraction of 1 (0.75 → 75% on a
// fixed 0→100% arc); BAR (the former Bullet graph) plots Value on a 0→Max track with a
// Target tick. Emits a chart VALUE, not a pass-through — like 7-Segment, so a Report can
// embed the readout (author call; node-coverage records the contract change).
export type GaugeStyle = "dial" | "bar";
export const GAUGE_STYLE_OPTIONS: { value: GaugeStyle; label: string }[] = [
  { value: "dial", label: "Dial" },
  { value: "bar", label: "Bar" },
];

export class GaugeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Dial reads it as a fraction of one, so 0.75 shows as 75 percent on a dial fixed at 0 to 100 percent; Bar plots it on the 0 to Max track.",
    target: "Bar only: the target tick on the track.",
    max: "Bar only: the track always starts at zero, so this sets only its upper end.",
  };

  label: string;
  // The style is the node's OPERATION (it names the card): `op`, per the operation-kind
  // convention (selectorNamedOp) — the payload's own `style` field mirrors it.
  op: GaugeStyle = "dial";
  literals: Record<string, number> = { value: 0, target: 80, max: 100 };
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: ScalePayload | null = null;
  width = 200;
  height = 200;

  constructor(init?: { label?: string; op?: GaugeStyle }) {
    super("Gauge");
    this.label = init?.label ?? "Gauge";
    if (init?.op === "bar") this.op = "bar";
    this.addInput("value", numIn("Value"));
    if (this.op === "bar") this.addBarInputs();
    this.addOutput("chart", chartOut("Chart"));
  }

  private addBarInputs(): void {
    this.addInput("target", numIn("Target"));
    this.addInput("max", numIn("Max"));
    this.addInput("options", strIn("Options"));
  }

  /** The bar-only input keys a switch to `next` would remove — the component drops
   *  their cables first (onePrunePath) before calling setOp. */
  keysDropped(next: GaugeStyle): string[] {
    return next === "dial" && this.op === "bar" ? ["target", "max", "options"] : [];
  }

  setOp(next: GaugeStyle): void {
    if (next === this.op) return;
    this.op = next;
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
    if (this.op === "bar") {
      const target = readInput(inputs.target, this.literals.target ?? null);
      // `max` is the track SCALE, so it keeps the card bound like a Slider; value/target are data.
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


export class SevenSegNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0, decimals: 0 };
  cachedChart: ChartValue | null = null;
  width = 200;
  height = 130;

  constructor(init?: { label?: string }) {
    super("SevenSeg");
    this.label = init?.label ?? "7-Segment";
    this.addInput("value", numIn("Value"));
    this.addInput("decimals", numIn("Decimals"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; decimals?: number[] }): { chart: ChartValue } {
    const v = readInput(inputs.value, this.literals.value ?? null);
    // `decimals` is PRESENTATION: a wired blank is the neutral 0, not the card's number.
    const d = clamp(Math.round(readInput(inputs.decimals, this.literals.decimals ?? 0) ?? 0), 0, 6);
    // Mirror to the card only when unwired — never clobber the typed literal.
    if (inputs.decimals?.[0] === undefined) this.literals.decimals = d;
    if (inputs.value?.[0] === undefined) this.literals.value = v ?? 0;
    const payload: SevenSegPayload = { kind: "sevenseg", text: sevenSegText(v, d) };
    const chart: ChartValue = { __chart: true, op: "sevenseg", values: v, payload, options: {}, title: this.label || "7-Segment" };
    this.cachedChart = chart;
    return { chart };
  }
}

/** The characters a 7-seg readout shows for a value: a fixed-decimals string, or
 *  the classic all-dashes overflow when it doesn't fit the display width. */
export function sevenSegText(v: number | null, decimals: number, maxDigits = 10): string {
  if (v == null || !Number.isFinite(v)) return "";
  const s = v.toFixed(clamp(Math.round(decimals), 0, 6));
  // Count digit CELLS (a '.' rides its neighbor, '-' takes a cell).
  const cells = s.replace(/\./g, "").length;
  return cells > maxDigits ? "-".repeat(maxDigits) : s;
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
    // A wired blank `prev` shows NO comparison, never a compare against the card's number.
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
/** A column as display strings (a string column passes through; a date formats). */
function colAsStrings(col: FrameColumn | undefined): string[] {
  if (!col) return [];
  return col.values.map((v) => {
    const c = formatFrameCell(col.type, v);
    return c == null ? "" : String(c);
  });
}
/** A column coerced to numbers (numeric text parses; anything else → 0). */
function colAsNumbers(col: FrameColumn | undefined): number[] {
  if (!col) return [];
  return col.values.map((v) => {
    const c = formatFrameCell(col.type, v);
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() !== "") { const n = Number(c); if (Number.isFinite(n)) return n; }
    return 0;
  });
}

// ─── Treemap ──────────────────────────────────────────────────────────────────

export class TreemapNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: TreemapPayload | null = null;
  width = 240;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Label", type: "string", cells: ["North", "Europe", "Asia"] },
      { name: "Value", type: "number", cells: [4200, 3100, 5600] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Treemap");
    this.label = init?.label ?? "Treemap";
    this.addInput("frame", frameIn("Label + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const names = colAsStrings(cols[0]);
    const values = colAsNumbers(cols[1]);
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: TreemapPayload = { kind: "treemap", names, values };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "treemap", values, payload, options: this.chartOptions, title: this.chartOptions.title || this.label || "Treemap" },
    };
  }
}

// ─── Sankey ───────────────────────────────────────────────────────────────────

export class SankeyNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: SankeyPayload | null = null;
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

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const sources = colAsStrings(cols[0]);
    const targets = colAsStrings(cols[1]);
    const values = colAsNumbers(cols[2]);
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
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

/** Normalize a Surface/Contour source to axes + heights via the shared gridAxes: a plain
 *  Z table plus optional Xs/Ys lists (unwired = the 1-based index). A figure shows nothing
 *  on a bad/blank axis, so a SolError or null from gridAxes collapses to an empty grid. */
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

// ONE node, two views of one grid: the 3-D shaded surface and its flat
// contour twin. The op swaps the view; Contour alone has the Levels input,
// Surface alone the yaw/pitch literals (the component's D-pad).
export class SurfaceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    xs: "One X coordinate per column; unwired means 1, 2, 3…",
    ys: "One Y coordinate per row; unwired means 1, 2, 3…",
  };

  label: string;
  op: SurfaceViewOp;
  // View angles (degrees) live in `literals` so they persist and the rotate buttons nudge them.
  literals: Record<string, number> = { yaw: 45, pitch: 45 };
  // Typeable Xs / Ys: a CSV list on the card (the List Input mechanism), a cable wins.
  stringLiterals: Record<string, string> = { xs: "", ys: "" };
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  constructor(init?: { label?: string; op?: SurfaceViewOp; yaw?: number; pitch?: number; levels?: number }) {
    super("Surface");
    this.op = init?.op ?? "surface";
    this.label = init?.label ?? (this.op === "surface" ? "Surface" : "Contour");
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

  /** The op owns the Levels socket. Callers on a live graph prune its cables
   *  BEFORE switching to the 3-D view (onePrunePath). */
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
      // Levels is a SHAPE, so a wired blank empties the figure rather than reusing the card's count.
      const levelsRaw = readInput(inputs.levels, this.literals.levels ?? 8);
      const levels = levelsRaw === null ? 0 : clamp(Math.round(levelsRaw), 2, 24);
      // Mirror only when unwired — never clobber the typed literal with a wired value.
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
/** A column's RAW numeric cells (dates stay serials — unlike colAsNumbers, which
 *  formats first and would turn a date into unparseable text). */
function colAsRawNumbers(col: FrameColumn | undefined): (number | null)[] {
  if (!col) return [];
  return col.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

/** Linear-interpolated quantile of a SORTED sample (Excel's PERCENTILE.INC). */
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
      __chart: true, op: "waterfall", values, payload,
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
  cachedChart: ChartValue | null = null;
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

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    // 5+ columns → col 0 is the date/label axis; exactly 4 → all four are OHLC.
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
      __chart: true, op: "candle", values: payload.close, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Candlestick",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Boxplot ──────────────────────────────────────────────────────────────────
// Received raw (like Chart) so a plain list doesn't widen into a 1-row frame.

/** Five-number summary + outliers for one sample (Tukey 1.5·IQR whiskers). */
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
    // The date column must stay SERIALS — colAsNumbers would format them into text first.
    const serials = colAsRawNumbers(cols[0]);
    const vals = colAsRawNumbers(cols[1]);
    const days: number[] = [], values: number[] = [];
    for (let i = 0; i < serials.length; i++) {
      const d = serials[i];
      if (d == null) continue;
      days.push(Math.floor(d));
      values.push(vals[i] ?? 0);
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

// ─── Waffle ───────────────────────────────────────────────────────────────────

export class WaffleNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 220;
  height = 220;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Label", type: "string", cells: ["Wind", "Solar", "Hydro"] },
      { name: "Value", type: "number", cells: [38, 27, 35] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Waffle");
    this.label = init?.label ?? "Waffle";
    this.addInput("frame", frameIn("Label + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    const names = colAsStrings(cols[0]);
    const values = colAsNumbers(cols[1] ?? cols[0]);
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: WafflePayload = { kind: "waffle", names, values };
    const chart: ChartValue = {
      __chart: true, op: "waffle", values, payload,
      options: this.chartOptions, title: this.chartOptions.title || this.label || "Waffle",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Record card ──────────────────────────────────────────────────────────────

export interface RecordPlacement {
  name: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** Muted text an EMPTY box shows in place of the value dash. */
  hint?: string;
}

/** A layout cell: one line per grid row, cells split on "|", "." or an empty
 *  cell is a gap. Repeating a name claims its bounding rectangle (a lenient
 *  grid-template-areas: a non-rectangular repeat degrades to its bounds instead
 *  of invalidating the grid). Names keep first-occurrence spelling. Two cell
 *  suffixes: `Name*3` widens the cell three columns (expanded before the walk,
 *  so it composes with repetition and shifts later cells right), and a first
 *  colon splits off placeholder text — `Qty: e.g. 40` — kept as the box's
 *  `hint` (first authored hint wins on a repeat). */
export function parseRecordLayout(text: string): RecordPlacement[] {
  const rows = text
    .split("\n")
    .map((line) =>
      line.split("|").flatMap((raw) => {
        const cell = raw.trim();
        const ci = cell.indexOf(":");
        const hint = ci >= 0 ? cell.slice(ci + 1).trim() : "";
        const head = (ci >= 0 ? cell.slice(0, ci) : cell).trim();
        const m = /^(.*?)\s*\*\s*(\d+)$/.exec(head);
        const name = m ? m[1].trim() : head;
        const span = m ? Math.min(12, Math.max(1, Number(m[2]))) : 1;
        return Array.from({ length: span }, (_, i) => ({ name, hint: i === 0 ? hint : "" }));
      }),
    )
    .filter((cells) => cells.some((c) => c.name !== "" && c.name !== "."));
  const rects = new Map<string, { name: string; hint: string; r0: number; c0: number; r1: number; c1: number }>();
  const order: string[] = [];
  rows.forEach((cells, r) =>
    cells.forEach(({ name, hint }, c) => {
      if (name === "" || name === ".") return;
      const key = name.toLowerCase();
      const rect = rects.get(key);
      if (!rect) {
        rects.set(key, { name, hint, r0: r, c0: c, r1: r, c1: c });
        order.push(key);
      } else {
        rect.r0 = Math.min(rect.r0, r); rect.c0 = Math.min(rect.c0, c);
        rect.r1 = Math.max(rect.r1, r); rect.c1 = Math.max(rect.c1, c);
        if (!rect.hint) rect.hint = hint;
      }
    }),
  );
  return order.map((key) => {
    const t = rects.get(key)!;
    return {
      name: t.name, row: t.r0 + 1, col: t.c0 + 1, rowSpan: t.r1 - t.r0 + 1, colSpan: t.c1 - t.c0 + 1,
      ...(t.hint ? { hint: t.hint } : {}),
    };
  });
}

/** A string cell that points at an image: a data:image URL, or an http(s) URL
 *  with an image extension. Anything else stays text. */
export function recordImageSrc(text: string): string | null {
  const t = text.trim();
  if (/^data:image\//i.test(t)) return t;
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?\S*)?$/i.test(t)) return t;
  return null;
}

export type RecordOp = "card" | "gallery" | "board";

// The card dropdown DERIVES from this table (declareOnce) — never hand-write a second list.
export const RECORD_OP_META = {
  card:    { label: "Card" },
  gallery: { label: "Gallery" },
  board:   { label: "Board" },
} satisfies Record<RecordOp, { label: string }>;

// Gallery/board draw at most this many cards; `payload.more` carries the rest.
export const RECORD_CARD_CAP = 60;

export class RecordNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    row: "Selects the 1-based record. Blank or out of range shows the boxes empty.",
    by: "Names the column whose values become the board's lanes. Blank or unmatched draws nothing.",
    layout: "One line per grid row, names split by | marks. Repeating a name merges its cells into one box. Photo*2 widens a box two columns. Qty: for example 40 gives an empty box muted placeholder text. A dot or an empty cell stays blank. Left empty, the columns stack.",
    options: "title=Parts;fontsize=12",
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
    // Guard a stale op from an old save — fall back rather than crash.
    this.op = init?.op && init.op in RECORD_OP_META ? init.op : "card";
    this.addInput("frame", frameIn("Frame"));
    if (this.op === "card") this.addInput("row", numIn("Row"));
    if (this.op === "board") this.addInput("by", strIn("Group by"));
    this.addInput("layout", strIn("Layout"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  /** The op owns the Row and Group-by sockets. Callers on a live graph prune the
   *  departing keys' cables BEFORE switching (onePrunePath). */
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
    // Row is which record to draw — a figure's datum: a wired blank or an
    // out-of-range pick renders the boxes EMPTY, never an error out `chart`.
    let index = 0;
    if (this.op === "card") {
      const rowRaw = readInput(inputs.row, this.literals.row ?? 1);
      index = rowRaw === null ? 0 : Math.round(rowRaw);
      if (inputs.row?.[0] === undefined && total > 0) {
        // Mirror the clamped pick only when unwired, so the pager and card agree.
        index = clamp(index, 1, total);
        this.literals.row = index;
      }
      if (index < 1 || index > total) index = 0;
    }
    // Layout and Options are presentation: a wired blank means "none given" and
    // must not reinstate the card's text (the ChartNode options contract).
    const layIn = readInput(inputs.layout, this.stringLiterals.layout ?? null);
    const layStr = typeof layIn === "string" ? layIn : null;
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null));

    // The board's grouping column: a column reference, so a wired blank or an
    // unmatched name draws nothing (never "one lane of everything").
    const byIn = this.op === "board" ? readInput(inputs.by, this.stringLiterals.by ?? "") : "";
    const byKey = typeof byIn === "string" ? byIn.trim().toLowerCase() : "";
    const byCol = this.op === "board" ? (byKey ? cols.find((c) => c.name.trim().toLowerCase() === byKey) ?? null : null) : null;

    const byName = new Map(cols.map((c) => [c.name.trim().toLowerCase(), c]));
    const field = (name: string, col: FrameColumn | undefined, rowIdx: number | null, at: { row: number; col: number; rowSpan: number; colSpan: number; hint?: string }): RecordField => {
      const label = col
        ? (col.unit ? `${col.name} (${columnUnitLabel(col.unit)})` : col.name)
        : name;
      const raw = col && rowIdx !== null ? col.values[rowIdx] ?? null : null;
      const shown = raw === null ? null : formatFrameCell(col!.type, raw);
      const image = typeof shown === "string" ? recordImageSrc(shown) : null;
      const f: RecordField = { label, value: shown, ...(image ? { image } : {}), row: at.row, col: at.col, rowSpan: at.rowSpan, colSpan: at.colSpan };
      if (shown === null && at.hint) f.hint = at.hint;
      return f;
    };
    const placed = layStr && layStr.trim() !== "" ? parseRecordLayout(layStr) : [];
    // No layout → every column stacks (the board skips its own grouping column
    // there — every card in a lane would repeat the lane's label). A layout
    // stands on its own, so it can be drafted before the frame is wired
    // (unmatched names keep their boxes).
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
    } else if (this.op === "gallery") {
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

const CB_STR_FIELDS = ["title", "xlabel", "ylabel", "color", "grid", "marker"] as const;
const CB_NUM_FIELDS = ["ymin", "ymax", "linewidth", "alpha", "fontsize"] as const;

export class ChartBuilderNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Feeds any figure's Options input. Only the fields given a value are included.",
  };

  label: string;
  /** Shapes which option rows the card shows; serialization stays full-width. */
  target: ChartTargetId;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  cachedString = "";
  width = 200;
  height = 200;

  constructor(init?: { label?: string; target?: ChartTargetId }) {
    super("ChartBuilder");
    this.label = init?.label ?? "Chart Builder";
    // Guard a stale target from an old save — fall back rather than crash.
    this.target = init?.target && init.target in CHART_BUILDER_TARGETS ? init.target : "chart";
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
    this.addInput("fontsize",  numIn("Font size (pt)"));
    this.addOutput("result", strOut("Options"));
  }

  data(inputs: Record<string, unknown[]>) {
    // Every field is PRESENTATION: a wired blank must NOT fall back to the card's value,
    // or a blank cable silently reinstates styling the graph withheld.
    const str = (k: string) => readInput(inputs[k] as string[] | undefined, this.stringLiterals[k]) ?? undefined;
    const num = (k: string) => readInput(inputs[k] as number[] | undefined, this.literals[k]) ?? undefined;
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
      fontsize:  num("fontsize"),
    });
    this.cachedString = out;
    return { result: out };
  }
}

export const CHART_BUILDER_FIELDS = { str: CB_STR_FIELDS, num: CB_NUM_FIELDS };
