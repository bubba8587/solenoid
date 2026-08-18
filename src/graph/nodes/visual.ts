import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, numOut, tableIn, tableOut, strIn, strOut, chartOut, anyTableIn, frameIn } from "./shared";
import { parseChartOptions, serializeChartOptions, CHART_BUILDER_TARGETS, type ChartOptions, type ChartTargetId } from "./chartOptions";
import { clamp, iterMin, iterMax } from "./mathUtils";
import type {
  ChartValue, KpiPayload, BulletPayload, TreemapPayload, SankeyPayload, SurfacePayload,
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

// The card dropdown DERIVES from this table (SSOT-1) — never hand-write a second list.
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
  composed:  { label: "Composed", group: "Multi-series: wire Series" },
  bubble:    { label: "Bubble",   group: "Multi-series: wire Series" },
} satisfies Record<ChartOp, { label: string; group: string }>;

// The 2-D ops read the `series` matrix input; the 1-D ops read `values`.
export const CHART_MATRIX_OPS = new Set<ChartOp>(["composed", "bubble"]);

export class ChartNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "A plain list or single column plots by position; from two columns, the first supplies the axis labels and the second the values.",
    series: "Only the Composed and Bubble types read it; the other types plot the Data input.",
    options: "Accepts key=value pairs separated by semicolons, using matplotlib names such as title, ylim, and grid; unknown keys are ignored.",
  };

  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  cachedMatrix: (number | null)[][] | null = null;
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
      { name: "Value", type: "number", cells: [120, 145, 98] },
    ] },
  };

  constructor(init?: { label?: string; op?: ChartOp }) {
    super("Chart");
    this.label = init?.label ?? "Chart";
    this.op = init?.op ?? "column";
    // A frame socket kept UNCOERCED by `rawInputs` — coerced, it would widen a wired list
    // into a single ROW instead of leaving it a list.
    this.addInput("values", frameIn("Data"));
    this.addInput("series", anyTableIn("Series"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: { values?: unknown[]; series?: unknown[][][]; options?: string[] }): { chart: ChartValue } {
    // A 2+-column FRAME drives a LABELED chart (col 0 → x-axis labels, col 1 → values).
    // Every non-finite cell becomes null IN PLACE, so row-indexed labels stay aligned.
    const num = (c: unknown): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);
    const raw = inputs.values?.[0] ?? null;
    this.cachedLabels = null;
    let v: number | number[] | null = null;
    if (isFrameValue(raw) && raw.columns.length > 0) {
      const cols = raw.columns;
      const asNums = (col: FrameColumn) => col.values.map(num);
      if (cols.length >= 2) {
        // formatFrameCell already renders errors and date serials as label text.
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
    // anyTable is element-agnostic, so coerce every cell to number|null.
    const rawMatrix = inputs.series?.[0] ?? null;
    this.cachedMatrix = Array.isArray(rawMatrix)
      ? rawMatrix.map((row) => (Array.isArray(row) ? row : [row]).map(num))
      : null;
    // Only a real string configures the options — a wired SolError/number falls back to the
    // inline literal, but a wired BLANK means "no styling given" and must not.
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
    // Bins is a SHAPE, not styling — a wired blank empties the figure. Mirror to the card
    // ONLY when unwired; writing a WIRED value into `literals` would overwrite and persist it.
    if (inputs.bins?.[0] === undefined && bins !== null) this.literals.bins = bins;
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

// ─── Gauge ────────────────────────────────────────────────────────────────────

export class GaugeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Read as a fraction of one, so 0.75 shows as 75 percent on a dial fixed at 0 to 100 percent.",
  };

  label: string;
  literals: Record<string, number> = { value: 0 };
  cachedResult: number | null = null;
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Gauge");
    this.label = init?.label ?? "Gauge";
    // A fraction of 100% (1 = 100%): the dial scale is fixed 0→100%, with no Min/Max inputs.
    this.addInput("value", numIn("Value"));
    this.addOutput("result", numOut("Pass-through"));
  }

  data(inputs: { value?: number[] }) {
    const v = readInput(inputs.value, this.literals.value ?? null);
    this.cachedResult = v;
    return { result: v };
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

// ─── Bullet graph ─────────────────────────────────────────────────────────────

export class BulletNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    max: "The track always starts at zero, so this sets only its upper end.",
  };

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
    // `max` is the track's SCALE, so it keeps the card's bound like a Slider does;
    // `value` and `target` are data and go blank.
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
  // Drop any column/row whose AXIS coordinate is non-finite — left as NaN it makes
  // `Math.min(...xs)` NaN and blanks the WHOLE figure while the z-only empty-check passes.
  const keptX: number[] = [];
  rawXs.forEach((x, i) => { if (x !== null) keptX.push(i); });
  const keptY: number[] = [];
  rawYs.forEach((y, i) => { if (y !== null) keptY.push(i); });
  const xs = keptX.map((i) => rawXs[i] as number);
  const ys = keptY.map((i) => rawYs[i] as number);
  const z = keptY.map((ri) => keptX.map((ci) => rawZ[ri]?.[ci] ?? null));
  return { xs, ys, z };
}

export type SurfaceViewOp = "surface" | "contour";

export const SURFACE_VIEW_OP_META = {
  surface: { label: "3-D",  description: "A shaded 3-D surface plot of a bordered lookup table (first row = X coordinates, first column = Y coordinates, interior = Z heights)." },
  contour: { label: "Flat", description: "The same bordered grid drawn flat: filled height bands with iso-lines." },
} satisfies Record<SurfaceViewOp, { label: string; description: string }>;

// ONE node, two views of one grid: the 3-D shaded surface and its flat
// contour twin. The op swaps the view; Contour alone has the Levels input,
// Surface alone the yaw/pitch literals (the component's D-pad).
export class SurfaceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    grid: "The first row holds the X coordinates, the first column the Y coordinates, and the interior cells the heights; the corner cell is ignored.",
  };

  label: string;
  op: SurfaceViewOp;
  // View angles (degrees) live in `literals` so they persist and the rotate buttons nudge them.
  literals: Record<string, number> = { yaw: 45, pitch: 45 };
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
    this.addInput("grid", tableIn("Bordered grid"));
    if (this.op === "contour") {
      this.literals.levels ??= 8;
      this.addInput("levels", numIn("Levels"));
    }
    this.addOutput("chart", chartOut("Chart"));
    this.height = this.op === "contour" ? 240 : 220;
  }

  /** The op owns the Levels socket. Callers on a live graph prune its cables
   *  BEFORE switching to the 3-D view (SSOT-9). */
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

  data(inputs: { grid?: (number | null | unknown)[][][]; levels?: number[] }): { chart: ChartValue } {
    const { xs, ys, z } = parseBorderedGrid(inputs.grid?.[0] ?? null);
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
    frame: "The date column is optional; with exactly four columns all four read as open, high, low, close and rows are numbered instead.",
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
    values: "Each numeric column draws as its own box and other columns are skipped; a plain list draws a single box.",
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

/** A layout cell: one line per grid row, cells split on "|", "." or an empty
 *  cell is a gap. Repeating a name claims its bounding rectangle (a lenient
 *  grid-template-areas: a non-rectangular repeat degrades to its bounds instead
 *  of invalidating the grid). Names keep first-occurrence spelling. */
export function parseRecordLayout(text: string): Array<{ name: string; row: number; col: number; rowSpan: number; colSpan: number }> {
  const rows = text
    .split("\n")
    .map((line) => line.split("|").map((c) => c.trim()))
    .filter((cells) => cells.some((c) => c !== "" && c !== "."));
  const rects = new Map<string, { name: string; r0: number; c0: number; r1: number; c1: number }>();
  const order: string[] = [];
  rows.forEach((cells, r) =>
    cells.forEach((name, c) => {
      if (name === "" || name === ".") return;
      const key = name.toLowerCase();
      const rect = rects.get(key);
      if (!rect) {
        rects.set(key, { name, r0: r, c0: c, r1: r, c1: c });
        order.push(key);
      } else {
        rect.r0 = Math.min(rect.r0, r); rect.c0 = Math.min(rect.c0, c);
        rect.r1 = Math.max(rect.r1, r); rect.c1 = Math.max(rect.c1, c);
      }
    }),
  );
  return order.map((key) => {
    const t = rects.get(key)!;
    return { name: t.name, row: t.r0 + 1, col: t.c0 + 1, rowSpan: t.r1 - t.r0 + 1, colSpan: t.c1 - t.c0 + 1 };
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

// The card dropdown DERIVES from this table (SSOT-1) — never hand-write a second list.
export const RECORD_OP_META = {
  card:    { label: "Card" },
  gallery: { label: "Gallery" },
  board:   { label: "Board" },
} satisfies Record<RecordOp, { label: string }>;

// Gallery/board draw at most this many cards; `payload.more` carries the rest.
export const RECORD_CARD_CAP = 60;

export class RecordNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    row: "Selects the 1-based record; blank or out of range shows the boxes empty.",
    picked: "Echoes the 1-based row the card shows, so downstream follows the pager; blank when no record is picked.",
    by: "Names the column whose values become the board's lanes; blank or unmatched draws nothing.",
    layout: "One line per grid row with column names separated by | marks. Repeating a name merges its cells into one box; a dot or an empty cell stays blank. Left empty, the columns stack in a single column of boxes.",
    options: "Accepts key=value pairs separated by semicolons, using matplotlib names. A record figure reads title, which names the popup and the Report embed, and fontsize, which scales the card text from its normal size of 10; every other key is ignored.",
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
    this.addOutput("picked", numOut("Row"));
  }

  /** The op owns the Row and Group-by sockets. Callers on a live graph prune the
   *  departing keys' cables BEFORE switching (SSOT-9). */
  setOp(next: RecordOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "card") { if (!this.inputs.row) this.addInput("row", numIn("Row")); }
    else if (this.inputs.row) this.removeInput("row");
    if (next === "board") { if (!this.inputs.by) this.addInput("by", strIn("Group by")); }
    else if (this.inputs.by) this.removeInput("by");
  }

  async data(inputs: { frame?: (FrameInput | null)[]; row?: number[]; by?: string[]; layout?: string[]; options?: string[] }): Promise<{ chart: ChartValue; picked: number | null }> {
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
    const field = (name: string, col: FrameColumn | undefined, rowIdx: number | null, at: { row: number; col: number; rowSpan: number; colSpan: number }): RecordField => {
      const label = col
        ? (col.unit ? `${col.name} (${columnUnitLabel(col.unit)})` : col.name)
        : name;
      const raw = col && rowIdx !== null ? col.values[rowIdx] ?? null : null;
      const shown = raw === null ? null : formatFrameCell(col!.type, raw);
      const image = typeof shown === "string" ? recordImageSrc(shown) : null;
      return { label, value: shown, ...(image ? { image } : {}), ...at };
    };
    const placed = layStr && layStr.trim() !== "" ? parseRecordLayout(layStr) : [];
    // No layout → every column stacks (the board skips its own grouping column
    // there — every card in a lane would repeat the lane's label). A layout
    // stands on its own, so it can be drafted before the frame is wired
    // (unmatched names keep their boxes).
    const stackCols = cols.filter((c) => !(this.op === "board" && c === byCol));
    const cardAt = (rowIdx: number | null): RecordField[] =>
      placed.length > 0
        ? placed.map((p) => field(p.name, byName.get(p.name.toLowerCase()), rowIdx, { row: p.row, col: p.col, rowSpan: p.rowSpan, colSpan: p.colSpan }))
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
    return { chart, picked: index >= 1 ? index : null };
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
    result: "Feeds any figure's Options input; only the fields given a value are included.",
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
