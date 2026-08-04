import { ClassicPreset } from "rete";
import Papa from "papaparse";
import { frameIn } from "./shared";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue } from "../frame";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import { isSolError, type SolError } from "../errorValue";
import { isDesktop, writeTextFilePath, pickSaveFilePath } from "../fileBridge";

// ─── File sink nodes (Write CSV / Write JSON) ───────────────────────────────────
// UNLIKE a source, a sink must NEVER act on its own. data() only caches the frame
// currently on the cable so the node can preview what WOULD be written; the actual
// write happens in `run()`, called ONLY from the node's Run button — never from
// data(), never on recompute.
//
// `enabled` is deliberately absent from copyPaste.ts's extractInit whitelist, so it
// can NEVER round-trip through save/load/paste: EVERY construction (fresh node,
// reloaded save, paste, restored placeholder) starts disarmed.

export type SinkStatus = "idle" | "writing" | "ok" | "error";

/** Render a frame's columns as CSV text (RFC 4180 via Papa Parse, the same
 *  engine csv.ts uses to read one back). CSV has no native types, so every
 *  cell formats exactly like any other frame display (formatFrameCell: dates
 *  as their display string, booleans as TRUE/FALSE, errors as their code); a
 *  missing cell writes empty. */
export function frameToCsvText(f: FrameValue): string {
  const rows = frameRowCount(f);
  const fields = f.columns.map((c) => c.name);
  const data = Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => formatFrameCell(c.type, c.values[i] ?? null) ?? ""),
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

abstract class WriteFileNodeBase extends ClassicPreset.Node {
  label: string;
  path: string;
  /** Never persisted (see file header) — always false on a fresh construction. */
  enabled = false;
  cachedFrame: FrameValue | SolError | null = null;
  status: SinkStatus = "idle";
  statusMessage = "";
  width = 260; height = 230;

  constructor(type: string, defaultLabel: string, init?: { label?: string; path?: string }) {
    super(type);
    this.label = init?.label ?? defaultLabel;
    this.path = init?.path ?? "";
    this.addInput("in", frameIn("Frame"));
  }

  // Caches only — never touches disk.
  data(inputs: { in?: (FrameValue | SolError)[] }): Record<string, never> {
    this.cachedFrame = inputs.in?.[0] ?? null;
    return {};
  }

  protected abstract serialize(f: FrameValue): string;
  protected abstract defaultExt(): string;

  /** Explicit write — call ONLY from the node's Run button. Desktop only (no
   *  filesystem in the browser build). Re-entrancy-guarded: a second Run while
   *  a write is in flight is a no-op (the component's disabled state is React
   *  state that only updates after the await, so it can't be the only gate —
   *  two rapid clicks would race concurrent writes to the same file). */
  async run(): Promise<void> {
    if (this.status === "writing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled; arm it first"; return; }
    if (!isDesktop()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const path = this.path.trim();
    if (path === "") { this.status = "error"; this.statusMessage = "Choose a file path"; return; }
    const f = this.cachedFrame;
    if (isSolError(f)) { this.status = "error"; this.statusMessage = f.code; return; }
    if (!f) { this.status = "error"; this.statusMessage = "Nothing to write; connect a frame"; return; }
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

export class WriteCsvNode extends WriteFileNodeBase {
  constructor(init?: { label?: string; path?: string }) { super("WriteCsv", "Write CSV", init); }
  protected serialize(f: FrameValue) { return frameToCsvText(f); }
  protected defaultExt() { return "csv"; }
}

export class WriteJsonNode extends WriteFileNodeBase {
  constructor(init?: { label?: string; path?: string }) { super("WriteJson", "Write JSON", init); }
  protected serialize(f: FrameValue) { return frameToJsonText(f); }
  protected defaultExt() { return "json"; }
}
