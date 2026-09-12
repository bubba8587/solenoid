import { ClassicPreset } from "rete";
import Papa from "papaparse";
import { neutralizeFormulaCell } from "../csvSafety";
import { frameIn, strIn } from "./shared";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue } from "../frame";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import { isSolError, type SolError } from "../errorValue";
import { isFrameRef, readFrame, collectPreview, type FrameInput } from "../frameBackend";
import { isDesktop, writeTextFilePath, pickSaveFilePath } from "../fileBridge";

// A sink must NEVER act on its own: data() only caches, and the write happens in
// `run()`, called only from the Run button. `enabled` is deliberately absent from
// copyPaste's extractInit whitelist, so EVERY construction starts disarmed.

export type SinkStatus = "idle" | "writing" | "ok" | "error";

/** A frame as CSV text (RFC 4180 via Papa Parse, the engine csv.ts reads back).
 *  CSV has no native types, so cells format as any other frame display. */
export function frameToCsvText(f: FrameValue): string {
  const rows = frameRowCount(f);
  const fields = f.columns.map((c) => c.name);
  // A file handed to someone else: a text cell a spreadsheet would evaluate is neutralized
  // (csvSafety, the same rule as the popup's export).
  const data = Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const shown = formatFrameCell(c.type, c.values[i] ?? null) ?? "";
      return c.type === "string" && typeof shown === "string" ? neutralizeFormulaCell(shown) : shown;
    }),
  );
  return Papa.unparse({ fields, data });
}

/** JSON has native number/boolean/null, so only a date and an error cell become
 *  display strings; everything else passes through as its own kind. */
function cellToJsonValue(type: FrameColType, v: FrameCell): unknown {
  if (v === null) return null;
  if (isSolError(v)) return v.code;
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) {
    return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  }
  return v;
}

/** Render a frame as an array of row records (column name → cell) — the same
 *  shape jsonToFrame's "array of records" branch reads back in. */
export function frameToJsonText(f: FrameValue): string {
  const rows = frameRowCount(f);
  const records = Array.from({ length: rows }, (_, i) => {
    const rec: Record<string, unknown> = {};
    for (const c of f.columns) rec[c.name] = cellToJsonValue(c.type, c.values[i] ?? null);
    return rec;
  });
  return JSON.stringify(records, null, 2);
}

/** csv/json/text is a serialization-FORMAT config, not the family's op selector: the card
 *  is one "write to a file" sink and the format is a parameter of it — so the component's
 *  toggle is a SegToggle (an argument) and the node stays a util accent. Text writes a
 *  wired string verbatim (e.g. Schedule's `mspdi` Project XML), so the `in` socket is
 *  string-typed in that mode and frame-typed otherwise. */
export type WriteFormat = "csv" | "json" | "text";

export class WriteFileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "A frame, written as CSV or JSON, or in Text mode the text as-is. Only Run writes; the node loads disarmed.",
  };
  label: string;
  path: string;
  format: WriteFormat;
  /** Never persisted (see file header) — always false on a fresh construction. */
  enabled = false;
  cachedFrame: FrameValue | SolError | null = null;
  /** The lazy upstream (a frame ref), or, in Text mode, the string to write. Read in
   *  full only inside run(). */
  private cachedInput: FrameInput | string | SolError | null = null;
  status: SinkStatus = "idle";
  statusMessage = "";
  width = 260; height = 230;

  constructor(init?: { label?: string; path?: string; format?: WriteFormat }) {
    super("WriteFile");
    this.label = init?.label ?? "Write File";
    this.path = init?.path ?? "";
    this.format = init?.format ?? "csv";
    this.addInput("in", this.format === "text" ? strIn("Text") : frameIn("Frame"));
  }

  /** Switch the serialization format. Text uses a STRING input; CSV/JSON a FRAME input, so
   *  crossing that boundary retypes the `in` socket. Returns true when it did, so a caller
   *  on a live graph prunes the departing cable first (onePrunePath). */
  setFormat(next: WriteFormat): boolean {
    if (next === this.format) return false;
    const retype = (this.format === "text") !== (next === "text");
    this.format = next;
    if (retype) {
      this.removeInput("in");
      this.addInput("in", next === "text" ? strIn("Text") : frameIn("Frame"));
    }
    return retype;
  }

  // Caches only — never touches disk.
  data(inputs: { in?: (FrameInput | string | SolError | null)[] }): Record<string, never> {
    const raw = inputs.in?.[0] ?? null;
    this.cachedInput = raw;
    // Text mode caches the string as-is; cachedFrame only carries an error for the readout.
    if (this.format === "text") { this.cachedFrame = isSolError(raw) ? raw : null; return {}; }
    if (!isFrameRef(raw)) { this.cachedFrame = raw as FrameValue | SolError | null; return {}; }
    return (async () => { this.cachedFrame = await collectPreview(raw); return {}; })() as unknown as Record<string, never>;
  }

  private serialize(f: FrameValue): string {
    return this.format === "json" ? frameToJsonText(f) : frameToCsvText(f);
  }
  private defaultExt(): string {
    return this.format === "json" ? "json" : this.format === "text" ? "txt" : "csv";
  }

  /** Explicit write — call ONLY from the Run button, desktop only. The
   *  re-entrancy guard is required: the component's disabled state updates only
   *  after the await, so two rapid clicks would race writes to the same file. */
  async run(): Promise<void> {
    if (this.status === "writing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (!isDesktop()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const path = this.path.trim();
    if (path === "") { this.status = "error"; this.statusMessage = "Choose a file path"; return; }
    if (isSolError(this.cachedInput)) { this.status = "error"; this.statusMessage = this.cachedInput.code; return; }

    // Text mode: write the wired string verbatim, the path's own extension honored
    // (so plan.xml writes XML). Frame modes serialize to CSV / JSON.
    if (this.format === "text") {
      const text = typeof this.cachedInput === "string" ? this.cachedInput : null;
      if (text == null) { this.status = "error"; this.statusMessage = "Nothing to write. Connect text."; return; }
      this.status = "writing";
      try {
        await writeTextFilePath(path, text);
        this.status = "ok";
        this.statusMessage = "written";
      } catch (e) {
        this.status = "error";
        this.statusMessage = e instanceof Error ? e.message : String(e);
      }
      return;
    }

    const src = this.cachedInput;
    const f = isFrameRef(src) ? await readFrame(src) : typeof src === "string" ? null : src;
    if (isSolError(f)) { this.status = "error"; this.statusMessage = f.code; return; }
    if (!f) { this.status = "error"; this.statusMessage = "Nothing to write. Connect a frame."; return; }
    this.status = "writing";
    try {
      await writeTextFilePath(path, this.serialize(f));
      const rows = frameRowCount(f);
      this.status = "ok";
      this.statusMessage = `${rows} row${rows === 1 ? "" : "s"} written`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  /** Open a Save dialog to CHOOSE a path (no write) — populates `path`. */
  async browse(): Promise<void> {
    const picked = await pickSaveFilePath(`${(this.label || "output").trim()}.${this.defaultExt()}`, [this.defaultExt()]);
    if (picked) this.path = picked;
  }
}
