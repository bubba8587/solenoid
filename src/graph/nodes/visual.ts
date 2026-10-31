// [[B11]]
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { readRole, numIn, numListIn, tableIn, strIn, strOut, chartIn, chartOut, frameIn, frameOut, cubeAdoptIn, strListIn } from "./shared";
import { setting, picks } from "../inputRoles";
import { chartBuilderKeys, type ChartOptions, type ChartTargetId } from "./chartOptions";
import { clamp } from "./mathUtils";
import type {
  ChartValue, KpiPayload, ScalePayload, SankeyPayload, RecordPayload, XYPayload, ChartRef,
} from "../chartValue";
import type { SolError } from "../errorValue";
import type { MermaidValue } from "../mermaidValue";
import { readFrame, type FrameInput } from "../frameBackend";
import type { FrameValue } from "../frame";
import type { Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";
import type { FrameHint } from "../frameHint";
import { parseRecordLayout, recordImageSrc, type RecordPlacement } from "../recordLayout";
import { displayDecimals } from "../components/format";
import { settingsStore } from "../settingsStore";

import type { SparklineOp } from "./visualOps";
export type { SparklineOp };

export const SPARKLINE_OP_META = {
  line:    { label: "Line" },
  column:  { label: "Column" },
  winloss: { label: "Win/Loss" },
} satisfies Record<SparklineOp, { label: string }>;

// ─── Sparkline ────────────────────────────────────────────────────────────────

export class SparklineNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Chart ──────────────────────────────────────────────────────────────────

export type ChartOp =
  | "column" | "bar" | "line" | "area"
  | "pie" | "radar" | "radialbar" | "funnel" | "scatter" | "xyline"
  | "bubble";

export const CHART_OP_META = {
  column:    { label: "Column",   group: "Cartesian" },
  bar:       { label: "Bar",      group: "Cartesian" },
  line:      { label: "Line",     group: "Cartesian" },
  area:      { label: "Area",     group: "Cartesian" },
  scatter:   { label: "Scatter",  group: "XY" },
  xyline:    { label: "XY Line",  group: "XY" },
  bubble:    { label: "Bubble",   group: "XY" },
  pie:       { label: "Pie",      group: "Categorical" },
  radar:     { label: "Radar",    group: "Categorical" },
  radialbar: { label: "Radial",   group: "Categorical" },
  funnel:    { label: "Funnel",   group: "Categorical" },
} satisfies Record<ChartOp, { label: string; group: string }>;

export class ChartNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    values: "A list plots by position; a frame's first column is x, later number columns are series. Radar: columns are spokes, rows polygons. Bubble: x, y, size. Scatter, XY Line and Bubble can pick columns by name in the options.",
    options: "Accepts key=value pairs separated by semicolons, using matplotlib names such as title, ylim, and grid. Scatter, XY Line and Bubble also read x, y, s (size), c (color), annotate and by as column names. Unknown keys are ignored.",
    references: "Reference marks, one per row, read by column name: x alone is a dashed vertical line, y alone a horizontal one, x and y together a point. Add x2 or y2 for a shaded area: all four make a box, and a blank end runs to the edge of the plot. Label and color are optional. On a chart of categories, x names a category. Color takes a palette name or a CSS color.",
  };

  label: string;
  op: ChartOp;
  cachedResult: number | number[] | null = null;
  cachedSeries: { name: string; values: (number | null)[] }[] | null = null;
  cachedLabels: (string | number)[] | null = null;
  cachedPayload: XYPayload | null = null;
  cachedError: SolError | null = null;
  cachedRefs: ChartRef[] | null = null;
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
    references: { columns: [
      { name: "x", type: "date", cells: [44894, 44985, 45677] },
      { name: "label", type: "string", cells: ["ChatGPT", "CHIPS funding", "DeepSeek-R1"] },
      { name: "color", type: "string", cells: ["gray", "pink", "gray"] },
    ] },
  };

  constructor(init?: { label?: string; op?: ChartOp }) {
    super("Chart (Recharts)");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "column";
    this.addInput("values", cubeAdoptIn("Data"));
    this.addInput("references", frameIn("References"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError };
  }
}

// ─── Merge Plots ──────────────────────────────────────────────────────────────

export class MergePlotsNode extends GraphNode {
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
    this.moveInputLast("options");
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError };
  }
}

// ─── Conditional Regions ──────────────────────────────────────────────────────

export type RegionsMode = "inclusive" | "strict";
export const REGIONS_MODE_META = {
  inclusive: { label: "≤", description: "A point on a line counts: it takes the regions it touches, TRUE or the label listed first where they disagree." },
  strict:    { label: "<", description: "A point on a line counts for no region and comes out blank." },
} satisfies Record<RegionsMode, { label: string; description: string }>;

export type RegionsOp = "bool" | "text" | "num";
export const REGIONS_OP_META = {
  bool: { label: "True/False", keywords: "boolean true false in inside mask" },
  text: { label: "Labels", keywords: "text label name category zone ifs" },
  num:  { label: "Values", keywords: "number value rate score lookup tier" },
} satisfies Record<RegionsOp, { label: string; keywords: string }>;

/** One plotted point: x, y, its answer (a Text card's as the label's place in the list), and whether it sits on a line. */
export type RegionPoint = [number, number, boolean | number | null, boolean];
/** What cuts the plane: each series as x1, y1, x2, y2 runs, an open series' two ends carried on out of the plot as the
 *  same runs, the vertical lines' x and the horizontal lines' y. */
export interface RegionCuts { curves: number[][]; tails: number[][]; xs: number[]; ys: number[] }

export class ConditionalRegionsNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    chart: "A Scatter, XY Line or Bubble chart. Each series is a line, a scatter's points joined in order of x, and each References row with only x or only y is a straight line.",
    points: "The first column is x and the second y. A row missing either comes out blank.",
    labels: "The names a region can take, in order. Where regions with different labels meet, a point on the line takes the one listed first.",
    values: "The numbers a region can take, in order. Where regions with different values meet, a point on the line takes the one listed first.",
    result: "The points with an in column of TRUE, FALSE or blank, a label or value column of each region's item or a blank, and with Margin a margin column.",
  };

  label: string;
  mode: RegionsMode;
  op: RegionsOp;
  regionMarks: Record<string, boolean>;
  /** A Labels card's marks: each region's label by its place in the list. */
  regionLabels: Record<string, number>;
  /** A Values card's marks, the same way. */
  regionValues: Record<string, number>;
  /** Adds a margin column: each point's distance to the nearest line where the answer changes. */
  margin: boolean;
  stringLiterals: Record<string, string> = {};
  cachedChart: ChartValue | null = null;
  cachedLabels: string[] | null = null;
  cachedCuts: RegionCuts | null = null;
  cachedPoints: RegionPoint[] | null = null;
  cachedError: SolError | null = null;
  width = 240;
  height = 280;

  constructor(init?: {
    label?: string; op?: RegionsOp; mode?: RegionsMode;
    regionMarks?: Record<string, boolean>; regionLabels?: Record<string, number>; regionValues?: Record<string, number>;
    margin?: boolean;
  }) {
    super("ConditionalRegions");
    this.label = init?.label ?? "";
    this.mode = init?.mode === "strict" ? "strict" : "inclusive";
    this.op = init?.op === "text" || init?.op === "num" ? init.op : "bool";
    this.regionMarks = { ...(init?.regionMarks ?? {}) };
    this.regionLabels = { ...(init?.regionLabels ?? {}) };
    this.regionValues = { ...(init?.regionValues ?? {}) };
    this.margin = init?.margin === true;
    this.addInput("chart", chartIn("Chart"));
    this.addInput("points", frameIn("Points"));
    this.addListInput();
    this.addOutput("result", frameOut("Points"));
  }

  /** The list input the op answers from: Labels for Labels, Values for Values, none for True/False. */
  listKey(op: RegionsOp = this.op): "labels" | "values" | null {
    return op === "text" ? "labels" : op === "num" ? "values" : null;
  }

  private addListInput(): void {
    const key = this.listKey();
    if (key === "labels" && !this.inputs.labels) this.addInput("labels", strListIn("Labels"));
    if (key === "values" && !this.inputs.values) {
      this.stringLiterals.values ??= "";
      this.addInput("values", numListIn("Values"));
    }
  }

  /** Swaps the list input for the op's own, so the one leaving has its cables pruned first. */
  setOp(next: RegionsOp): void {
    const leaving = this.listKey();
    this.op = next;
    if (leaving && leaving !== this.listKey()) this.removeInput(leaving);
    this.addListInput();
  }

  /** The points' x and y columns, then `in` or `label`; unknown until the points' shape is, or when a points column
   *  already has that name. */
  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const [x, y] = ctx.inputShape("points")?.columns ?? [];
    const third = this.op === "text" ? "label" : this.op === "num" ? "value" : "in";
    const names = [third, ...(this.margin ? ["margin"] : [])];
    if (!x || !y || names.includes(x.name) || names.includes(y.name)) return null;
    const type = this.op === "text" ? "string" : this.op === "num" ? "number" : "logical";
    return { columns: [x, y, { name: third, type }, ...(this.margin ? [{ name: "margin", type: "number" as const }] : [])] };
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { result: FrameValue | SolError | null };
  }
}

// ─── Histogram ────────────────────────────────────────────────────────────────

export type HistogramMode = "1d" | "2d";
export const HISTOGRAM_MODE_META = {
  "1d": { label: "1-D", description: "Bin one list of numbers into equal-width buckets, plotted as columns." },
  "2d": { label: "2-D", description: "Bin paired X and Y numbers into a grid, drawn as a density plot. numpy `histogram2d`." },
} satisfies Record<HistogramMode, { label: string; description: string }>;

export class HistogramNode extends GraphNode {
  static inputRoles = { bins: setting(10), ybins: setting(10) };
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
    this.addInput("values", numListIn(""));
    this.addInput("bins", numIn(""));
    this.labelModeInputs();
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

  private labelModeInputs(): void {
    this.inputs.values!.label = this.mode === "2d" ? "X" : "Values";
    this.inputs.bins!.label = this.mode === "2d" ? "X bins" : "Bins";
  }

  setMode(next: HistogramMode): void {
    if (next === this.mode) return;
    this.mode = next;
    this.labelModeInputs();
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError } {
    const out = nodeOnCore(this, inputs) as { chart: ChartValue | SolError };
    if (inputs.bins?.[0] === undefined) this.literals.bins = readRole<number>(this, "bins", undefined);
    if (this.mode === "2d" && inputs.ybins?.[0] === undefined) this.literals.ybins = readRole<number>(this, "ybins", undefined);
    return out;
  }
}

// ─── Mermaid ──────────────────────────────────────────────────────────────────

const DEFAULT_MERMAID = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]";

export class MermaidNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { diagram: MermaidValue } {
    return nodeOnCore(this, inputs) as { diagram: MermaidValue };
  }
}

// ─── Gauge ─────────────────────────────────────────────────────────────────────
export type GaugeStyle = "dial" | "bar";
const GAUGE_STYLE_META = {
  dial: { label: "Dial" },
  bar:  { label: "Bar" },
} satisfies Record<GaugeStyle, { label: string }>;
export const GAUGE_STYLE_OPTIONS = Object.entries(GAUGE_STYLE_META).map(([value, m]) => ({ value: value as GaugeStyle, label: m.label }));

export class GaugeNode extends GraphNode {
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
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  private addBarInputs(): void {
    this.addInput("target", numIn("Target"));
    this.addInput("max", numIn("Max"));
  }

  keysDropped(next: GaugeStyle): string[] {
    return next === "dial" && this.mode === "bar" ? ["target", "max"] : [];
  }

  setMode(next: GaugeStyle): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "dial") {
      for (const k of ["target", "max"]) if (this.inputs[k]) this.removeInput(k);
    } else {
      this.addBarInputs();
    }
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    const out = nodeOnCore(this, inputs) as { chart: ChartValue };
    if (inputs.value?.[0] === undefined) this.literals.value ??= 0;
    if (this.mode === "bar") {
      if (inputs.target?.[0] === undefined) this.literals.target ??= 0;
      if (inputs.max?.[0] === undefined) this.literals.max ??= 100;
    }
    return out;
  }
}

// ─── KPI / Stat card ──────────────────────────────────────────────────────────

export class KpiNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    const out = nodeOnCore(this, inputs) as { chart: ChartValue };
    if (inputs.value?.[0] === undefined) this.literals.value ??= 0;
    if (inputs.prev?.[0] === undefined) this.literals.prev ??= 0;
    return out;
  }
}

// ─── Proportion ─────────────────────────────────────────────────────────────────

export type ProportionLayout = "treemap" | "waffle";
export const PROPORTION_OP_META = {
  treemap: { label: "Treemap" },
  waffle:  { label: "Waffle" },
} satisfies Record<ProportionLayout, { label: string }>;
export const PROPORTION_LAYOUT_OPTIONS = Object.entries(PROPORTION_OP_META).map(([value, m]) => ({ value: value as ProportionLayout, label: m.label }));

export class ProportionNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Sankey ───────────────────────────────────────────────────────────────────

export class SankeyNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError };
  }
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

export class HeatmapNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    values: "A frame's number columns are the heatmap's columns, and a first column of text or dates names the rows. A plain table plots as it stands.",
    options: "key=value pairs separated by semicolons, or a Chart Builder. Reads seaborn's heatmap names: cmap, center, vmin, vmax, annot, fmt, cbar, plus aspect and origin.",
  };

  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  rawInputs: ReadonlySet<string> = new Set(["values"]);
  width = 280;
  height = 260;

  static frameHints: Record<string, FrameHint> = {
    values: { columns: [
      { name: "Region", type: "string", cells: ["North", "South", "West"] },
      { name: "Q1", type: "number", cells: [12, 18, 9] },
      { name: "Q2", type: "number", cells: [15, 13, 11] },
      { name: "Q3", type: "number", cells: [11, 16, 14] },
    ] },
  };

  constructor(init?: { label?: string }) {
    super("Heatmap");
    this.label = init?.label ?? "Heatmap";
    this.addInput("values", frameIn("Data"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Surface (shaded 3-D plot) ──────────────────────────────────────────────────

export type SurfaceViewOp = "surface" | "contour";

export const SURFACE_VIEW_OP_META = {
  surface: { label: "3-D",  description: "A shaded 3-D surface plot over a table of heights, with optional Xs and Ys coordinate lists; unwired axes count 1, 2, 3…" },
  contour: { label: "Flat", description: "The same table drawn flat: filled height bands with iso-lines." },
} satisfies Record<SurfaceViewOp, { label: string; description: string }>;

export class SurfaceNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    xs: "One X coordinate per column; unwired means 1, 2, 3…",
    ys: "One Y coordinate per row; unwired means 1, 2, 3…",
    options: "key=value pairs separated by semicolons, or a Chart Builder. Both views read title and cmap; the flat view also reads xlabel, ylabel, center, vmin, vmax and cbar.",
  };

  label: string;
  op: SurfaceViewOp;
  literals: Record<string, number> = { yaw: 45, pitch: 45 };
  stringLiterals: Record<string, string> = { xs: "", ys: "" };
  chartOptions: ChartOptions = {};
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
    this.addInput("options", strIn("Options"));
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
    this.moveInputLast("options");
    this.height = next === "contour" ? 240 : 220;
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    const out = nodeOnCore(this, inputs) as { chart: ChartValue };
    if (this.op === "contour" && inputs.levels?.[0] === undefined) this.literals.levels = clamp(Math.round(this.literals.levels ?? 8), 2, 24);
    return out;
  }
}

// ─── Waterfall ────────────────────────────────────────────────────────────────

export class WaterfallNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Candlestick ──────────────────────────────────────────────────────────────

export class CandlestickNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue | SolError | null } {
    return nodeOnCore(this, inputs) as { chart: ChartValue | SolError | null };
  }
}

// ─── Boxplot ──────────────────────────────────────────────────────────────────

export class BoxplotNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Calendar heatmap ─────────────────────────────────────────────────────────

export class CalendarHeatmapNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}


// ─── Record card ──────────────────────────────────────────────────────────────

export { parseRecordLayout, recordImageSrc, type RecordPlacement };

export type RecordOp = "detail" | "cards" | "gallery" | "board" | "list";

export const RECORD_OP_META = {
  detail:  { label: "Detail", keywords: "single one record form pager" },
  cards:   { label: "Cards", keywords: "card stack deck profile people contacts auto layout mobile" },
  gallery: { label: "Gallery" },
  board:   { label: "Board", keywords: "kanban lanes" },
  list:    { label: "List" },
} satisfies Record<RecordOp, { label: string; keywords?: string }>;

type RecordInputs = { frame?: unknown[]; rows?: unknown[]; by?: string[]; layout?: string[]; options?: string[] };

export class RecordNode extends GraphNode {
  static inputRoles = { rows: picks() };
  static socketDocs: Record<string, string> = {
    rows: "Picks the records, 1-based, in order: 3, or 1, 3, 5; -1 is the last. Blank shows every record. Detail pages through the picks.",
    by: "Names the column whose values become the board's lanes. Blank or unmatched draws nothing.",
    layout: "A line per row, names split by |. Repeat to merge. Photo*2 spans two, #Name titles, Qty: 40 is placeholder, a dot is blank. Empty stacks columns.",
    options: "title=Parts;fontsize=12;cardsize=l. Gallery and Cards tiles size s, m or l; clamp=on caps long values at three lines and folds a card past six fields.",
  };

  label: string;
  op: RecordOp;
  /** Detail's pager: the 1-based position among the picked rows. */
  literals: Record<string, number> = { page: 1 };
  stringLiterals: Record<string, string> = { rows: "" };
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
    this.op = init?.op ?? "detail";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("rows", numListIn("Rows"));
    if (this.op === "board") this.addInput("by", strIn("Group by"));
    if (this.op !== "cards") this.addInput("layout", strIn("Layout"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  setOp(next: RecordOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "board") { if (!this.inputs.by) this.addInput("by", strIn("Group by")); }
    else if (this.inputs.by) this.removeInput("by");
    if (next !== "cards") { if (!this.inputs.layout) this.addInput("layout", strIn("Layout")); }
    else if (this.inputs.layout) this.removeInput("layout");
  }

  /** The display settings a number nobody formatted shows by ([[C118]] formatTravelsWithValue), which the Cards plan reads. */
  static coreFields = ["numberDisplay"] as const;
  get numberDisplay(): { decimals: number; sciAbove: string } {
    return { decimals: displayDecimals(), sciAbove: String(settingsStore.get("sciAbove")) };
  }

  /** Reads a frame ref through the backend first; Detail's pager keeps the page it lands on. */
  async data(inputs: RecordInputs): Promise<{ chart: ChartValue }> {
    const fv = await readFrame((inputs.frame?.[0] ?? null) as FrameInput | null);
    const out = nodeOnCore(this, inputs.frame ? { ...inputs, frame: [fv] } : inputs) as { chart: ChartValue };
    const p = out.chart.payload as RecordPayload;
    if (this.op === "detail" && p.total > 0) this.literals.page = p.index;
    return out;
  }
}

// ─── Vector field (quiver) ────────────────────────────────────────────────────

export class QuiverNode extends GraphNode {
  label: string;
  stringLiterals: Record<string, string> = {};
  chartOptions: ChartOptions = {};
  cachedChart: ChartValue | null = null;
  width = 240;
  height = 240;

  constructor(init?: { label?: string }) {
    super("Quiver");
    this.label = init?.label ?? "Vector Field";
    this.addInput("u", tableIn("ΔX components"));
    this.addInput("v", tableIn("ΔY components"));
    this.addInput("options", strIn("Options"));
    this.addOutput("chart", chartOut("Chart"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { chart: ChartValue } {
    return nodeOnCore(this, inputs) as { chart: ChartValue };
  }
}

// ─── Chart Builder ────────────────────────────────────────────────────────────

const CB_STR_FIELDS = ["title", "xlabel", "ylabel", "color", "grid", "marker", "pielabels", "radarscale", "zoom", "layout", "tiers", "fit", "critical", "baseline", "arrows", "today", "weekends", "labels", "histogram", "minutes", "window", "columns", "collapse", "week", "fiscal_start", "status", "group_by", "cardsize", "clamp", "x", "y", "s", "c", "annotate", "by", "linestyle", "aspect", "cmap", "annot", "fmt", "cbar", "origin", "yscale"] as const;
const CB_NUM_FIELDS = ["xmin", "xmax", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize", "vmin", "vmax", "center", "maxgap"] as const;

export class ChartBuilderNode extends GraphNode {
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
    this.addInput("x",         strIn("X column"));
    this.addInput("y",         strIn("Y columns"));
    this.addInput("s",         strIn("Size column"));
    this.addInput("c",         strIn("Color column"));
    this.addInput("annotate",  strIn("Point labels"));
    this.addInput("by",        strIn("Split by"));
    this.addInput("linestyle", strIn("Line style"));
    this.addInput("aspect",    strIn("Aspect"));
    this.addInput("yscale",    strIn("Y scale"));
    this.addInput("cmap",      strIn("Colormap"));
    this.addInput("annot",     strIn("Cell values"));
    this.addInput("fmt",       strIn("Value format"));
    this.addInput("cbar",      strIn("Colorbar"));
    this.addInput("origin",    strIn("First row"));
    this.addInput("xmin",      numIn("X min"));
    this.addInput("xmax",      numIn("X max"));
    this.addInput("ymin",      numIn("Y min"));
    this.addInput("ymax",      numIn("Y max"));
    this.addInput("linewidth", numIn("Line width"));
    this.addInput("markersize", numIn("Marker size (px)"));
    this.addInput("alpha",     numIn("Opacity"));
    this.addInput("fontsize",  numIn("Font size (pt)"));
    this.addInput("vmin",      numIn("Color min"));
    this.addInput("vmax",      numIn("Color max"));
    this.addInput("center",    numIn("Color center"));
    this.addInput("maxgap",    numIn("Break lines over x gaps"));
    this.addOutput("result", strOut("Options"));
  }

  /** Switch the figure, clearing every field the new one does not read; the card removes those fields' cables first. */
  setTarget(next: ChartTargetId): void {
    const keep = new Set<string>(chartBuilderKeys(next, this.stringLiterals.layout));
    for (const k of Object.keys(this.stringLiterals)) if (!keep.has(k)) delete this.stringLiterals[k];
    for (const k of Object.keys(this.literals)) if (!keep.has(k)) delete this.literals[k];
    this.target = next;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: string } {
    return nodeOnCore(this, inputs) as { result: string };
  }
}

export const CHART_BUILDER_FIELDS = { str: CB_STR_FIELDS, num: CB_NUM_FIELDS };
