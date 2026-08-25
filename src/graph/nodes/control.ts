import { ClassicPreset } from "rete";
import { numberSocket, AdoptiveSocket, MutableSocket, type SocketDataType } from "../sockets";
import { frameIn, frameOut, dateOut, numOut, tableOut } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { isFrameValue, getColumn, frameRowCount, cubeFromColumns, type FrameValue, type FrameColType, type CubeCell } from "../frame";
import { jsDateToSerial, parseDate, formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import { isRelativeDateText } from "./dateSerial";
import { settingsStore } from "../settingsStore";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";
import { isSolError, type SolError } from "../errorValue";
import { clamp } from "./mathUtils";
import { compareStrings } from "../stringOrder";

export type SlicerCell = number | string;

// Cable Switch — a control multiplexer, not the logical SWITCH. Reuses the
// ExtensibleInputs machinery so the input set round-trips through persistence (valueKeys).

export class CableSwitchNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    out: "One mode routes the active input through unchanged, keeping its type and unit. Many mode collects the checked inputs into a cube of name and value rows.",
  };
  label: string;
  /** Index (into the ordered inputs) of the live input. (Not `selected` — that's
   *  rete's node-selection flag.) */
  activeIndex: number;
  /** Per-input title (key → name), so a slot reads as a named choice. */
  titles: Record<string, string>;
  /** Collect several inputs into a Cube instead of routing one. */
  multiSelect: boolean;
  /** In multi mode, the checked input keys. */
  selectedKeys: string[];
  cachedValue: unknown = null;
  nextInputId = 0;
  /** Type flips with the mode: `cube` in Many, `trueany` in One. Its own MutableSocket
   *  instance, so a retype never touches a shared singleton. */
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
    this.addOutput("out", new ClassicPreset.Output(this.outSocket, "Out"));
    if (init?.valueKeys?.length) {
      for (const k of init.valueKeys) this.addInputWithKey(k);
    } else {
      for (let i = 0; i < 2; i++) this.addValueInput();
    }
  }

  private addInputWithKey(key: string): void {
    // Adoptive per-row socket: the slot shows the wired cable's type.
    this.addInput(key, new ClassicPreset.Input(new AdoptiveSocket()));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    // `activeIndex` is POSITIONAL, so dropping a slot ABOVE the live one shifts every
    // later slot up and would silently re-point the output at the next input down.
    // Follow the slot the user actually chose.
    const idx = Object.keys(this.inputs).indexOf(key);
    this.removeInput(key);
    delete this.titles[key];
    this.selectedKeys = this.selectedKeys.filter((k) => k !== key);
    if (idx >= 0 && idx < this.activeIndex) this.activeIndex -= 1;
    const n = Object.keys(this.inputs).length;
    // Removing the LIVE slot leaves the index on its neighbour; past the end, clamp.
    this.activeIndex = n ? clamp(this.activeIndex, 0, n - 1) : 0;
  }

  /** A slot's display name: its title, else a 1-based positional fallback. */
  titleFor(key: string): string {
    const t = (this.titles[key] ?? "").trim();
    return t || `Input ${Object.keys(this.inputs).indexOf(key) + 1}`;
  }

  /** One mode routes the ACTIVE input unchanged, so its type + unit ride through; Many
   *  collects a Cube and is NOT a passthrough (syncOutputType owns that output). */
  passthrough(): PassthroughSpec[] {
    if (this.multiSelect) return [];
    return [{ output: "out", inputs: Object.keys(this.inputs), combine: "active", activeIndex: () => this.activeIndex }];
  }

  /** Returns true if the type changed, so the caller retypes now-invalid downstream cables. */
  syncOutputType(): boolean {
    const want: SocketDataType = this.multiSelect ? "cube" : "trueany";
    if (this.outSocket.dataType === want) return false;
    this.outSocket.setType(want);
    return true;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const keys = Object.keys(this.inputs);
    if (this.multiSelect) {
      // Collect the checked inputs (in slot order) into a Cube: name + whole value.
      const chosen = keys.filter((k) => this.selectedKeys.includes(k));
      if (chosen.length === 0) { this.cachedValue = null; return { out: null }; }
      const cube = cubeFromColumns([
        { name: "name", cells: chosen.map((k) => this.titleFor(k)) },
        { name: "value", cells: chosen.map((k) => (inputs[k]?.[0] ?? null) as CubeCell) },
      ]);
      this.cachedValue = cube;
      return { out: cube };
    }
    const idx = keys.length ? clamp(this.activeIndex, 0, keys.length - 1) : 0;
    const key = keys[idx];
    const v = key ? (inputs[key]?.[0] ?? null) : null;
    this.cachedValue = v ?? null;
    return { out: v ?? null };
  }
}

export class AngleDialNode extends ClassicPreset.Node {
  label: string;
  value: number;   // degrees, 0–359
  step: number;    // snap increment
  width  = 160;
  height = 175;

  constructor(init?: { label?: string; value?: number; step?: number }) {
    super("AngleDial");
    this.label = init?.label ?? "Angle Dial";
    this.value = init?.value ?? 0;
    this.step  = init?.step  ?? 15;
    this.addOutput("value", new ClassicPreset.Output(numberSocket, "Degrees"));
  }

  data() {
    return { value: this.value };
  }
}

// `value` is an Excel date serial (whitelisted in extractInit); 0 = no date selected yet.

export class DateInputNode extends ClassicPreset.Node {
  label: string;
  // The raw source text is the truth (the Frame/Table date model): the card renders the
  // coerced DD-MMM-YYYY but keeps exactly what was typed for editing, and never discards an
  // unparseable entry. Round-trips via the generic stringLiterals spread.
  stringLiterals: Record<string, string>;
  width  = 180;
  height = 110;

  constructor(init?: { label?: string; date?: string }) {
    super("DateInput");
    this.label = init?.label ?? "Date Input";
    this.stringLiterals = {
      date: init?.date ?? formatDateSerial(Math.floor(jsDateToSerial(new Date())), DEFAULT_DATE_FORMAT),
    };
    this.addOutput("result", dateOut("Date serial"));
  }

  /** The last day a RELATIVE phrase resolved to — the edge for the "it moved" Alert. Not persisted. */
  private lastRelativeSerial: number | null = null;

  /** A relative phrase (today / next friday / in 3 days) is honoured only under the
   *  Settings ▸ Data ▸ Relative dates opt-in — else it's unparseable like before. */
  static relativeAllowed(): boolean { return settingsStore.get("relativeDates"); }

  data(): { result: number | SolError | null } {
    const text = (this.stringLiterals.date ?? "").trim();
    const relative = isRelativeDateText(text) && DateInputNode.relativeAllowed();
    // #AMBIGUOUS! surfaces downstream; unparseable text is a blank, a valid date its serial.
    const r = parseDate(text, relative ? { relative: true } : undefined);
    if (isSolError(r)) return { result: r };
    const serial = Number.isFinite(r) ? Math.floor(r) : null;
    if (relative && serial !== null) {
      // Re-resolved on every pass (the value depends on "now"); when the DAY it lands on
      // changes between calculations, say so — a moved date silently shifting a model is
      // exactly what the opt-in warns about. Edge-detected on the resolved serial.
      if (this.lastRelativeSerial !== null && this.lastRelativeSerial !== serial && !isGraphRebuilding()) {
        const name = (this.label ?? "").trim() || "Date Input";
        fireAlert({
          nodeId: this.id, label: name, kind: "warning",
          message: `${name}: "${text}" now resolves to ${formatDateSerial(serial, DEFAULT_DATE_FORMAT)} (was ${formatDateSerial(this.lastRelativeSerial, DEFAULT_DATE_FORMAT)})`,
        });
      }
      this.lastRelativeSerial = serial;
    } else {
      this.lastRelativeSerial = null;
    }
    return { result: serial };
  }
}

// Both dates are raw Excel serials living in `literals`, so they round-trip via the
// generic literals spread (no INIT_FIELD_ORDER edit).

export class DateRangeNode extends ClassicPreset.Node {
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

  data(): { start: number | null; end: number | null } {
    const start = this.literals.start ?? 0;
    const end = this.literals.end ?? 0;
    return { start: start > 0 ? start : null, end: end > 0 ? end : null };
  }
}

// X and Y are each in [0, 1] (fractions of the pad); `fx`/`fy` live in `literals` so
// they round-trip through extractInit's spread.

export class XYPadNode extends ClassicPreset.Node {
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

  data(): { x: number; y: number } {
    return { x: this.literals.fx ?? 0.5, y: this.literals.fy ?? 0.5 };
  }
}

// `selectedValues` empty = every row passes through.

export class SlicerNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "An empty selection passes every row through instead of none.",
  };
  label: string;
  selectedColumn: string = "";          // "" → first column (auto)
  selectedValues: SlicerCell[] = [];    // empty → all rows pass
  multiSelect    = false;
  // Populated by data() for the component; not persisted.
  cachedColumns: string[] = [];
  cachedColumnType: FrameColType = "number";
  cachedUniqueValues: SlicerCell[] = [];
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

  data(inputs: { frame?: unknown[] }) {
    const raw = inputs.frame?.[0];
    const frame: FrameValue | null = isFrameValue(raw) ? raw : null;
    this.cachedColumns = frame ? frame.columns.map((c) => c.name) : [];

    if (!frame || frame.columns.length === 0) {
      this.cachedUniqueValues = [];
      return { result: frame };
    }

    const col = (this.selectedColumn ? getColumn(frame, this.selectedColumn) : null) ?? frame.columns[0];
    this.cachedColumnType = col.type;

    const uniq = [...new Set(col.values.filter((v): v is SlicerCell => v !== null && v !== ""))];
    uniq.sort((a, b) =>
      typeof a === "number" && typeof b === "number" ? a - b : compareStrings(String(a), String(b)),
    );
    this.cachedUniqueValues = uniq;

    if (this.selectedValues.length === 0) return { result: frame };
    const sel = new Set<SlicerCell>(this.selectedValues);
    const rows = frameRowCount(frame);
    const keep: number[] = [];
    for (let i = 0; i < rows; i++) {
      const v = col.values[i];
      if (v !== null && v !== undefined && sel.has(v as SlicerCell)) keep.push(i);
    }
    const filtered: FrameValue = {
      __frame: true,
      columns: frame.columns.map((c) => ({
        ...c,
        values: keep.map((i) => c.values[i] ?? null),
        raw: c.raw ? keep.map((i) => c.raw![i] ?? "") : undefined, // keep the source for surviving rows
      })),
    };
    return { result: filtered };
  }
}

// Points persist as TEXT ("x, y" per line): the string is the stored truth, arrays
// derive. Trimmed to 4 decimals so a drag doesn't bake float dust into the save.

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

/** The plotted points as a two-column frame (X, Y) — the correlated-output form (C5:
 *  index-aligned lists leave a node as ONE frame, never parallel list sockets). */
export function pointsToFrame(pts: ReadonlyArray<readonly [number, number]>): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "X", type: "number", values: pts.map((p) => p[0]) },
      { name: "Y", type: "number", values: pts.map((p) => p[1]) },
    ],
  };
}

export class PointPlotterNode extends ClassicPreset.Node {
  label: string;
  pointsText = "";
  cachedResult: FrameValue | null = null;
  /** Axis ranges for the pad's coordinate frame. */
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

  data(): { result: FrameValue } {
    const frame = pointsToFrame(parsePoints(this.pointsText));
    this.cachedResult = frame;
    return { result: frame };
  }
}

/** Monotone cubic interpolator through (xs, ys) — xs strictly increasing, n ≥ 1.
 *  Flat beyond the endpoints. Fritsch–Carlson tangent limiting: the curve never
 *  overshoots between two points, so it behaves like a drawn envelope. */
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

/** Control points sorted by x with exact-duplicate x's collapsed (last wins) —
 *  the spline needs strictly increasing x. */
export function curvePoints(text: string | undefined): Array<[number, number]> {
  const sorted = [...parsePoints(text)].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const p of sorted) {
    if (out.length && out[out.length - 1][0] === p[0]) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Pure, so the component can render output rows without calling node.data() — the
 *  coerceInputs wrapper expects an inputs record and throws on undefined. */
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

/** The sampled curve as a two-column frame — X (the axis) FIRST, then Value (C5:
 *  index-aligned outputs leave as one frame). */
export function curveToFrame(xs: number[], values: number[]): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "X", type: "number", values: xs },
      { name: "Value", type: "number", values },
    ],
  };
}

export class CurveNode extends ClassicPreset.Node {
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

  data(): { result: FrameValue } {
    this.literals.samples = clamp(Math.round(this.literals.samples ?? 32), 2, 1000);
    const { values, xs } = sampleCurve(this.pointsText, this.literals.xmin ?? 0, this.literals.xmax ?? 1, this.literals.samples);
    const frame = curveToFrame(xs, values);
    this.cachedResult = frame;
    return { result: frame };
  }
}

// The grid persists as CSV text (tableText, like Table Input): blank cell = null.

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

export class GridPainterNode extends ClassicPreset.Node {
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

  data(): { result: (number | null)[][] } {
    const rows = clamp(Math.round(this.literals.rows ?? 6), 1, 64);
    const cols = clamp(Math.round(this.literals.cols ?? 8), 1, 64);
    this.literals.rows = rows;
    this.literals.cols = cols;
    return { result: parsePaintGrid(this.tableText, rows, cols) };
  }
}
