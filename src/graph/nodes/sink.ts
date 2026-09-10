import { ClassicPreset } from "rete";
import Papa from "papaparse";
import { frameIn, documentIn } from "./shared";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue } from "../frame";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import { isSolError, type SolError } from "../errorValue";
import { isFrameRef, readFrame, collectPreview, type FrameInput } from "../frameBackend";
import { isDesktop, writeTextFilePath, pickSaveFilePath, pickFolderDialog, ensureDir, joinPath } from "../fileBridge";
import { isDocumentValue, type DocumentValue } from "../documentValue";
import { assembleDocumentMarkdown, frameToMarkdownTable, valueToObsidianBlock } from "../obsidianMarkdown";

/** A page name as a file name: no path separators or reserved characters. Local
 *  rather than imageAssets' sanitizeName, whose module pulls documentStore →
 *  persistence → nodeCatalog → rete-nodes into the node layer (an init cycle). */
function fileSafeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  return base.replace(/[<>:"|?*\x00-\x1f]/g, "").trim();
}

// A sink must NEVER act on its own: data() only caches, and the write happens in
// `run()`, called only from the Run button. `enabled` is deliberately absent from
// copyPaste's extractInit whitelist, so EVERY construction starts disarmed.

export type SinkStatus = "idle" | "writing" | "ok" | "error";

/** A frame as CSV text (RFC 4180 via Papa Parse, the engine csv.ts reads back).
 *  CSV has no native types, so cells format as any other frame display. */
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

/** csv/json/md is a serialization-FORMAT config, not the family's op selector: the
 *  card is one "write to a file" sink and the format is a parameter of it — so the
 *  component's toggle is a SegToggle (an argument) and the node stays a util accent.
 *  Markdown writes a wired document (a mail merge's pages as one `.md` each into the
 *  path as a FOLDER), or a frame as a pipe table. */
export type WriteFormat = "csv" | "json" | "md";

/** A ref's markdown outside a vault: native blocks as-is, a chart has no asset path
 *  here and drops. */
function refToMarkdown(_name: string, value: unknown): string {
  const b = valueToObsidianBlock(value);
  return b.kind === "md" ? b.md : "";
}

export class WriteFileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "Wiring a frame never writes the file. The write runs only from the Run button, and the node loads disarmed.",
    document: "A Note or Report to write as Markdown; a mail merge writes one file per page into the path as a folder.",
  };
  label: string;
  path: string;
  format: WriteFormat;
  /** Never persisted (see file header) — always false on a fresh construction. */
  enabled = false;
  cachedFrame: FrameValue | SolError | null = null;
  cachedDoc: DocumentValue | SolError | null = null;
  /** The lazy upstream, read in full only inside run(). */
  private cachedInput: FrameInput | SolError | null = null;
  status: SinkStatus = "idle";
  statusMessage = "";
  width = 260; height = 230;

  constructor(init?: { label?: string; path?: string; format?: WriteFormat }) {
    super("WriteFile");
    this.label = init?.label ?? "Write File";
    this.path = init?.path ?? "";
    this.format = init?.format === "json" || init?.format === "md" ? init.format : "csv";
    this.addInput("in", frameIn("Frame"));
    this.addInput("document", documentIn("Document"));
  }

  // Caches only — never touches disk.
  data(inputs: { in?: (FrameInput | SolError)[]; document?: (DocumentValue | SolError)[] }): Record<string, never> {
    this.cachedDoc = inputs.document?.[0] ?? null;
    const raw = inputs.in?.[0] ?? null;
    this.cachedInput = raw;
    if (!isFrameRef(raw)) { this.cachedFrame = raw; return {}; }
    return (async () => { this.cachedFrame = await collectPreview(raw); return {}; })() as unknown as Record<string, never>;
  }

  private serialize(f: FrameValue): string {
    return this.format === "json" ? frameToJsonText(f) : this.format === "md" ? frameToMarkdownTable(f) : frameToCsvText(f);
  }
  private defaultExt(): string {
    return this.format;
  }
  /** Markdown of a batch document goes to the path as a folder, one file per page. */
  private writesFolder(): boolean {
    return this.format === "md" && isDocumentValue(this.cachedDoc) && (this.cachedDoc.pages?.length ?? 0) > 0;
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
    // A wired document writes as Markdown whatever the format says; a frame follows it.
    const doc = this.cachedDoc;
    if (isSolError(doc)) { this.status = "error"; this.statusMessage = doc.code; return; }
    if (isDocumentValue(doc)) {
      this.status = "writing";
      try {
        if (doc.pages?.length) {
          await ensureDir(path);
          for (const page of doc.pages) {
            const md = await assembleDocumentMarkdown({ ...doc, body: page.body }, refToMarkdown);
            await writeTextFilePath(await joinPath(path, `${fileSafeName(page.name) || "page"}.md`), md);
          }
          this.status = "ok";
          this.statusMessage = `${doc.pages.length} file${doc.pages.length === 1 ? "" : "s"} written`;
        } else {
          await writeTextFilePath(path, await assembleDocumentMarkdown(doc, refToMarkdown));
          this.status = "ok";
          this.statusMessage = "Document written";
        }
      } catch (e) {
        this.status = "error";
        this.statusMessage = e instanceof Error ? e.message : String(e);
      }
      return;
    }
    const f = isFrameRef(this.cachedInput) ? await readFrame(this.cachedInput) : this.cachedInput;
    if (isSolError(f)) { this.status = "error"; this.statusMessage = f.code; return; }
    if (!f) { this.status = "error"; this.statusMessage = "Nothing to write. Connect a frame or a document."; return; }
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

  /** Open a Save dialog to CHOOSE a path (no write) — populates `path`; a batch of
   *  Markdown pages chooses a folder instead. */
  async browse(): Promise<void> {
    const picked = this.writesFolder()
      ? await pickFolderDialog()
      : await pickSaveFilePath(`${(this.label || "output").trim()}.${this.defaultExt()}`, [this.defaultExt()]);
    if (picked) this.path = picked;
  }
}
