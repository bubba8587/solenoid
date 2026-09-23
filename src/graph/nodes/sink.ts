// [[C38]] sinkRunButtonOnly, [[C103]] untrustedContentSeams, [[E11]] controlDrivenRetype, [[D10]] onePrunePath, [[C26]] opArgDistinct, [[B2]] webTryDesktopFull
import { ClassicPreset } from "rete";
import Papa from "papaparse";
import { neutralizeFormulaCell } from "../csvSafety";
import { frameIn, strIn } from "./shared";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue } from "../frame";
import { formatDateSerial } from "./date";
import { isSolError, type SolError } from "../errorValue";
import { isFrameRef, readFrame, collectPreview, type FrameInput } from "../frameBackend";
import { isDesktop, writeTextFilePath, pickSaveFilePath } from "../fileBridge";

export type SinkStatus = "idle" | "writing" | "ok" | "error";

export function frameToCsvText(f: FrameValue): string {
  const rows = frameRowCount(f);
  const fields = f.columns.map((c) => neutralizeFormulaCell(c.name));
  const data = Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const shown = formatFrameCell(c.type, c.values[i] ?? null) ?? "";
      return c.type === "string" && typeof shown === "string" ? neutralizeFormulaCell(shown) : shown;
    }),
  );
  return Papa.unparse({ fields, data });
}

function cellToJsonValue(type: FrameColType, v: FrameCell): unknown {
  if (v === null) return null;
  if (isSolError(v)) return v.code;
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) {
    return formatDateSerial(v, Number.isInteger(v) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
  }
  return v;
}

export function frameToJsonText(f: FrameValue): string {
  const rows = frameRowCount(f);
  const records = Array.from({ length: rows }, (_, i) => {
    const rec: Record<string, unknown> = {};
    for (const c of f.columns) rec[c.name] = cellToJsonValue(c.type, c.values[i] ?? null);
    return rec;
  });
  return JSON.stringify(records, null, 2);
}

export type WriteFormat = "csv" | "json" | "text";

export class WriteFileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "A frame, written as CSV or JSON, or in Text mode the text as-is. Only Run writes; the node loads disarmed.",
  };
  label: string;
  path: string;
  format: WriteFormat;
  enabled = false;
  cachedFrame: FrameValue | SolError | null = null;
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

  data(inputs: { in?: (FrameInput | string | SolError | null)[] }): Record<string, never> {
    const raw = inputs.in?.[0] ?? null;
    this.cachedInput = raw;
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

  /** Keep the re-entrancy guard: the button disables only after the await, so two quick clicks would race. */
  async run(): Promise<void> {
    if (this.status === "writing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (!isDesktop()) { this.status = "error"; this.statusMessage = "Desktop app only"; return; }
    const path = this.path.trim();
    if (path === "") { this.status = "error"; this.statusMessage = "Choose a file path"; return; }
    if (isSolError(this.cachedInput)) { this.status = "error"; this.statusMessage = this.cachedInput.code; return; }

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

  async browse(): Promise<void> {
    const picked = await pickSaveFilePath(`${(this.label || "output").trim()}.${this.defaultExt()}`, [this.defaultExt()]);
    if (picked) this.path = picked;
  }
}
