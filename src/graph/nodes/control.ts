// [[D54]], [[B11]] maximalMerge
import { GraphInput, GraphNode, GraphOutput } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numberSocket, stringSocket, dateSocket, logicalSocket, AdoptiveSocket, MutableSocket, type SocketDataType } from "../sockets";
import { frameIn, frameOut, dateOut, numOut, tableOut } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { shapeOfFrameValue, type Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";
import type { FrameValue, FrameColType } from "../frame";
import { collectPreview, isFrameRef, materialize, readRefColumn, type FrameRef } from "../frameBackend";
import { beginPass, emitFrame, relinked } from "./frame";
import { jsDateToSerial, parseDate, formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import { isRelativeDateText } from "./dateSerial";
import { settingsStore } from "../settingsStore";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";
import { isSolError, type SolError } from "../errorValue";
import { isDateStyle, type FormatAnnotation, type FormatStyleId, type DecimalMode, type TextCase, type TextAlign, type LogicalStyle, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import type { TableElemType } from "./matrix";
import { clamp } from "./mathUtils";

export type SlicerCell = number | string | boolean;

export class CableSwitchNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    out: "One mode routes the active input through unchanged, keeping its type and unit. Many mode collects the checked inputs into a cube of name and value rows.",
  };
  label: string;
  /** Not named `selected`, which is GraphNode's selection flag. */
  activeIndex: number;
  titles: Record<string, string>;
  multiSelect: boolean;
  selectedKeys: string[];
  cachedValue: unknown = null;
  nextInputId = 0;
  /** Its own MutableSocket instance, so a retype never touches a shared singleton. */
  readonly outSocket = new MutableSocket("trueany");
  width = 200; height = 220;

  constructor(init?: { label?: string; activeIndex?: number; valueKeys?: string[]; titles?: Record<string, string>; multiSelect?: boolean; selectedKeys?: string[] }) {
    super("CableSwitch");
    this.label = init?.label ?? "Input Switch";
    this.activeIndex = init?.activeIndex ?? 0;
    this.titles = { ...(init?.titles ?? {}) };
    this.multiSelect = init?.multiSelect ?? false;
    this.selectedKeys = [...(init?.selectedKeys ?? [])];
    this.outSocket.setType(this.multiSelect ? "cube" : "trueany");
    this.addOutput("out", new GraphOutput(this.outSocket, "Out"));
    if (init?.valueKeys?.length) {
      for (const k of init.valueKeys) this.addInputWithKey(k);
    } else {
      for (let i = 0; i < 2; i++) this.addValueInput();
    }
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, new GraphInput(new AdoptiveSocket()));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    // `activeIndex` is positional, so removing a slot above the live one must shift it to follow the chosen slot.
    const idx = Object.keys(this.inputs).indexOf(key);
    this.removeInput(key);
    delete this.titles[key];
    this.selectedKeys = this.selectedKeys.filter((k) => k !== key);
    if (idx >= 0 && idx < this.activeIndex) this.activeIndex -= 1;
    const n = Object.keys(this.inputs).length;
    this.activeIndex = n ? clamp(this.activeIndex, 0, n - 1) : 0;
  }

  titleFor(key: string): string {
    const t = (this.titles[key] ?? "").trim();
    return t || `Input ${Object.keys(this.inputs).indexOf(key) + 1}`;
  }

  passthrough(): PassthroughSpec[] {
    if (this.multiSelect) return [];
    return [{ output: "out", inputs: Object.keys(this.inputs), combine: "active", activeIndex: () => this.activeIndex }];
  }

  syncOutputType(): boolean {
    const want: SocketDataType = this.multiSelect ? "cube" : "trueany";
    if (this.outSocket.dataType === want) return false;
    this.outSocket.setType(want);
    return true;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { out: unknown };
  }
}

export class AngleDialNode extends GraphNode {
  label: string;
  value: number;   // degrees, 0–359
  step: number;
  width  = 160;
  height = 175;

  constructor(init?: { label?: string; value?: number; step?: number }) {
    super("AngleDial");
    this.label = init?.label ?? "Angle Dial";
    this.value = init?.value ?? 0;
    this.step  = init?.step  ?? 15;
    this.addOutput("value", new GraphOutput(numberSocket, "Degrees"));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { value: number };
  }
}

type LastRelative = { text: string; serial: number } | null;

const relativeDatesAllowed = (): boolean => settingsStore.get("relativeDates");

/** A typed date's serial; a relative phrase ([[D54]] relativeDatesOptIn) alerts when it re-resolves to a new day. */
function resolveDateText(
  node: { id: string; label?: string },
  raw: string,
  last: LastRelative,
): { result: number | SolError | null; last: LastRelative } {
  const text = raw.trim();
  const relative = isRelativeDateText(text) && relativeDatesAllowed();
  const r = parseDate(text, relative ? { relative: true } : undefined);
  if (isSolError(r)) return { result: r, last: null };
  const serial = Number.isFinite(r) ? Math.floor(r) : null;
  if (!relative || serial === null) return { result: serial, last: null };
  if (last !== null && last.text === text && last.serial !== serial && !isGraphRebuilding()) {
    const name = (node.label ?? "").trim() || "Value Input";
    fireAlert({
      nodeId: node.id, label: name, kind: "warning",
      message: `${name}: "${text}" now resolves to ${formatDateSerial(serial, DEFAULT_DATE_FORMAT)} (was ${formatDateSerial(last.serial, DEFAULT_DATE_FORMAT)})`,
    });
  }
  return { result: serial, last: { text, serial } };
}

export type ValueInputOp = TableElemType;

/** The one place each type is named: the card's toggle and the Add menu's search rows both read it. The keywords carry the retired single-type inputs' names, so "date input" still finds its row. */
export const VALUE_INPUT_OP_META = {
  number:  { label: "Number",  keywords: "number input numeric scalar literal constant", accents: ["number"] },
  string:  { label: "Text",    keywords: "text input string literal", accents: ["string"] },
  date:    { label: "Date",    keywords: "date input day calendar picker serial", accents: ["date"] },
  logical: { label: "Boolean", keywords: "boolean input logical true false checkbox toggle", accents: ["logical"] },
} satisfies Record<ValueInputOp, { label: string; keywords?: string; accents: readonly SocketDataType[] }>;

const VALUE_INPUT_OPS = Object.keys(VALUE_INPUT_OP_META) as ValueInputOp[];

const todayText = () => formatDateSerial(Math.floor(jsDateToSerial(new Date())), DEFAULT_DATE_FORMAT);

function valueSocketFor(t: ValueInputOp) {
  switch (t) {
    case "number":  return numberSocket;
    case "string":  return stringSocket;
    case "date":    return dateSocket;
    case "logical": return logicalSocket;
  }
}

/** The typed text across a type switch: kept where it still reads in the new type, else carried by meaning or reset to the type's default. */
export function carryValueText(text: string, to: ValueInputOp): string {
  const t = text.trim();
  const n = t === "" ? NaN : Number(t);
  const isTrue = /^true$/i.test(t);
  switch (to) {
    case "string":  return text;
    case "number":  return Number.isFinite(n) ? t : isTrue ? "1" : "0";
    case "logical": return isTrue || (Number.isFinite(n) && n !== 0) ? "TRUE" : "FALSE";
    case "date": {
      const relative = isRelativeDateText(t) && relativeDatesAllowed();
      const d = parseDate(t, relative ? { relative: true } : undefined);
      return typeof d === "number" && Number.isFinite(d) ? text : todayText();
    }
  }
}

/** One typed value of any scalar type, with its display format and unit set on the card itself ([[C118]] formatTravelsWithValue). */
export class ValueInputNode extends GraphNode {
  label: string;
  op: ValueInputOp;
  value: string;
  format: FormatStyleId;
  customPattern: string;
  decimalDigits: number;
  decimalMode: DecimalMode;
  unit: string;
  customUnit: string;
  textCase: TextCase;
  chip: boolean;
  logicalStyle: LogicalStyle;
  bold: boolean;
  italic: boolean;
  textScale: number;
  textAlign: TextAlign;
  textMarkdown: boolean;
  textMono: boolean;
  grouping: boolean;
  negativeStyle: NegativeStyle;
  scaleMode: ScaleMode;
  width = 180;
  height = 140;
  cachedValue: unknown = null;
  private lastRelative: LastRelative = null;
  /** What was typed under each op this session, so switching away and back restores it; only the shown op's text is saved ([[C28]] literalsIffEditable). */
  private entryByOp: Partial<Record<ValueInputOp, string>> = {};

  constructor(init?: {
    label?: string;
    op?: ValueInputOp;
    value?: string;
    format?: FormatStyleId;
    customPattern?: string;
    decimalDigits?: number;
    decimalMode?: DecimalMode;
    unit?: string;
    customUnit?: string;
    textCase?: TextCase;
    chip?: boolean;
    logicalStyle?: LogicalStyle;
    bold?: boolean;
    italic?: boolean;
    textScale?: number;
    textAlign?: TextAlign;
    textMarkdown?: boolean;
    textMono?: boolean;
    grouping?: boolean;
    negativeStyle?: NegativeStyle;
    scaleMode?: ScaleMode;
  }) {
    super("ValueInput");
    this.label = init?.label ?? "Value Input";
    this.op = init?.op && VALUE_INPUT_OPS.includes(init.op) ? init.op : "number";
    this.value = init?.value ?? (this.op === "date" ? todayText() : this.op === "logical" ? "FALSE" : this.op === "number" ? "0" : "");
    this.format = init?.format ?? "auto";
    this.customPattern = init?.customPattern ?? "0.00";
    this.decimalDigits = init?.decimalDigits ?? 2;
    this.decimalMode = init?.decimalMode ?? "places";
    this.unit = init?.unit ?? "none";
    this.customUnit = init?.customUnit ?? "";
    this.textCase = init?.textCase ?? "none";
    this.chip = init?.chip ?? false;
    this.logicalStyle = init?.logicalStyle ?? "truefalse";
    // The Format Controller's defaults, so a merged FC's picks read the same here.
    this.bold = init?.bold ?? false;
    this.italic = init?.italic ?? false;
    this.textScale = init?.textScale ?? 14;
    this.textAlign = init?.textAlign ?? "right";
    this.textMarkdown = init?.textMarkdown ?? false;
    this.textMono = init?.textMono ?? false;
    this.grouping = init?.grouping ?? true;
    this.negativeStyle = init?.negativeStyle ?? "minus";
    this.scaleMode = init?.scaleMode ?? "none";
    this.addOutput("value", new GraphOutput(valueSocketFor(this.op), "Value"));
  }

  /** Swaps the output socket in place; the caller follows with `retypeOutputCables`. A type never used this session gets the text carried by meaning. */
  setOp(t: ValueInputOp): boolean {
    if (t === this.op) return false;
    this.entryByOp[this.op] = this.value;
    this.value = this.entryByOp[t] ?? carryValueText(this.value, t);
    this.op = t;
    const out = this.outputs.value;
    if (out) out.socket = valueSocketFor(t);
    return true;
  }

  /** A pick outside the current type stays saved and sits inert, as on the Format Controller. */
  effectiveFormat(): FormatStyleId {
    if (this.op === "date") return isDateStyle(this.format) ? this.format : "date_dmy";
    return isDateStyle(this.format) ? "auto" : this.format;
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    if (outKey !== "value") return undefined;
    const numeric = this.op === "number";
    return {
      format: this.effectiveFormat(),
      customPattern: this.customPattern,
      decimalDigits: this.decimalDigits,
      decimalMode: this.decimalMode,
      unit: numeric ? this.unit : "none",
      customUnit: numeric ? this.customUnit : "",
      textCase: this.textCase,
      chip: this.chip,
      logicalStyle: this.logicalStyle,
      bold: this.bold,
      italic: this.italic,
      textScale: this.textScale,
      textAlign: this.textAlign,
      textMarkdown: this.textMarkdown,
      textMono: this.textMono,
      grouping: this.grouping,
      negativeStyle: this.negativeStyle,
      scaleMode: this.scaleMode,
    };
  }

  /** A date reads here, where a relative phrase alerts when it re-resolves to a new day; every other type is `body`. */
  data(): { value: unknown } {
    if (this.op !== "date") {
      this.lastRelative = null;
      return this.body();
    }
    const r = resolveDateText(this, this.value, this.lastRelative);
    this.lastRelative = r.last;
    this.cachedValue = r.result;
    return { value: this.cachedValue };
  }

  body(inputs: Record<string, unknown[] | undefined> = {}): { value: unknown } {
    return nodeOnCore(this, inputs) as { value: unknown };
  }
}

export class DateRangeNode extends GraphNode {
  label: string;
  literals: Record<string, number>;
  width  = 190;
  height = 150;

  constructor(init?: { label?: string }) {
    super("DateRange");
    this.label = init?.label ?? "Date Range";
    const today = Math.floor(jsDateToSerial(new Date()));
    this.literals = { start: today, end: today + 7 };
    this.addOutput("start", dateOut("Start"));
    this.addOutput("end",   dateOut("End"));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { start: number | null; end: number | null };
  }
}

export class XYPadNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    x: "Normalized 0 to 1.",
    y: "Normalized 0 to 1.",
  };
  label: string;
  literals: Record<string, number> = { fx: 0.5, fy: 0.5 };
  width  = 180;
  height = 230;

  constructor(init?: { label?: string; fx?: number; fy?: number }) {
    super("XYPad");
    this.label = init?.label ?? "XY Pad";
    if (typeof init?.fx === "number") this.literals.fx = init.fx;
    if (typeof init?.fy === "number") this.literals.fy = init.fy;
    this.addOutput("x", numOut("X"));
    this.addOutput("y", numOut("Y"));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { x: number; y: number };
  }
}

export class SlicerNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    result: "An empty selection passes every row through instead of none.",
  };
  label: string;
  selectedColumn: string = "";
  selectedValues: SlicerCell[] = [];
  multiSelect    = false;
  cachedColumns: string[] = [];
  cachedColumnType: FrameColType = "number";
  cachedUniqueValues: SlicerCell[] = [];
  _ref?: FrameRef | null;
  _gen?: number;
  cachedResult: FrameValue | SolError | null = null;
  width  = 240;
  height = 240;

  constructor(init?: { label?: string; selectedColumn?: string; selectedValues?: SlicerCell[]; multiSelect?: boolean }) {
    super("Slicer");
    this.label = init?.label ?? "Slicer";
    if (init?.selectedColumn != null) this.selectedColumn = init.selectedColumn;
    if (Array.isArray(init?.selectedValues)) this.selectedValues = init.selectedValues;
    if (typeof init?.multiSelect === "boolean") this.multiSelect = init.multiSelect;
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("result", frameOut("Filtered"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    return ctx.inputShape("frame");
  }

  private async emitResult(gen: number, out: FrameRef | FrameValue | SolError | null): Promise<{ result: FrameRef | FrameValue | SolError | null }> {
    const { frame } = await emitFrame(this, gen, out);
    return { result: frame };
  }

  /** A ref's schema is read first; the body names the column it reads, which is read next, and then it answers. A
   *  stale pass writes nothing, or a stale one flickers the buttons. */
  async data(inputs: Record<string, unknown[] | undefined>): Promise<{ result: FrameRef | FrameValue | SolError | null }> {
    const raw = inputs.frame?.[0] ?? null;
    const gen = beginPass(this);
    if (!isFrameRef(raw)) return this.emitResult(gen, this.body(inputs).result ?? null);
    const schema = await materialize(collectPreview(raw, 0));
    if (gen !== this._gen) return { result: null };
    let out = this.body({ ...inputs, schema: [schema] });
    if (out.read !== undefined) {
      const col = await materialize(readRefColumn(raw, out.read));
      if (gen !== this._gen) return { result: null };
      out = this.body({ ...inputs, schema: [schema], column: [col && !isSolError(col) ? { __frame: true, columns: [col] } : col] });
    }
    const result = out.result ?? null;
    return this.emitResult(gen, isFrameRef(result) ? relinked(result, [raw]) : result);
  }

  /** Over a ref: the column to read (`read`), or, given it (`column`), the answer. Over a value: the answer. */
  body(inputs: Record<string, unknown[] | undefined>): { result?: FrameRef | FrameValue | SolError | null; read?: string } {
    return nodeOnCore(this, inputs) as { result?: FrameRef | FrameValue | SolError | null; read?: string };
  }
}

export function parsePoints(text: string | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const line of (text ?? "").split("\n")) {
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

const trimNum = (v: number) => String(Number(v.toFixed(4)));

export function pointsToText(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${trimNum(x)}, ${trimNum(y)}`).join("\n");
}

export function pointsToFrame(pts: ReadonlyArray<readonly [number, number]>): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "X", type: "number", values: pts.map((p) => p[0]) },
      { name: "Y", type: "number", values: pts.map((p) => p[1]) },
    ],
  };
}

export class PointPlotterNode extends GraphNode {
  label: string;
  pointsText = "";
  cachedResult: FrameValue | null = null;
  literals: Record<string, number> = { xmin: 0, xmax: 10, ymin: 0, ymax: 10 };
  width = 240;
  height = 280;

  constructor(init?: { label?: string; pointsText?: string; xmin?: number; xmax?: number; ymin?: number; ymax?: number }) {
    super("PointPlotter");
    this.label = init?.label ?? "Point Plotter";
    if (typeof init?.pointsText === "string") this.pointsText = init.pointsText;
    for (const k of ["xmin", "xmax", "ymin", "ymax"] as const) {
      if (typeof init?.[k] === "number") this.literals[k] = init[k]!;
    }
    this.addOutput("result", frameOut("Points"));
  }

  frameShape(): Shape {
    return shapeOfFrameValue(pointsToFrame([]));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { result: FrameValue };
  }
}

export function monotoneCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 0) return () => NaN;
  if (n === 1) return () => ys[0];
  const h: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - xs[lo]) / h[lo];
    const t2 = t * t, t3 = t2 * t;
    return ys[lo] * (2 * t3 - 3 * t2 + 1) + h[lo] * m[lo] * (t3 - 2 * t2 + t)
      + ys[lo + 1] * (-2 * t3 + 3 * t2) + h[lo] * m[lo + 1] * (t3 - t2);
  };
}

export function curvePoints(text: string | undefined): Array<[number, number]> {
  const sorted = [...parsePoints(text)].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const p of sorted) {
    if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Kept pure so the component can render output rows without calling node.data(). */
export function sampleCurve(pointsText: string | undefined, xmin: number, xmax: number, samples: number): { values: number[]; xs: number[] } {
  const pts = curvePoints(pointsText);
  if (pts.length === 0) return { values: [], xs: [] };
  const n = clamp(Math.round(samples), 2, 1000);
  const f = monotoneCubic(pts.map((p) => p[0]), pts.map((p) => p[1]));
  const xs: number[] = [], values: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = xmin + ((xmax - xmin) * i) / (n - 1);
    xs.push(Number(x.toFixed(6)));
    const y = f(x);
    values.push(Number.isFinite(y) ? Number(y.toFixed(6)) : 0);
  }
  return { values, xs };
}

export function curveToFrame(xs: number[], values: number[]): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "X", type: "number", values: xs },
      { name: "Value", type: "number", values },
    ],
  };
}

export class CurveNode extends GraphNode {
  label: string;
  pointsText = "0, 0\n1, 1";
  cachedResult: FrameValue | null = null;
  literals: Record<string, number> = { xmin: 0, xmax: 1, ymin: 0, ymax: 1, samples: 32 };
  width = 240;
  height = 260;

  constructor(init?: { label?: string; pointsText?: string; xmin?: number; xmax?: number; ymin?: number; ymax?: number; samples?: number }) {
    super("Curve");
    this.label = init?.label ?? "Curve";
    if (typeof init?.pointsText === "string") this.pointsText = init.pointsText;
    for (const k of ["xmin", "xmax", "ymin", "ymax", "samples"] as const) {
      if (typeof init?.[k] === "number") this.literals[k] = init[k]!;
    }
    this.addOutput("result", frameOut("Curve"));
  }

  frameShape(): Shape {
    return shapeOfFrameValue(curveToFrame([], []));
  }

  /** The sample count is saved clamped, so it is written here before the body reads it. */
  data(inputs: Record<string, unknown[] | undefined> = {}) {
    this.literals.samples = clamp(Math.round(this.literals.samples ?? 32), 2, 1000);
    return nodeOnCore(this, inputs) as { result: FrameValue };
  }
}

export function parsePaintGrid(text: string | undefined, rows: number, cols: number): (number | null)[][] {
  const lines = (text ?? "").split("\n");
  const out: (number | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const cells = (lines[r] ?? "").split(",");
    const row: (number | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const t = (cells[c] ?? "").trim();
      const n = Number(t);
      row.push(t !== "" && Number.isFinite(n) ? n : null);
    }
    out.push(row);
  }
  return out;
}

export function paintGridToText(grid: ReadonlyArray<ReadonlyArray<number | null>>): string {
  return grid.map((row) => row.map((c) => (c == null ? "" : trimNum(c))).join(",")).join("\n");
}

export const gridPainterDim = (v: number): number => clamp(Math.round(v), 1, 64);

export class GridPainterNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    result: "Unpainted cells read as null, not zero.",
  };
  label: string;
  tableText = "";
  literals: Record<string, number> = { rows: 6, cols: 8, brush: 1 };
  width = 240;
  height = 260;

  constructor(init?: { label?: string; tableText?: string; rows?: number; cols?: number; brush?: number }) {
    super("GridPainter");
    this.label = init?.label ?? "Grid Painter";
    if (typeof init?.tableText === "string") this.tableText = init.tableText;
    for (const k of ["rows", "cols", "brush"] as const) {
      if (typeof init?.[k] === "number") this.literals[k] = init[k]!;
    }
    this.addOutput("result", tableOut("Matrix"));
  }

  /** The size is saved clamped, so it is written here before the body reads it. */
  data(inputs: Record<string, unknown[] | undefined> = {}) {
    this.literals.rows = gridPainterDim(this.literals.rows ?? 6);
    this.literals.cols = gridPainterDim(this.literals.cols ?? 8);
    return nodeOnCore(this, inputs) as { result: (number | null)[][] };
  }
}
