import { ClassicPreset } from "rete";
import { frameOut, strListOut, strIn, numIn, numOut, strOut, dateOut, dateListOut, cubeOut, readInput } from "./shared";
import { geocodeUrl, parseGeocode, pickGeocodeMatch, type GeocodeMatch } from "../geocodeProvider";
import { weatherUrl, parseWeather, type TempUnit, type WeatherResult } from "../weatherProvider";
import { holidaysUrl, parseHolidays, filterHolidays, holidaysFrame, daysToNextHoliday, type Holiday } from "../holidaysProvider";
import { fxLatestUrl, parseFxRate, type FxRate } from "../fxProvider";
import { notesToCube, type VaultNote, type VaultTypeSources } from "../vaultCube";
import { parseMdbaseCollection, mdbaseTypeFor, type MdbaseCollection } from "../mdbaseTypes";
import { parseObsidianTypes } from "../obsidianTypes";
import { parseDailyNotesConfig } from "../dailyNotesConfig";
import { type TypeMap } from "../vaultTypes";
import { applyFcUnit } from "../unitBridge";
import { type Shape } from "../frameShape";
import { connectionStore, scheduleConnectionRecalc, requestNetwork, trackInflight } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, hasFs, readFileText, joinPath, listVaultMarkdownFiles, listMarkdownFiles, readVaultFile, statVaultFile } from "../fileBridge";
import { fetchText } from "../httpBridge";
import { frameFromCells, frameFromRecords, frameFromRows, frameFromColumnar, frameRowCount, cubeRowCount, type FrameValue, type CubeValue } from "../frame";
import { parseCsvRows } from "../csv";
import { engineAvailable, ipcInvoke } from "../ipcBridge";
import { readCsvFrame, dropFrameRef, collectPreview, type FrameRef, type FrameHandle } from "../frameBackend";
import { solError, isSolError, type SolError } from "../errorValue";
import { planFileToPlan, csvPlanToCube } from "../planImport";

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
    plan: "The file as a project plan: Project XML, GanttProject, Primavera XER, or a CSV whose Predecessors use row numbers such as 3FS+2d. Tasks nest as the outline. Empty for any other file.",
  };
  label: string;
  /** File name relative to the Settings target folder (not a full path). */
  fileName: string;
  /** The plan cube beside the frame when the file is a project plan (MSPDI or a grammar CSV). */
  cachedPlan: CubeValue | null = null;
  /** What the plan reader saw but could not model (MSPDI), for the status line. */
  planNotes: string[] = [];
  /** Auto-refresh interval in minutes (0 = off) — see WebSourceNode. */
  refreshMinutes: number;
  /** CSV holds a materialized Frame; Parquet holds the preview (its lazy handle is `ref`). */
  cachedResult: FrameValue | SolError | null = null;
  width = 260; height = 210;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameValue | FrameRef | SolError | null; plan: CubeValue | null }> | undefined;
  /** The Parquet handle backing `cachedResult`'s preview — owned by this node, dropped on
   *  a refresh/re-point (or a switch to CSV), mirroring the verb nodes' `_ref`. */
  private ref: FrameRef | null = null;

  constructor(init?: { label?: string; fileName?: string; refreshMinutes?: number }) {
    super("LocalFile");
    this.label = init?.label ?? "Local File";
    this.fileName = init?.fileName ?? "";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
    this.addOutput("plan", cubeOut("Plan"));
  }

  private static isParquet(name: string): boolean {
    return name.toLowerCase().endsWith(".parquet");
  }

  /** A plan file by extension: Project XML, GanttProject, Primavera. */
  private static isPlanFile(name: string): boolean {
    return /\.(xml|gan|xer)$/i.test(name);
  }

  async data(): Promise<{ frame: FrameValue | FrameRef | SolError | null; plan: CubeValue | null }> {
    const folder = settingsStore.get("csvFolder");
    const name = this.fileName.trim();
    const key = connectionStore.key(this.id, `${folder}\u0000${name}`);
    if (key === this.lastKey) return { frame: this.ref ?? this.cachedResult, plan: this.cachedPlan };
    if (this.inflightKey !== key || !this.inflight) {
      this.inflightKey = key;
      this.inflight = this.load(folder, name, key);
    }
    return this.inflight;
  }

  private async load(folder: string, name: string, key: string): Promise<{ frame: FrameValue | FrameRef | SolError | null; plan: CubeValue | null }> {
    const parquet = LocalFileNode.isParquet(name);
    this.cachedPlan = null;
    this.planNotes = [];
    // Parquet errors flow as a #REF! value (downstream sees an error); CSV clears to null.
    const fail = (message: string, status: "idle" | "error" = "error") => {
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      const out = status === "error" && parquet ? solError("#REF!", message) : null;
      this.cachedResult = out;
      this.lastKey = key;
      connectionStore.setState(this.id, { status, message });
      return { frame: out, plan: null };
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
        return { frame: ref, plan: null };
      }
      // A Parquet handle from a previous file is stale now — drop it.
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      if (LocalFileNode.isPlanFile(name)) {
        // A plan file: the plan cube, with the flat outline beside it on the frame socket.
        const text = await readFileText(folder, name);
        const plan = planFileToPlan(text);
        if (!plan) throw new Error("Not a Project XML, GanttProject or Primavera file");
        this.cachedResult = plan.frame;
        this.cachedPlan = plan.cube;
        this.planNotes = plan.unsupported;
        this.lastKey = key;
        connectionStore.setState(this.id, {
          status: "ok", rows: frameRowCount(plan.frame), cols: plan.frame.columns.length, fetchedAt: Date.now(),
          ...(plan.unsupported.length ? { message: `Not carried over: ${plan.unsupported.join("; ")}` } : {}),
        });
        return { frame: plan.frame, plan: plan.cube };
      }
      // Desktop parses in Rust so the file text never crosses IPC; web keeps the JS path.
      const frame = engineAvailable()
        ? await (async () => {
            const r = await readCsvFrame(folder, name);
            if (isSolError(r)) throw new Error(r.message);
            return r;
          })()
        : csvToFrame(await readFileText(folder, name));
      this.cachedResult = frame;
      // A Smartsheet / Project CSV (row-number predecessors) is also a plan.
      this.cachedPlan = csvPlanToCube(frame);
      this.lastKey = key;
      connectionStore.setState(this.id, {
        status: "ok",
        rows: frameRowCount(frame),
        cols: frame.columns.length,
        fetchedAt: Date.now(),
      });
      return { frame, plan: this.cachedPlan };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}

// ─── GEOCODE (place name → lat / lon / timezone) ────────────────────────────────
// Open-Meteo geocoding, keyless + CORS-open. The enabler node: feeds Weather and any
// node that today wants hand-typed coordinates. Sync data() + one background fetch per
// place (the WebSource pattern); ambiguity is a per-node label pick, default top match.
export class GeocodeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    place: "A place name, for example Boise or Paris.",
    timezone: "The IANA time zone name, for example America/Boise.",
  };
  label: string;
  stringLiterals: Record<string, string> = {};
  /** The chosen match's label (ambiguity pick); "" = the top match. */
  pickedLabel = "";
  width = 240; height = 230;
  // Transient: the last fetch's matches (for the card's pick list) + the fetch cache guard.
  matches: GeocodeMatch[] = [];
  private _lastFetchKey: string | undefined;

  constructor(init?: { label?: string; pickedLabel?: string }) {
    super("Geocode");
    this.label = init?.label ?? "Geocode";
    this.pickedLabel = init?.pickedLabel ?? "";
    this.addInput("place", strIn("Place"));
    this.addOutput("lat", numOut("Lat"));
    this.addOutput("lon", numOut("Lon"));
    this.addOutput("timezone", strOut("Time zone"));
    this.addOutput("label", strOut("Place"));
  }

  data(inputs: { place?: string[] }): { lat: number | null; lon: number | null; timezone: string | null; label: string | null } {
    const raw = readInput(inputs.place, this.stringLiterals.place ?? "");
    const place = typeof raw === "string" ? raw.trim() : "";
    const key = connectionStore.key(this.id, place);
    if (key !== this._lastFetchKey) {
      if (place === "") {
        this._lastFetchKey = key;
        this.matches = [];
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        // Only commit the key once the fetch is actually launched, so a gated pass re-asks.
        this._lastFetchKey = key;
        void this.fetchMatches(place).then(() => scheduleConnectionRecalc());
      }
    }
    // The pick is applied per compute (cheap, from the cached matches) so changing it
    // re-selects without a re-fetch.
    const m = pickGeocodeMatch(this.matches, this.pickedLabel);
    return { lat: m?.lat ?? null, lon: m?.lon ?? null, timezone: m?.timezone ?? null, label: m?.label ?? null };
  }

  private async fetchMatches(place: string): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(geocodeUrl(place));
      this.matches = parseGeocode(text);
      connectionStore.setState(this.id, this.matches.length === 0
        ? { status: "error", message: "No match" }
        : { status: "ok", rows: this.matches.length, cols: 1, fetchedAt: Date.now() });
    } catch (e) {
      this.matches = [];
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── WEATHER (Open-Meteo forecast: a Daily frame + Now scalars) ─────────────────
// The anchor widget. One call returns past_days + a 16-day forecast. Lat/lon come from
// Geocode (or typed literals). The °C/°F toggle sets the API unit AND tags the temps
// with that unit so it flows downstream like Convert (firstClassUnits). Reuses the
// WebSource sync-background fetch pattern, so it rides the C2 network gate.
export class WeatherNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    lat: "Latitude.",
    lon: "Longitude.",
    daily: "One row per day: date, rain mm, rain %, high, low, ET₀, condition. Past and future in one frame; split with a Frame Filter against TODAY.",
    temp: "The current temperature, carrying its °C/°F unit downstream.",
  };
  label: string;
  literals: Record<string, number> = { lat: 0, lon: 0 };
  unit: TempUnit;
  pastDays: number;
  forecastDays: number;
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  width = 240; height = 280;
  /** Read by the component's output rows; never persisted. */
  cached: WeatherResult | null = null;
  private _lastKey: string | undefined;

  constructor(init?: { label?: string; unit?: TempUnit; pastDays?: number; forecastDays?: number; refreshMinutes?: number }) {
    super("Weather");
    this.label = init?.label ?? "Weather";
    this.unit = init?.unit === "F" ? "F" : "C";
    this.pastDays = init?.pastDays ?? 0;
    this.forecastDays = init?.forecastDays ?? 7;
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addInput("lat", numIn("Lat"));
    this.addInput("lon", numIn("Lon"));
    this.addOutput("daily", frameOut("Daily"));
    this.addOutput("temp", numOut("Now"));
    this.addOutput("condition", strOut("Condition"));
  }

  // The daily frame's columns are FIXED (declareOnce), so downstream pickers know them
  // before any fetch lands.
  frameShape(): Shape {
    return { columns: [
      { name: "Date", type: "date" }, { name: "Rain mm", type: "number" }, { name: "Rain %", type: "number" },
      { name: "High", type: "number" }, { name: "Low", type: "number" }, { name: "ET₀ mm", type: "number" },
      { name: "Condition", type: "string" },
    ] };
  }

  data(inputs: { lat?: number[]; lon?: number[] }): { daily: FrameValue; temp: unknown; condition: string | null } {
    const lat = readInput(inputs.lat, this.literals.lat);
    const lon = readInput(inputs.lon, this.literals.lon);
    const have = typeof lat === "number" && typeof lon === "number";
    const key = connectionStore.key(this.id, have ? `${lat},${lon},${this.unit},${this.pastDays},${this.forecastDays}` : "");
    if (key !== this._lastKey) {
      if (!have) {
        this._lastKey = key;
        this.cached = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        this._lastKey = key;
        void this.fetchWeather(lat, lon).then(() => scheduleConnectionRecalc());
      }
    }
    const c = this.cached;
    const fcUnit = this.unit === "F" ? "degF" : "degC";
    return {
      daily: c?.daily ?? { __frame: true, columns: [] },
      temp: c?.nowTemp != null ? applyFcUnit(c.nowTemp, fcUnit) : null,
      condition: c?.nowCondition ?? null,
    };
  }

  private async fetchWeather(lat: number, lon: number): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(weatherUrl(lat, lon, this.unit, this.pastDays, this.forecastDays));
      this.cached = parseWeather(text, this.unit);
      connectionStore.setState(this.id, { status: "ok", rows: frameRowCount(this.cached.daily), cols: this.cached.daily.columns.length, fetchedAt: Date.now() });
    } catch (e) {
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── HOLIDAYS (Nager.Date: a year's public holidays as a frame + a date list) ────
// A country + year → the year's public holidays. Nager.Date is keyless + CORS-open.
// The Dates list feeds NETWORKDAYS / WORKDAY straight; the frame reads on a Report;
// "days to next" drives a dashboard. An optional region keeps only the days that apply
// in a subdivision. Reuses the WebSource sync-background fetch, so it rides the C2 gate.
export class HolidaysNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "One row per holiday: date, English name, local name.",
    dates: "Every holiday's date. Skipped by NETWORKDAYS and WORKDAY.",
    next: "Whole days until the next holiday, counting from today.",
  };
  label: string;
  /** ISO 3166-1 alpha-2 country code (for example US, GB). */
  country: string;
  /** Optional subdivision code (for example US-CA); blank = the whole country. */
  region: string;
  /** The calendar year; 0 = the current year. */
  year: number;
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  width = 240; height = 250;
  /** Read by the component's output rows; never persisted. */
  cached: Holiday[] | null = null;
  private _lastKey: string | undefined;

  constructor(init?: { label?: string; country?: string; region?: string; year?: number; refreshMinutes?: number }) {
    super("Holidays");
    this.label = init?.label ?? "Holidays";
    this.country = init?.country ?? "";
    this.region = init?.region ?? "";
    this.year = init?.year ?? 0;
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Holidays"));
    this.addOutput("dates", dateListOut("Dates"));
    this.addOutput("next", numOut("Days to next"));
  }

  // The frame's columns are FIXED (declareOnce), so downstream pickers know them
  // before any fetch lands.
  frameShape(): Shape {
    return { columns: [
      { name: "Date", type: "date" }, { name: "Name", type: "string" }, { name: "Local", type: "string" },
    ] };
  }

  /** Today as a UTC-midnight Excel serial, matching the date column's convention. */
  private static todaySerial(): number {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }

  data(): { frame: FrameValue; dates: number[]; next: number | null } {
    const country = this.country.trim();
    const year = this.year || new Date().getUTCFullYear();
    const key = connectionStore.key(this.id, country ? `${country},${year}` : "");
    if (key !== this._lastKey) {
      if (country === "") {
        this._lastKey = key;
        this.cached = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        this._lastKey = key;
        void this.fetchHolidays(year, country).then(() => scheduleConnectionRecalc());
      }
    }
    // Region is applied per compute (cheap, from the cache) so changing it re-selects
    // without a re-fetch, mirroring Geocode's pick.
    const applicable = filterHolidays(this.cached ?? [], this.region);
    return {
      frame: holidaysFrame(applicable),
      dates: applicable.map((h) => h.serial),
      next: daysToNextHoliday(applicable, HolidaysNode.todaySerial()),
    };
  }

  private async fetchHolidays(year: number, country: string): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(holidaysUrl(year, country));
      this.cached = parseHolidays(text);
      connectionStore.setState(this.id, this.cached.length === 0
        ? { status: "error", message: "No holidays" }
        : { status: "ok", rows: this.cached.length, cols: 3, fetchedAt: Date.now() });
    } catch (e) {
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── CURRENCY / FX (Frankfurter: convert an amount, forward the target currency) ──
// The #1 googled conversion. Currency is a unit in the FC model, so the Converted output
// is AUTHORED with the target currency via applyFcUnit — the same value-side path Convert
// uses (firstClassUnits) — and every code is registered with the display bridge in
// fxProvider. Amount applies per compute (no re-fetch); From/To key the fetch.
export class FxNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    amount: "How much, in the From currency.",
    from: "The currency to convert out of.",
    to: "The currency to convert into.",
    converted: "The amount in the To currency, carrying that currency downstream.",
    rate: "Units of To per one From, on the as-of date.",
    asof: "The date these ECB reference rates are from.",
  };
  label: string;
  literals: Record<string, number> = { amount: 1 };
  stringLiterals: Record<string, string> = { from: "", to: "" };
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  width = 240; height = 250;
  /** Read by the component's output rows; never persisted. */
  cached: FxRate | null = null;
  private _lastKey: string | undefined;

  constructor(init?: { label?: string; refreshMinutes?: number }) {
    super("Fx");
    this.label = init?.label ?? "Currency";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addInput("amount", numIn("Amount"));
    this.addInput("from", strIn("From"));
    this.addInput("to", strIn("To"));
    this.addOutput("converted", numOut("Converted"));
    this.addOutput("rate", numOut("Rate"));
    this.addOutput("asof", dateOut("As of"));
  }

  data(inputs: { amount?: number[]; from?: string[]; to?: string[] }): { converted: unknown; rate: number | null; asof: number | null } {
    const amount = readInput(inputs.amount, this.literals.amount ?? 1);
    const fromRaw = readInput(inputs.from, this.stringLiterals.from ?? "");
    const toRaw = readInput(inputs.to, this.stringLiterals.to ?? "");
    const from = (typeof fromRaw === "string" ? fromRaw : "").trim().toUpperCase();
    const to = (typeof toRaw === "string" ? toRaw : "").trim().toUpperCase();
    const have = from !== "" && to !== "";
    const key = connectionStore.key(this.id, have ? `${from},${to}` : "");
    if (key !== this._lastKey) {
      if (!have) {
        this._lastKey = key;
        this.cached = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        this._lastKey = key;
        void this.fetchRate(from, to).then(() => scheduleConnectionRecalc());
      }
    }
    const rate = this.cached?.rate ?? null;
    const converted = rate != null && typeof amount === "number" ? amount * rate : null;
    // Author the target currency on the value, the same path Convert takes (firstClassUnits).
    const tagged = converted != null ? applyFcUnit(converted, to.toLowerCase()) : null;
    const asof = this.cached && Number.isFinite(this.cached.serial) ? this.cached.serial : null;
    return { converted: tagged, rate, asof };
  }

  private async fetchRate(from: string, to: string): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(fxLatestUrl(from, to));
      const parsed = parseFxRate(text, to);
      this.cached = parsed;
      connectionStore.setState(this.id, parsed.rate == null
        ? { status: "error", message: `No ${from}→${to} rate` }
        : { status: "ok", rows: 1, cols: 1, fetchedAt: Date.now() });
    } catch (e) {
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── VAULT FOLDER (an Obsidian folder of notes → ONE cube) ───────────────────────
// Bundle 24 item A: one row per note, the Bases file.* built-ins + the frontmatter union,
// with lists and nested tables riding in cube cells. Reads local files (desktop only, no
// network gate); the parse + typing is the pure vaultCube core, the mdbase / types.json /
// daily-notes sources are read here. Rows are never saved; reopening re-reads the vault.

/** A file-name glob (`*.md`, `2026-*`) → a case-insensitive regex over the base name. */
function nameGlobToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (".+^${}()|[]\\".includes(ch)) re += "\\" + ch;
    else re += ch;
  }
  return new RegExp(`^${re}$`, "i");
}

/** The mdbase hints for a note, resolving which discovered collection contains it (the
 *  longest folder prefix wins) and matching its path within that collection. */
function mdbaseHintFor(collections: Map<string, MdbaseCollection>, folder: string, vaultRelPath: string): TypeMap {
  if (collections.size === 0) return {};
  const readRootRel = folder && vaultRelPath.startsWith(`${folder}/`) ? vaultRelPath.slice(folder.length + 1) : vaultRelPath;
  let best: { key: string; coll: MdbaseCollection } | null = null;
  for (const [key, coll] of collections) {
    const inside = key === "" || readRootRel === key || readRootRel.startsWith(`${key}/`);
    if (!inside) continue;
    if (!best || key.length > best.key.length) best = { key, coll };
  }
  if (!best) return {};
  const collRel = best.key ? readRootRel.slice(best.key.length + 1) : readRootRel;
  return mdbaseTypeFor(best.coll, collRel);
}

export class VaultFolderNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    folder: "The vault subfolder to read. Blank reads the whole vault.",
    glob: "A file-name filter such as 2026-*. Blank keeps every note.",
    cube: "One row per note: the file columns, then every frontmatter key, with lists and nested tables kept in the cells. Notes are never saved into the project file.",
  };
  label: string;
  /** Vault-relative subfolder ("" = the whole vault). */
  folder: string;
  /** A file-name glob to keep ("" = every note). */
  glob: string;
  /** Add a `body` column carrying each note's markdown. */
  includeBody: boolean;
  /** Moment-token file-name format → the `date` column (R3); "" = the daily-notes default
   *  when the folder is the daily-notes folder, else no date. */
  nameFormat: string;
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  width = 260; height = 240;
  /** Read by the component's preview; never persisted. */
  cached: CubeValue | null = null;
  private _lastKey: string | undefined;
  /** folder / glob the last data() resolved (wired input, else the card field) — load() reads these. */
  private _folder = "";
  private _glob = "";

  constructor(init?: { label?: string; folder?: string; glob?: string; includeBody?: boolean; nameFormat?: string; refreshMinutes?: number }) {
    super("VaultFolder");
    this.label = init?.label ?? "Vault Folder";
    this.folder = init?.folder ?? "";
    this.glob = init?.glob ?? "";
    this.includeBody = init?.includeBody ?? false;
    this.nameFormat = init?.nameFormat ?? "";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addInput("folder", strIn("Folder"));
    this.addInput("glob", strIn("Filter"));
    this.addOutput("cube", cubeOut("Notes"));
  }

  data(inputs?: { folder?: (string | null)[]; glob?: (string | null)[] }): { cube: CubeValue | null } {
    const folder = (readInput(inputs?.folder, this.folder) ?? "").trim().replace(/^\/+|\/+$/g, "");
    const glob = (readInput(inputs?.glob, this.glob) ?? "").trim();
    const vault = settingsStore.get("obsidianVault"); // the one vault (singleVaultFromSetting)
    const key = connectionStore.key(this.id, `${vault}\u0000${folder}\u0000${glob}\u0000${this.nameFormat}\u0000${this.includeBody ? 1 : 0}`);
    if (key !== this._lastKey) {
      this._lastKey = key;
      this._folder = folder;
      this._glob = glob;
      if (!hasFs()) {
        this.cached = null;
        connectionStore.setState(this.id, { status: "error", message: "Reading a vault is available in the desktop app only" });
      } else if (vault.trim() === "") {
        this.cached = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else {
        void trackInflight(this.load()).then(() => scheduleConnectionRecalc());
      }
    }
    return { cube: this.cached };
  }

  private async load(): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const vault = settingsStore.get("obsidianVault").trim();
      const folder = this._folder; // resolved in data() (wired input, else the card field)
      const readRoot = folder ? await joinPath(vault, ...folder.split("/")) : vault;
      const globRe = this._glob ? nameGlobToRegExp(this._glob) : null;
      // Skip mdbase `_types` folders — those are schema files, not records.
      let files = (await listVaultMarkdownFiles(readRoot)).filter((p) => !p.split("/").includes("_types"));
      if (globRe) files = files.filter((p) => globRe.test(p.split("/").pop() ?? p));

      const rel = (p: string) => (folder ? `${folder}/${p}` : p);
      const notes: VaultNote[] = [];
      for (const f of files) {
        const text = await readVaultFile(readRoot, f);
        const st = await statVaultFile(readRoot, f);
        notes.push({ path: rel(f), text, mtimeMs: st?.mtimeMs ?? null, birthtimeMs: st?.birthtimeMs ?? null });
      }

      const collections = await this.discoverMdbase(readRoot, files);
      const obsidian = await this.readObsidianTypes(vault);
      const sources: VaultTypeSources = { mdbaseFor: (p) => mdbaseHintFor(collections, folder, p), obsidian };
      const nameFormat = this.nameFormat.trim() || (await this.defaultNameFormat(vault, folder));
      const cube = notesToCube(notes, sources, { nameFormat, includeBody: this.includeBody });

      this.cached = cube;
      connectionStore.setState(this.id, { status: "ok", rows: cubeRowCount(cube), cols: cube.columns.length, fetchedAt: Date.now() });
    } catch (e) {
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Every mdbase collection under `readRoot`, keyed by its folder (relative to readRoot). */
  private async discoverMdbase(readRoot: string, files: string[]): Promise<Map<string, MdbaseCollection>> {
    const folders = new Set<string>([""]);
    for (const f of files) {
      let seg = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
      while (seg) {
        folders.add(seg);
        seg = seg.includes("/") ? seg.slice(0, seg.lastIndexOf("/")) : "";
      }
    }
    const out = new Map<string, MdbaseCollection>();
    for (const folder of folders) {
      let yamlText: string;
      try {
        yamlText = await readVaultFile(readRoot, folder ? `${folder}/mdbase.yaml` : "mdbase.yaml");
      } catch {
        continue; // not a collection
      }
      let typeTexts: string[] = [];
      try {
        const typesDir = folder ? await joinPath(readRoot, ...folder.split("/"), "_types") : await joinPath(readRoot, "_types");
        const names = await listMarkdownFiles(typesDir);
        typeTexts = await Promise.all(names.map((n) => readFileText(typesDir, n)));
      } catch {
        typeTexts = [];
      }
      out.set(folder, parseMdbaseCollection(yamlText, typeTexts));
    }
    return out;
  }

  private async readObsidianTypes(vault: string): Promise<TypeMap> {
    try {
      return parseObsidianTypes(await readVaultFile(vault, ".obsidian/types.json"));
    } catch {
      return {};
    }
  }

  private async defaultNameFormat(vault: string, folder: string): Promise<string> {
    try {
      const cfg = parseDailyNotesConfig(await readVaultFile(vault, ".obsidian/daily-notes.json"));
      return cfg.folder === folder ? cfg.format : "";
    } catch {
      return "";
    }
  }
}
