import { ClassicPreset } from "rete";
import { frameOut, strListOut } from "./shared";
import { connectionStore, scheduleConnectionRecalc } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, readFileText } from "../fileBridge";
import { fetchText } from "../httpBridge";
import { frameFromCells, frameFromRecords, frameFromRows, frameFromColumnar, frameRowCount, type FrameValue } from "../frame";
import { parseCsvRows } from "../csv";
import { engineAvailable, ipcInvoke } from "../ipcBridge";
import { dropFrameRef, collectPreview, type FrameRef, type FrameHandle } from "../frameBackend";
import { solError, isSolError, type SolError } from "../errorValue";

// ─── External-data connection nodes ─────────────────────────────────────────────
// A connection node references outside data (a URL now; a folder-relative CSV
// next) and fetches a Frame on refresh — it never bakes the data into the project
// file. v1 frames are all-numeric, so non-numeric cells parse to NaN (shown as
// N/A) rather than dropping the column; text columns arrive with mixed-type frames.

// ─── Remote text → numeric Frame ────────────────────────────────────────────────

/** Parse CSV (first row = headers) into a Frame, inferring each column's type so
 *  text columns (names, categories) are kept as strings, not turned into NaN.
 *  Quote-aware + delimiter-detecting (see csv.ts). */
export function csvToFrame(text: string): FrameValue {
  const rows = parseCsvRows(text, { detectDelimiter: true });
  if (rows.length === 0) return { __frame: true, columns: [] };
  const headers = rows[0].map((h) => h.trim());
  return frameFromCells(headers, rows.slice(1));
}

/** Parse JSON into a Frame (type-inferring, so text survives). Accepts:
 *  - array of records  [{a:1,b:"x"}, …]      → keys are columns (ordered union)
 *  - array of arrays   [[1,2],[3,4]]          → positional columns (Col1, Col2…)
 *  - array of scalars  [1,2,3]                → a single column
 *  - columnar object   { a:[1,2], b:["x"] }   → keys are columns */
export function jsonToFrame(text: string): FrameValue {
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    if (data.length === 0) return { __frame: true, columns: [] };
    const first = data[0];
    if (Array.isArray(first)) return frameFromRows(data as unknown[][]);
    if (first !== null && typeof first === "object") return frameFromRecords(data as Record<string, unknown>[]);
    return frameFromRows((data as unknown[]).map((v) => [v]));
  }
  if (data !== null && typeof data === "object") {
    return frameFromColumnar(data as Record<string, unknown>);
  }
  throw new Error("Unsupported JSON shape");
}

/** Pick CSV vs JSON from the content-type, the URL extension, then the text. */
export function remoteTextToFrame(text: string, contentType: string, url: string): FrameValue {
  const looksJson =
    /json/i.test(contentType) ||
    /\.json(\?|$)/i.test(url) ||
    /^\s*[[{]/.test(text);
  return looksJson ? jsonToFrame(text) : csvToFrame(text);
}

// ─── WEB SOURCE ─────────────────────────────────────────────────────────────────

export class WebSourceNode extends ClassicPreset.Node {
  label: string;
  url: string;
  cachedResult: FrameValue | null = null;
  width = 260; height = 200;

  // Transient (never persisted): the last fetched cache key + the key whose
  // background fetch is currently in flight (a guard against starting it twice).
  private lastKey: string | undefined;
  private inflightKey: string | undefined;

  constructor(init?: { label?: string; url?: string }) {
    super("WebSource");
    this.label = init?.label ?? "Web Source";
    this.url = init?.url ?? "";
    this.addOutput("frame", frameOut("Frame"));
  }

  // SYNCHRONOUS by design: a source whose data() returns a Promise sits on the
  // engine's async critical path forever — every processGraph (e.g. each tick of
  // a slider drag) awaits it, the first one blocks on the network, and
  // engine.reset() cancels the in-flight fetch on every overlapping recompute.
  // Instead, serve the cached frame immediately (like an in-node table); the
  // first time a new key appears, fire ONE background fetch and recompute when it
  // lands. After that the data never changes, so this is a plain cache read.
  data(): { frame: FrameValue | null } {
    const ref = this.url.trim();
    const key = connectionStore.key(this.id, ref);
    if (key === this.lastKey) return { frame: this.cachedResult };
    if (this.inflightKey !== key) {
      this.inflightKey = key;
      // fetchFrame sets cachedResult + lastKey; the recompute then reads them.
      void this.fetchFrame(ref, key).then(() => scheduleConnectionRecalc());
    }
    return { frame: this.cachedResult }; // stale/null until the fetch resolves
  }

  private async fetchFrame(ref: string, key: string): Promise<{ frame: FrameValue | null }> {
    if (ref === "") {
      this.cachedResult = null;
      this.lastKey = key;
      connectionStore.setState(this.id, { status: "idle" });
      return { frame: null };
    }
    connectionStore.setState(this.id, { status: "loading" });
    try {
      // Native HTTP on desktop (no CORS); window.fetch in the browser, which
      // surfaces a CORS hint via fetchText when a cross-site request is blocked.
      const { text: body, contentType } = await fetchText(ref);
      const frame = remoteTextToFrame(body, contentType, ref);
      this.cachedResult = frame;
      this.lastKey = key;
      connectionStore.setState(this.id, {
        status: "ok",
        rows: frameRowCount(frame),
        cols: frame.columns.length,
        fetchedAt: Date.now(),
      });
      return { frame };
    } catch (e) {
      this.cachedResult = null;
      this.lastKey = key; // don't retry until gen/token/url changes (no network spam)
      const msg = e instanceof Error ? e.message : String(e);
      connectionStore.setState(this.id, { status: "error", message: msg });
      return { frame: null };
    }
  }
}

// ─── Shared fetch + status (IMPORT nodes) ───────────────────────────────────────
// Fetch a URL and parse it, pushing loading/ok/error to the connectionStore. The
// caller owns caching (lastKey / in-flight dedupe), like WebSource above.
async function fetchParsed<T>(
  nodeId: string,
  url: string,
  parse: (text: string, contentType: string) => T,
  size: (v: T) => { rows: number; cols: number },
): Promise<T | null> {
  if (url === "") { connectionStore.setState(nodeId, { status: "idle" }); return null; }
  connectionStore.setState(nodeId, { status: "loading" });
  try {
    const { text, contentType } = await fetchText(url);
    const v = parse(text, contentType);
    const { rows, cols } = size(v);
    connectionStore.setState(nodeId, { status: "ok", rows, cols, fetchedAt: Date.now() });
    return v;
  } catch (e) {
    connectionStore.setState(nodeId, { status: "error", message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Parse the Nth `<table>` on an HTML page into a Frame (type-inferred columns).
 *  The first row is treated as headers when it's a `<thead>` / all-`<th>` row. */
export function htmlTableToFrame(html: string, index1: number): FrameValue {
  if (typeof DOMParser === "undefined") throw new Error("HTML parsing needs a browser environment.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = doc.querySelectorAll("table");
  const idx = Math.max(1, Math.floor(index1 || 1)) - 1;
  const table = tables[idx] as HTMLTableElement | undefined;
  if (!table) throw new Error(`No table #${index1} on the page (found ${tables.length}).`);
  const rows = [...table.rows].map((tr) => [...tr.cells].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()));
  if (rows.length === 0) return { __frame: true, columns: [] };
  const firstIsHeader = table.tHead != null || [...table.rows[0].cells].every((c) => c.tagName === "TH");
  const headers = firstIsHeader ? rows[0] : [];
  const body = firstIsHeader ? rows.slice(1) : rows;
  return frameFromCells(headers, body);
}

/** Run an XPath query against a fetched page; returns each matched node's trimmed
 *  text (Sheets IMPORTXML-style, but a flat list for v1). */
export function xpathToList(html: string, query: string): string[] {
  if (typeof DOMParser === "undefined") throw new Error("XML parsing needs a browser environment.");
  const q = query.trim();
  if (q === "") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  // 7 = XPathResult.ORDERED_NODE_SNAPSHOT_TYPE (avoids referencing the global).
  const res = doc.evaluate(q, doc, null, 7, null);
  const out: string[] = [];
  for (let i = 0; i < res.snapshotLength; i++) {
    out.push((res.snapshotItem(i)?.textContent ?? "").replace(/\s+/g, " ").trim());
  }
  return out;
}

// ─── IMPORT HTML (Nth table on a page → Frame) ──────────────────────────────────

export class ImportHtmlNode extends ClassicPreset.Node {
  label: string;
  url: string;
  tableIndex: number; // 1-based which <table> on the page
  cachedResult: FrameValue | null = null;
  width = 260; height = 220;
  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameValue | null }> | undefined;

  constructor(init?: { label?: string; url?: string; tableIndex?: number }) {
    super("ImportHtml");
    this.label = init?.label ?? "Import HTML";
    this.url = init?.url ?? "";
    this.tableIndex = init?.tableIndex ?? 1;
    this.addOutput("frame", frameOut("Frame"));
  }

  async data(): Promise<{ frame: FrameValue | null }> {
    // The table index is part of the cache key so changing it re-parses.
    const key = connectionStore.key(this.id, `${this.url.trim()}#t=${this.tableIndex}`);
    if (key === this.lastKey) return { frame: this.cachedResult };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.run(this.url.trim(), key);
    }
    return this.inflight;
  }

  private async run(url: string, key: string): Promise<{ frame: FrameValue | null }> {
    const frame = await fetchParsed(this.id, url, (text) => htmlTableToFrame(text, this.tableIndex), (f) => ({
      rows: frameRowCount(f),
      cols: f.columns.length,
    }));
    this.cachedResult = frame;
    this.lastKey = key;
    return { frame };
  }
}

// ─── IMPORT XML (XPath on a page → text list) ───────────────────────────────────

export class ImportXmlNode extends ClassicPreset.Node {
  label: string;
  url: string;
  query: string; // XPath
  cachedResult: string[] | null = null;
  width = 260; height = 210;
  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ values: string[] | null }> | undefined;

  constructor(init?: { label?: string; url?: string; query?: string }) {
    super("ImportXml");
    this.label = init?.label ?? "Import XML";
    this.url = init?.url ?? "";
    this.query = init?.query ?? "";
    this.addOutput("values", strListOut("Values"));
  }

  async data(): Promise<{ values: string[] | null }> {
    const key = connectionStore.key(this.id, `${this.url.trim()}#q=${this.query}`);
    if (key === this.lastKey) return { values: this.cachedResult };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.run(this.url.trim(), key);
    }
    return this.inflight;
  }

  private async run(url: string, key: string): Promise<{ values: string[] | null }> {
    const values = await fetchParsed(this.id, url, (text) => xpathToList(text, this.query), (l) => ({
      rows: l.length,
      cols: 1,
    }));
    this.cachedResult = values;
    this.lastKey = key;
    return { values };
  }
}

// ─── CSV CONNECTION (local folder) ──────────────────────────────────────────────
// References a `.csv` by name inside the Settings target folder and reads it on
// refresh. Desktop only (the browser build has no filesystem). Shares the same
// cache / refresh layer as Web Source; the cache key folds in the folder + file
// name, so changing either (or pointing Settings at a new folder) re-reads.

export class CsvConnectionNode extends ClassicPreset.Node {
  label: string;
  /** File name relative to the Settings target folder (not a full path). */
  fileName: string;
  cachedResult: FrameValue | null = null;
  width = 260; height = 210;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameValue | null }> | undefined;

  constructor(init?: { label?: string; fileName?: string }) {
    super("CsvConnection");
    this.label = init?.label ?? "CSV File";
    this.fileName = init?.fileName ?? "";
    this.addOutput("frame", frameOut("Frame"));
  }

  async data(): Promise<{ frame: FrameValue | null }> {
    const folder = settingsStore.get("csvFolder");
    const name = this.fileName.trim();
    const key = connectionStore.key(this.id, `${folder} ${name}`);
    if (key === this.lastKey) return { frame: this.cachedResult };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.load(folder, name, key);
    }
    return this.inflight;
  }

  private async load(folder: string, name: string, key: string): Promise<{ frame: FrameValue | null }> {
    const fail = (message: string, status: "idle" | "error" = "error") => {
      this.cachedResult = null;
      this.lastKey = key;
      connectionStore.setState(this.id, { status, message });
      return { frame: null };
    };
    if (!isDesktop()) return fail("Desktop app only");
    if (folder === "") return fail("Set a target folder in Settings", "idle");
    if (name === "") return fail("Pick a file", "idle");
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const frame = csvToFrame(await readFileText(folder, name));
      this.cachedResult = frame;
      this.lastKey = key;
      connectionStore.setState(this.id, {
        status: "ok",
        rows: frameRowCount(frame),
        cols: frame.columns.length,
        fetchedAt: Date.now(),
      });
      return { frame };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}

// ─── PARQUET CONNECTION (local folder, native engine read) ──────────────────────
// Like CSV Connection, but the file goes straight from disk into the Rust engine
// (`engine_read_parquet`) — never parsed or type-inferred in JS (bundle 34's
// "native file → engine" ask). Desktop + native-engine only: unlike CSV/JSON
// there's no JS Parquet reader to fall back to. Emits a LAZY FrameRef off the
// fresh handle, so a verb chain built on a Parquet source never re-uploads
// through `engine_source` — the frame is already living in the backend the
// moment the file is read.

export class ParquetConnectionNode extends ClassicPreset.Node {
  label: string;
  /** File name relative to the Settings target folder (not a full path). */
  fileName: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 260; height = 210;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameRef | SolError | null }> | undefined;
  /** The handle backing `cachedResult`'s preview — owned by this node, dropped
   *  when a refresh/re-point replaces it (mirrors the verb nodes' `_ref`). */
  private ref: FrameRef | null = null;

  constructor(init?: { label?: string; fileName?: string }) {
    super("ParquetConnection");
    this.label = init?.label ?? "Parquet File";
    this.fileName = init?.fileName ?? "";
    this.addOutput("frame", frameOut("Frame"));
  }

  async data(): Promise<{ frame: FrameRef | SolError | null }> {
    const folder = settingsStore.get("csvFolder");
    const name = this.fileName.trim();
    const key = connectionStore.key(this.id, `${folder} ${name}`);
    if (key === this.lastKey) return { frame: this.ref ?? (this.cachedResult as SolError | null) };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.load(folder, name, key);
    }
    return this.inflight;
  }

  private async load(folder: string, name: string, key: string): Promise<{ frame: FrameRef | SolError | null }> {
    const fail = (message: string, status: "idle" | "error" = "error"): { frame: SolError | null } => {
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      const out = status === "idle" ? null : solError("#REF!", message);
      this.cachedResult = out;
      this.lastKey = key;
      connectionStore.setState(this.id, { status, message });
      return { frame: out };
    };
    if (!isDesktop() || !engineAvailable()) return fail("Desktop app (native engine) only");
    if (folder === "") return fail("Set a target folder in Settings", "idle");
    if (name === "") return fail("Pick a file", "idle");
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const handle = await ipcInvoke<string>("engine_read_parquet", { folder, name });
      if (this.ref) dropFrameRef(this.ref);
      const ref: FrameRef = { __frameRef: handle as FrameHandle };
      this.ref = ref;
      const preview = await collectPreview(ref);
      this.cachedResult = preview;
      this.lastKey = key;
      const rows = !preview || isSolError(preview) ? 0 : (preview.__totalRows ?? frameRowCount(preview));
      const cols = !preview || isSolError(preview) ? 0 : preview.columns.length;
      connectionStore.setState(this.id, { status: "ok", rows, cols, fetchedAt: Date.now() });
      return { frame: ref };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}
