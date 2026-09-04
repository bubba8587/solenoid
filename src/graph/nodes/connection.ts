import { ClassicPreset } from "rete";
import { frameOut, strListOut } from "./shared";
import { connectionStore, scheduleConnectionRecalc, requestNetwork } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, readFileText } from "../fileBridge";
import { fetchText } from "../httpBridge";
import { frameFromCells, frameFromRecords, frameFromRows, frameFromColumnar, frameRowCount, type FrameValue } from "../frame";
import { parseCsvRows } from "../csv";
import { engineAvailable, ipcInvoke } from "../ipcBridge";
import { readCsvFrame, dropFrameRef, collectPreview, type FrameRef, type FrameHandle } from "../frameBackend";
import { solError, isSolError, type SolError } from "../errorValue";

// ─── External-data connection nodes ─────────────────────────────────────────────
// A connection node holds only a reference and fetches a Frame on refresh — the data
// is never baked into the project file.

/** First row = headers; per-column type inference keeps text columns as strings
 *  rather than NaN. */
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
  static socketDocs: Record<string, string> = {
    frame: "Rows are never saved into the project file. Reopening the document fetches from the URL again.",
  };
  label: string;
  url: string;
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  cachedResult: FrameValue | null = null;
  width = 260; height = 200;

  // Transient (never persisted); inflightKey guards against starting a fetch twice.
  private lastKey: string | undefined;
  private inflightKey: string | undefined;

  constructor(init?: { label?: string; url?: string; refreshMinutes?: number }) {
    super("WebSource");
    this.label = init?.label ?? "Web Source";
    this.url = init?.url ?? "";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
  }

  // SYNCHRONOUS by design: an async data() would sit on the engine's critical path, so
  // every processGraph awaits the network and engine.reset() cancels the in-flight fetch.
  data(): { frame: FrameValue | null } {
    const ref = this.url.trim();
    const key = connectionStore.key(this.id, ref);
    if (key === this.lastKey) return { frame: this.cachedResult };
    // Per-document network gate (C2): a foreign, un-allowed document fetches nothing.
    if (ref !== "" && !requestNetwork(this.id)) return { frame: this.cachedResult };
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
      // Native HTTP on desktop (no CORS); the browser path surfaces a CORS hint.
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
// The CALLER owns caching (lastKey / in-flight dedupe), as WebSource does.
async function fetchParsed<T>(
  nodeId: string,
  url: string,
  parse: (text: string, contentType: string) => T,
  size: (v: T) => { rows: number; cols: number },
): Promise<T | null> {
  if (url === "") { connectionStore.setState(nodeId, { status: "idle" }); return null; }
  if (!requestNetwork(nodeId)) return null; // C2 gate: foreign doc not yet allowed
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

/** The first row becomes headers only when it's a `<thead>` / all-`<th>` row. */
export function htmlTableToFrame(html: string, index1: number): FrameValue {
  if (typeof DOMParser === "undefined") throw new Error("HTML parsing needs a browser environment.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = doc.querySelectorAll("table");
  const idx = Math.max(1, Math.floor(index1 || 1)) - 1;
  const table = tables[idx] as HTMLTableElement | undefined;
  if (!table) throw new Error(`No table #${index1} on the page; found ${tables.length}.`);
  const rows = [...table.rows].map((tr) => [...tr.cells].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()));
  if (rows.length === 0) return { __frame: true, columns: [] };
  const firstIsHeader = table.tHead != null || [...table.rows[0].cells].every((c) => c.tagName === "TH");
  const headers = firstIsHeader ? rows[0] : [];
  const body = firstIsHeader ? rows.slice(1) : rows;
  return frameFromCells(headers, body);
}

/** Each matched node's trimmed text, as a flat list. */
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
  static socketDocs: Record<string, string> = {
    frame: "The first row becomes headers only when the page marks it as a header row.",
  };
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
// Desktop only (no filesystem in the browser). The cache key folds in folder + file
// name, so re-pointing either re-reads.

export class LocalFileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "Reads the named file from the folder chosen in Settings. Rows are never saved into the project file.",
  };
  label: string;
  /** File name relative to the Settings target folder (not a full path). */
  fileName: string;
  /** Auto-refresh interval in minutes (0 = off) — see WebSourceNode. */
  refreshMinutes: number;
  /** CSV holds a materialized Frame; Parquet holds the preview (its lazy handle is `ref`). */
  cachedResult: FrameValue | SolError | null = null;
  width = 260; height = 210;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameValue | FrameRef | SolError | null }> | undefined;
  /** The Parquet handle backing `cachedResult`'s preview — owned by this node, dropped on
   *  a refresh/re-point (or a switch to CSV), mirroring the verb nodes' `_ref`. */
  private ref: FrameRef | null = null;

  constructor(init?: { label?: string; fileName?: string; refreshMinutes?: number }) {
    super("LocalFile");
    this.label = init?.label ?? "Local File";
    this.fileName = init?.fileName ?? "";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
  }

  private static isParquet(name: string): boolean {
    return name.toLowerCase().endsWith(".parquet");
  }

  async data(): Promise<{ frame: FrameValue | FrameRef | SolError | null }> {
    const folder = settingsStore.get("csvFolder");
    const name = this.fileName.trim();
    const key = connectionStore.key(this.id, `${folder}\u0000${name}`);
    if (key === this.lastKey) return { frame: this.ref ?? this.cachedResult };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.load(folder, name, key);
    }
    return this.inflight;
  }

  private async load(folder: string, name: string, key: string): Promise<{ frame: FrameValue | FrameRef | SolError | null }> {
    const parquet = LocalFileNode.isParquet(name);
    // Parquet errors flow as a #REF! value (downstream sees an error); CSV clears to null.
    const fail = (message: string, status: "idle" | "error" = "error") => {
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      const out = status === "error" && parquet ? solError("#REF!", message) : null;
      this.cachedResult = out;
      this.lastKey = key;
      connectionStore.setState(this.id, { status, message });
      return { frame: out };
    };
    if (parquet ? (!isDesktop() || !engineAvailable()) : !isDesktop()) {
      return fail(parquet ? "Desktop app (native engine) only" : "Desktop app only");
    }
    if (folder === "") return fail("Set a target folder in Settings", "idle");
    if (name === "") return fail("Pick a file", "idle");
    connectionStore.setState(this.id, { status: "loading" });
    try {
      if (parquet) {
        // The read never touches JS, so typed columns arrive intact (no inference step);
        // a LAZY FrameRef off the fresh handle keeps a verb chain from re-uploading.
        const handle = await ipcInvoke<string>("engine_read_parquet", { folder, name });
        if (this.ref) dropFrameRef(this.ref);
        const ref: FrameRef = { __frameRef: handle as FrameHandle, __plan: [] };
        this.ref = ref;
        const preview = await collectPreview(ref);
        this.cachedResult = preview;
        this.lastKey = key;
        const rows = !preview || isSolError(preview) ? 0 : (preview.__totalRows ?? frameRowCount(preview));
        const cols = !preview || isSolError(preview) ? 0 : preview.columns.length;
        connectionStore.setState(this.id, { status: "ok", rows, cols, fetchedAt: Date.now() });
        return { frame: ref };
      }
      // CSV: a Parquet handle from a previous file is stale now — drop it.
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      // Desktop parses in Rust so the file text never crosses IPC; web keeps the JS path.
      const frame = engineAvailable()
        ? await (async () => {
            const r = await readCsvFrame(folder, name);
            if (isSolError(r)) throw new Error(r.message);
            return r;
          })()
        : csvToFrame(await readFileText(folder, name));
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
