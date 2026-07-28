import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, numOut, tableIn, tableOut, strIn, strOut, chartOut, anyTableIn, frameIn } from "./shared";
import { parseChartOptions, serializeChartOptions, CHART_BUILDER_TARGETS, type ChartOptions, type ChartTargetId } from "./chartOptions";
import { clamp, iterMin, iterMax } from "./mathUtils";
import type {
  ChartValue, KpiPayload, BulletPayload, TreemapPayload, SankeyPayload, SurfacePayload,
  ContourPayload, WaterfallPayload, CandlePayload, BoxplotPayload, CalHeatPayload, WafflePayload, QuiverPayload, SevenSegPayload,
} from "../chartValue";
import type { MermaidValue } from "../mermaidValue";
import { readFrame, type FrameInput } from "../frameBackend";
import { formatFrameCell, isFrameValue, type FrameColumn } from "../frame";

// ─── Visual output nodes ────────────────────────────────────────────────────
// Terminal figures: a node reads a value and emits a chart VALUE (the `chart`
// object socket a Report renders inline) — NOT a pass-through (this app only
// passes values through Display + the Format Controller). The chart itself is
// drawn by the React component (recharts); the class
// only caches the value it received for the component to read.

export type SparklineOp = "line" | "column" | "winloss";

export const SPARKLINE_OP_META = {
  line:    { label: "Line" },
  column:  { label: "Column" },
  winloss: { label: "Win/Loss" },
} satisfies Record<SparklineOp, { label: string }>;

// ─── Sparkline ────────────────────────────────────────────────────────────────
// A tiny, axis-less inline chart of a list — Excel's SPARKLINE (line / column /
// win-loss). Emits a chart VALUE (not a pass-through) — a Report can embed it,
// and it collapses to a headerless square.

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
    // Finite numbers only — a non-number OR a NaN/Infinity (dirty data, a #DIV/0!
    // cell) becomes 0, so the emitted chart value never carries a value the sign /
    // toSeries path would render as garbage (parity with ChartNode.data()).
    const nums = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0));
    // Win/Loss renders as a column chart of the signs (+1 up / −1 down / 0 flat).
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
// A larger chart with axes for a list — column / bar / line / area via an op
// dropdown (the composable "one node, op selector" pattern).

export type ChartOp =
  | "column" | "bar" | "line" | "area"
  | "pie" | "radar" | "radialbar" | "funnel" | "scatter"
  | "composed" | "bubble";

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
  composed:  { label: "Composed" },
  bubble:    { label: "Bubble" },
} satisfies Record<ChartOp, { label: string }>;

// The 2-D ops read the `series` matrix input (composed = columns are series;
// bubble = rows are [x, y, size]); the 1-D ops read `values`.
export const CHART_MATRIX_OPS = new Set<ChartOp>(["composed", "bubble"]);

export class ChartNode extends ClassicPreset.Node {
  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  // The 2-D feed for the composed/bubble ops (a matrix on the `series` socket).
  cachedMatrix: (number | null)[][] | null = null;
  // X-axis category labels from a wired Frame's FIRST column (dates as dates, etc.).
  cachedLabels: (string | number)[] | null = null;
  // The data feed is received UNCOERCED so a list stays a list (see the input note);
  // data() branches on the raw shape (frame → labels+values, list → values).
  rawInputs: ReadonlySet<string> = new Set(["values"]);
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
    // The data feed. Accepts a plain list (values, index x-axis) OR — our convention,
    // columns not parallel sockets — a FRAME: col 0 = x-axis labels (dates/categories),
    // col 1 = the values. `rawInputs` keeps it UNCOERCED so a list stays a list (a frame
    // socket would otherwise widen a list into a single ROW).
    this.addInput("values", frameIn("Data"));
    // The 2-D feed: composed reads each column as a series, bubble each row as an
    // [x, y, size] point. Unwired for the 1-D ops (they read `values`).
    this.addInput("series", anyTableIn("Series (2-D)"));
    this.addInput("options", strIn("Options"));
    // A Chart is a terminal figure, not a data pass-through (nothing consumed the
    // old numlist `result` — a chart is a sink). Its output is the first-class
    // chart VALUE: the `chart` object socket (identity-only + `any`, like lambda)
    // carries a self-describing figure a consumer redraws — the Report renders it
    // inline where its `=name` ref sits (charts' main destination).
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: unknown[]; series?: unknown[][][]; options?: string[] }): { chart: ChartValue } {
    // The data feed (raw, uncoerced): a FRAME drives a LABELED chart — col 0 → x-axis
    // labels (formatted per type, so dates read as dates), col 1 → the values; a single-
    // column frame is just values. A plain LIST charts as values against the index.
    // Every cell is coerced to a FINITE number or null: a #DIV/0! (SolError object),
    // a first-class null, NaN/Infinity (dirty-data coercions from the input nodes),
    // or text all become null — so the emitted chart VALUE never carries a non-number
    // that recharts / a Report embed would choke on. Bad cells become null in place
    // (not dropped), so the x-axis labels (indexed by row) stay aligned.
    const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
    const raw = inputs.values?.[0] ?? null;
    this.cachedLabels = null;
    let v: number | number[] | null = null;
    if (isFrameValue(raw) && raw.columns.length > 0) {
      const cols = raw.columns;
      const asNums = (col: FrameColumn) => col.values.map(num);
      if (cols.length >= 2) {
        // formatFrameCell already renders a SolError cell as its #CODE! text and a
        // date serial as a date; coerce the (never-object) result to a plain label.
        this.cachedLabels = cols[0].values.map((c) => formatFrameCell(cols[0].type, c) ?? "");
        v = asNums(cols[1]) as unknown as number[];
      } else {
        v = asNums(cols[0]) as unknown as number[];
      }
    } else if (Array.isArray(raw)) {
      v = raw.map(num) as unknown as number[];
    } else if (typeof raw === "number") {
      v = num(raw);
    }
    this.cachedResult = v;
    // A wired matrix → coerce every cell to number|null (anyTable is element-
    // agnostic; a non-number becomes null so the charts skip it).
    const rawMatrix = inputs.series?.[0] ?? null;
    this.cachedMatrix = Array.isArray(rawMatrix)
      ? rawMatrix.map((row) => (Array.isArray(row) ? row : [row]).map(num))
      : null;
    // Only a real string configures the options; a SolError/number wired into the
    // Options socket (it reaches here now the node sees raw errors) falls back to
    // the inline literal rather than being parsed as text. A wired BLANK is not
    // garbage though — it means "no styling given", so it must not reinstate the
    // card's string (value-semantics.md, "Reading an input").
    const optIn = readInput(inputs.options, this.stringLiterals.options ?? null);
    const optStr = typeof optIn === "string" || optIn === null ? optIn : (this.stringLiterals.options ?? null);
    this.chartOptions = parseChartOptions(optStr);
    const chart: ChartValue = {
      __chart: true,
      op: this.op,
      values: this.cachedResult,
      matrix: this.cachedMatrix,
      labels: this.cachedLabels ?? undefined,
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
    const bins = readInput(inputs.bins, this.literals.bins ?? 10);
    // Bins is a SHAPE, not styling — a wired blank leaves the binning unknown, so the
    // figure is empty (value-semantics.md, "Reading an input").
    if (bins !== null) this.literals.bins = bins;
    const counts = bins === null ? [] : histogramBins(list as (number | null)[], bins);
    this.cachedResult = counts;
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
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
    // The diagram IS the source — a wired blank renders an empty diagram rather than
    // the text typed on the card (value-semantics.md, "Reading an input").
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

// ─── Gauge ────────────────────────────────────────────────────────────────────
// A radial gauge of a single value read as a fraction of 100% (1 = 100%). The
// dial always spans 0→100%; the value passes straight through.

export class GaugeNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0 };
  cachedResult: number | null = null;
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Gauge");
    this.label = init?.label ?? "Gauge";
    // A single value read as a fraction of 100% (1 = 100%, 1.5 = 150%). The dial
    // scale is always 0→100%; no Min/Max inputs.
    this.addInput("value", numIn("Value"));
    this.addOutput("result", numOut("Pass-through"));
  }

  data(inputs: { value?: number[] }) {
    const v = readInput(inputs.value, this.literals.value ?? null);
    this.cachedResult = v;
    return { result: v };
  }
}

// ─── 7-Segment display ────────────────────────────────────────────────────────
// A flat seven-segment readout of a number — the electromechanical meter look,
// on brand for a thing called Solenoid. Emits a chart VALUE (author 2026-07-16:
// "chart output, not passthrough") so a Report embeds the readout inline.
// Deliberately FLAT: lit segments in the accent, ghost segments barely-there;
// no flap/LED skeuomorphism and no animation (author + DESIGN.md).

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
    // `decimals` is PRESENTATION: a wired blank means "no formatting given", which is
    // the neutral 0 — not the number typed on the card.
    const d = clamp(Math.round(readInput(inputs.decimals, this.literals.decimals ?? 0) ?? 0), 0, 6);
    this.literals.decimals = d;
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
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; prev?: number[]; options?: string[] }): { chart: ChartValue } {
    const value = readInput(inputs.value, this.literals.value ?? null);
    // A wired blank `prev` shows NO comparison — it does not compare against the
    // number typed on the card (value-semantics.md, "absent is not unknown").
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

// ─── Bullet graph ─────────────────────────────────────────────────────────────
// A value bar on a min..max track with a target tick (Stephen Few's bullet graph —
// a compact gauge alternative). Emits a chart VALUE so a Report embeds it.

export class BulletNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { value: 0, target: 80, max: 100 };
  stringLiterals: Record<string, string> = {};
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
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { value?: number[]; target?: number[]; max?: number[]; options?: string[] }): { chart: ChartValue } {
    const value = readInput(inputs.value, this.literals.value ?? null);
    const target = readInput(inputs.target, this.literals.target ?? null);
    // `max` is the track's SCALE, not a datum — the figure cannot render without one,
    // so it keeps the card's bound exactly as a Slider does (value-semantics.md,
    // "a control's bound"). `value` and `target` are data and go blank.
    const max = readInput(inputs.max, this.literals.max ?? 100) ?? (this.literals.max ?? 100);
    if (inputs.value?.[0] === undefined) this.literals.value = value ?? 0;
    if (inputs.target?.[0] === undefined) this.literals.target = target ?? 0;
    if (inputs.max?.[0] === undefined) this.literals.max = max;
    this.chartOptions = parseChartOptions(readInput(inputs.options, this.stringLiterals.options ?? null));
    const payload: BulletPayload = { kind: "bullet", value, target, min: 0, max };
    this.cachedPayload = payload;
    return {
      chart: { __chart: true, op: "bullet", values: value, payload, options: this.chartOptions, title: this.chartOptions.title || this.label || "Bullet" },
    };
  }
}

// ─── Frame-column readers (Treemap / Sankey) ────────────────────────────────────
// Treemap and Sankey take ONE frame (a table of rows), not parallel lists — a
// treemap is a Label|Value table, a sankey is a From|To|Value edge table, so the
// frame IS the natural shape (author it in a Frame Input, or pipe any verb chain
// in). Columns are read POSITIONALLY (first N), so header names don't matter.
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
// A flat labeled treemap: each (label, value) pair is a rectangle sized by value.
// Wire a 2-column frame (Label, Value) — read positionally. Emits a chart VALUE.

export class TreemapNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: TreemapPayload | null = null;
  width = 240;
  height = 220;

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
// A flow diagram from an edge table: each row is source → target carrying value.
// Nodes are the unique names across both ends. Wire a 3-column frame (From, To,
// Value) — read positionally. Emits a chart VALUE.

export class SankeyNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedPayload: SankeyPayload | null = null;
  width = 260;
  height = 220;

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
// Colors every cell of a Table on a cool→warm gradient spanning the data's own
// min..max (conditional formatting). Pass-through: the Table flows on unchanged;
// the color grid is drawn in the component.

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
// Reads the SAME coordinate-bordered table the Grid Interpolate node fills (first
// row = X coordinates, first column = Y coordinates, interior = Z heights) and emits
// a `surface` ChartValue — a shaded axonometric mesh, drawn by SurfaceView. A blank
// interior cell is a hole (no quad). Pair it with Grid Interpolate to see the filled
// surface. Emits on the green `chart` socket, so it embeds in a Report like any chart.

/** Split a bordered table into axes + heights. Row 0 (minus the ignored corner) is
 *  the X coordinates, column 0 the Y coordinates; a non-numeric cell is a blank. */
export function parseBorderedGrid(
  table: (number | null | unknown)[][] | null,
): { xs: number[]; ys: number[]; z: (number | null)[][] } {
  if (!Array.isArray(table) || table.length < 2) return { xs: [], ys: [], z: [] };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rawXs = (table[0] ?? []).slice(1).map(num);
  const rawYs = table.slice(1).map((r) => num(r?.[0]));
  const rawZ = table.slice(1).map((r) => (Array.isArray(r) ? r.slice(1) : []).map(num));
  // Drop any column / row whose AXIS coordinate is non-finite (an error, text, or
  // blank cell): left as NaN it would make `Math.min(...xs)` NaN in the viewers and
  // blank the WHOLE surface/contour while the empty-check (which only tests z) still
  // thinks there's data. Dropping the matching z column / row keeps the axes aligned
  // with the height grid.
  const keptX: number[] = [];
  rawXs.forEach((x, i) => { if (x !== null) keptX.push(i); });
  const keptY: number[] = [];
  rawYs.forEach((y, i) => { if (y !== null) keptY.push(i); });
  const xs = keptX.map((i) => rawXs[i] as number);
  const ys = keptY.map((i) => rawYs[i] as number);
  const z = keptY.map((ri) => keptX.map((ci) => rawZ[ri]?.[ci] ?? null));
  return { xs, ys, z };
}

export class SurfaceNode extends ClassicPreset.Node {
  label: string;
  // View angles (degrees) live in `literals` so they persist (extractInit spreads it)
  // and the rotate buttons can nudge them by 45°. Default ≈ the isometric starting view.
  literals: Record<string, number> = { yaw: 45, pitch: 45 };
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

  constructor(init?: { label?: string; yaw?: number; pitch?: number }) {
    super("Surface");
    this.label = init?.label ?? "Surface";
    if (init?.yaw != null) this.literals.yaw = init.yaw;
    if (init?.pitch != null) this.literals.pitch = init.pitch;
    this.addInput("grid", tableIn("Bordered grid"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { grid?: (number | null | unknown)[][][] }): { chart: ChartValue } {
    const { xs, ys, z } = parseBorderedGrid(inputs.grid?.[0] ?? null);
    const payload: SurfacePayload = { kind: "surface", xs, ys, z, yaw: this.literals.yaw ?? 45, pitch: this.literals.pitch ?? 45 };
    const chart: ChartValue = {
      __chart: true, op: "surface", values: null, payload,
      options: {}, title: this.label || "Surface",
    };
    this.cachedChart = chart;
    return { chart };
  }
}

// ─── Contour (flat height-band plot) ─────────────────────────────────────────
// The flat twin of Surface: the SAME coordinate-bordered table (first row = X
// coordinates, first column = Y coordinates, interior = Z heights), rendered as
// filled height bands + iso-lines instead of a 3-D mesh. Wire the same grid into
// both for two views of one surface.

export class ContourNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { levels: 8 };
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string; levels?: number }) {
    super("Contour");
    this.label = init?.label ?? "Contour";
    if (typeof init?.levels === "number") this.literals.levels = init.levels;
    this.addInput("grid", tableIn("Bordered grid"));
    this.addInput("levels", numIn("Levels"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { grid?: (number | null | unknown)[][][]; levels?: number[] }): { chart: ChartValue } {
    const { xs, ys, z } = parseBorderedGrid(inputs.grid?.[0] ?? null);
    // Levels is a SHAPE — it decides how many bands the figure has, so a wired blank
    // leaves the figure empty rather than reusing the card's count.
    const levelsRaw = readInput(inputs.levels, this.literals.levels ?? 8);
    const levels = levelsRaw === null ? 0 : clamp(Math.round(levelsRaw), 2, 24);
    if (levelsRaw !== null) this.literals.levels = levels;
    const payload: ContourPayload = { kind: "contour", xs, ys, z, levels };
    const chart: ChartValue = { __chart: true, op: "contour", values: null, payload, options: {}, title: this.label || "Contour" };
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
// The finance bridge chart: each (label, value) row is a signed delta from the
// running total; a computed Total bar lands at the end. Wire a 2-column frame
// (Label, Value) — read positionally, like Treemap.

export class WaterfallNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 220;

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
// OHLC candles — the chart the Data Feed's stock history is FOR. Wire a frame
// whose columns are Date, Open, High, Low, Close (positional; with exactly four
// numeric columns the date is omitted and candles index 1, 2, 3…).

export class CandlestickNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 260;
  height = 220;

  constructor(init?: { label?: string }) {
    super("Candlestick");
    this.label = init?.label ?? "Candlestick";
    this.addInput("frame", frameIn("Date + O H L C"));
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
// The visual for the Quartile/Percentile family: one box per numeric column of a
// wired Frame (or a single box for a plain list). Whiskers reach the farthest
// sample within 1.5·IQR of the box (Tukey); anything beyond plots as an outlier
// dot. Received raw (like Chart) so a plain list doesn't widen into a 1-row frame.

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
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  rawInputs: ReadonlySet<string> = new Set(["values"]);
  width = 240;
  height = 220;

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
// The GitHub-style year grid: weeks × weekdays, each day tinted by its value.
// Wire a 2-column frame (Date, Value) — read positionally; the view lays out the
// data's own date span (capped at a year, keeping the most recent).

export class CalendarHeatmapNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 300;
  height = 170;

  constructor(init?: { label?: string }) {
    super("CalendarHeatmap");
    this.label = init?.label ?? "Calendar";
    this.addInput("frame", frameIn("Date + Value"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; options?: string[] }): Promise<{ chart: ChartValue }> {
    const cols = await readFrameColumns(inputs.frame?.[0] ?? null);
    // The date column must stay SERIALS (colAsNumbers formats dates into display
    // text first); pair each valid serial with its value.
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
// Proportions as a 10×10 grid of squares — the honest pie. Wire a 2-column frame
// (Label, Value) for category shares; a single row whose value is within [0, 1]
// reads as a plain fraction of the grid (a compact progress readout).

export class WaffleNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 220;
  height = 220;

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

// ─── Vector field (quiver) ────────────────────────────────────────────────────
// One arrow per grid cell from two same-shaped matrices (the x and y components),
// colored by magnitude — gradients, flows, wind fields. A null in either
// component skips that cell's arrow.

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
// A labeled "Concat for chart options": many small fields (one per matplotlib
// option) whose values are joined into the `key=value;…` string the Chart node's
// Options socket consumes. Every field is also an input socket, so any value can
// be wired from upstream (e.g. a computed title or a slider-driven Y max).

// The string fields go through `stringLiterals`, the numeric ones through
// `literals` — the same inline stores InlineInputs reads/writes, so they
// round-trip through persistence with no extra plumbing.
const CB_STR_FIELDS = ["title", "xlabel", "ylabel", "color", "grid", "marker"] as const;
const CB_NUM_FIELDS = ["ymin", "ymax", "linewidth", "alpha", "fontsize"] as const;

export class ChartBuilderNode extends ClassicPreset.Node {
  label: string;
  /** The chart type this builder is aimed at — shapes which option rows the
   *  card shows (CHART_BUILDER_TARGETS). Serialization stays full-width. */
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
    // Every field here is PRESENTATION. A wired blank means "this option was not
    // given" — it must NOT fall back to the card's own value, or a blank cable
    // silently reinstates styling the graph withheld (value-semantics.md, "Reading
    // an input"). `undefined` is what serializeChartOptions omits.
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

// Exported so the component (and tests) share the field lists.
export const CHART_BUILDER_FIELDS = { str: CB_STR_FIELDS, num: CB_NUM_FIELDS };
