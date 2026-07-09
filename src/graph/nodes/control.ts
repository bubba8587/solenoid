import { ClassicPreset } from "rete";
import { numberSocket, trueAnySocket, MutableSocket, type SocketDataType } from "../sockets";
import { frameIn, frameOut, dateOut, numOut } from "./shared";
import { isFrameValue, getColumn, frameRowCount, cubeFromColumns, type FrameValue, type FrameColType, type CubeCell } from "../frame";
import { jsDateToSerial } from "./date";

export type SlicerCell = number | string;

// ─── Cable Switch ───────────────────────────────────────────────────────────────
// A control multiplexer (not the logical SWITCH): several `any` cable inputs, each
// with an editable title so they read as NAMED choices. Two modes:
//   • single (default): a selector picks ONE live input; the output passes it through.
//   • multi: check several inputs; the output is a Cube collecting the chosen values
//     — a `name` column (the titles) + a `value` column (each wired value, whole).
// Reuses the ExtensibleInputs add/remove machinery (addValueInput / nextInputId) so
// the input set round-trips through copy/paste + persistence (valueKeys).

export class CableSwitchNode extends ClassicPreset.Node {
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
  readonly valueSocket = trueAnySocket;
  /** Output socket type flips with the mode: `cube` in Many (the collected values),
   *  `trueany` in One (the routed value passes through). Own MutableSocket instance
   *  so a retype never touches a shared singleton. */
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
    this.addInput(key, new ClassicPreset.Input(this.valueSocket));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.titles[key];
    this.selectedKeys = this.selectedKeys.filter((k) => k !== key);
  }

  /** A slot's display name: its title, else a 1-based positional fallback. */
  titleFor(key: string): string {
    const t = (this.titles[key] ?? "").trim();
    return t || `Input ${Object.keys(this.inputs).indexOf(key) + 1}`;
  }

  /** Keep the output socket type in sync with the mode (`cube` in Many, else `trueany`).
   *  Returns true if it changed, so the caller retypes any now-invalid downstream cables. */
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
    const idx = keys.length ? Math.max(0, Math.min(this.activeIndex, keys.length - 1)) : 0;
    const key = keys[idx];
    const v = key ? (inputs[key]?.[0] ?? null) : null;
    this.cachedValue = v ?? null;
    return { out: v ?? null };
  }
}

// ─── Angle Dial ───────────────────────────────────────────────────────────────

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

// ─── Date Picker ────────────────────────────────────────────────────────────
// A source control: a native date field whose chosen day is emitted as an Excel
// date serial. `value` is the serial (whitelisted in extractInit, so it persists
// and copy/pastes). 0 / blank → no date selected yet (outputs null).

export class DatePickerNode extends ClassicPreset.Node {
  label: string;
  value: number;   // Excel date serial; 0 = unset
  width  = 180;
  height = 110;

  constructor(init?: { label?: string; value?: number }) {
    super("DatePicker");
    this.label = init?.label ?? "Date Picker";
    this.value = init?.value ?? Math.floor(jsDateToSerial(new Date()));
    this.addOutput("result", dateOut("Date serial"));
  }

  data(): { result: number | null } {
    return { result: this.value > 0 ? this.value : null };
  }
}

// ─── Date Range ───────────────────────────────────────────────────────────────
// A dual-date control: pick a start and end date. Outputs both as Excel serials —
// duration is composable downstream (subtract with arithmetic), matching the XY
// Pad's "emit the raw values, scale downstream" philosophy. The two serials live
// in `literals` so they round-trip via the generic literals spread (no
// INIT_FIELD_ORDER edit).

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

// ─── XY Pad ─────────────────────────────────────────────────────────────────
// A source control: drag a handle inside a square to set two values at once.
// Outputs X and Y each in [0, 1] (fractions of the pad), the composable form —
// scale downstream with arithmetic. `fx`/`fy` live in `literals` so they
// round-trip through extractInit's literals spread.

export class XYPadNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { fx: 0.5, fy: 0.5 };
  width  = 180;
  height = 230;

  constructor(init?: { label?: string; fx?: number; fy?: number }) {
    super("XYPad");
    this.label = init?.label ?? "XY Pad";
    if (typeof init?.fx === "number") this.literals.fx = init.fx;
    if (typeof init?.fy === "number") this.literals.fy = init.fy;
    this.addOutput("x", numOut("X (0–1)"));
    this.addOutput("y", numOut("Y (0–1)"));
  }

  data(): { x: number; y: number } {
    return { x: this.literals.fx ?? 0.5, y: this.literals.fy ?? 0.5 };
  }
}

// ─── Slicer ───────────────────────────────────────────────────────────────────
// An Excel-style slicer over a Frame: pick a column, then click its unique values
// to keep only the rows that match. Outputs the filtered Frame. selectedValues
// empty = every row passes through. The active column + selection persist (see
// extractInit); the cached* fields are component-read only and don't persist.

export class SlicerNode extends ClassicPreset.Node {
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

    // Resolve the active column: the selected one if it still exists, else the
    // first column (so a fresh / re-wired slicer always shows something).
    const col = (this.selectedColumn ? getColumn(frame, this.selectedColumn) : null) ?? frame.columns[0];
    this.cachedColumnType = col.type;

    // Unique, non-blank values from that column, sorted (numeric or lexical).
    const uniq = [...new Set(col.values.filter((v): v is SlicerCell => v !== null && v !== ""))];
    uniq.sort((a, b) =>
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
    );
    this.cachedUniqueValues = uniq;

    // Filter rows: keep those whose active-column value is in the selection.
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
