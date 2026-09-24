// [[C113]], [[C103]] untrustedContentSeams, [[C1]] demoVault
import { ClassicPreset } from "rete";
import { frameOut, strListOut, strIn, numIn, numOut, strOut, dateOut, dateIn, dateListOut, cubeOut, readInput } from "./shared";
import { serialToJsDate } from "./dateSerial";
import { geocodeUrl, parseGeocode, pickGeocodeMatch, type GeocodeMatch } from "../geocodeProvider";
import { weatherUrl, parseWeather, type TempUnit, type WeatherResult } from "../weatherProvider";
import { holidaysUrl, parseHolidays, filterHolidays, holidaysFrame, daysToNextHoliday, type Holiday } from "../holidaysProvider";
import { fxLatestUrl, parseFxRate, fxRangeUrl, parseFxSeries, type FxRate, type FxPoint } from "../fxProvider";
import { notesToCube, type VaultNote, type VaultTypeSources } from "../vaultCube";
import { parseMdbaseCollection, mdbaseTypeFor, type MdbaseCollection } from "../mdbaseTypes";
import { parseObsidianTypes } from "../obsidianTypes";
import { parsePluginColumnTypes, PLUGIN_DATA_PATH, type PluginColumnTypes } from "../pluginColumnTypes";
import { parseDailyNotesConfig } from "../dailyNotesConfig";
import { type TypeMap } from "../vaultTypes";
import { applyFcUnit } from "../unitBridge";
import { type Shape } from "../frameShape";
import { connectionStore, requestNetwork, fetchInBackground } from "../connectionStore";
import { isDesktop, hasFs, readFileText, joinPath, listVaultMarkdownFiles, listMarkdownFiles, readVaultFile, statVaultFile, isInsideVault } from "../fileBridge";
import { getVaultRoot, getCsvFolder, isDemoVaultPath } from "../demoVault";
import { fetchText } from "../httpBridge";
import { frameFromCells, frameFromRecords, frameFromRows, frameFromColumnar, frameRowCount, cubeRowCount, type FrameValue, type CubeValue } from "../frame";
import { parseCsvRows } from "../csv";
import { engineAvailable, ipcInvoke } from "../ipcBridge";
import { readCsvFrame, dropFrameRef, collectPreview, type FrameRef, type FrameHandle } from "../frameBackend";
import { solError, isSolError, type SolError } from "../errorValue";
import { planFileToPlan, csvPlanToCube } from "../planImport";

// ─── External-data connection nodes ─────────────────────────────────────────────

export function csvToFrame(text: string): FrameValue {
  const rows = parseCsvRows(text, { detectDelimiter: true });
  if (rows.length === 0) return { __frame: true, columns: [] };
  const headers = rows[0].map((h) => h.trim());
  return frameFromCells(headers, rows.slice(1));
}

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
  refreshMinutes: number;
  cachedResult: FrameValue | null = null;
  width = 260; height = 200;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;

  constructor(init?: { label?: string; url?: string; refreshMinutes?: number }) {
    super("WebSource");
    this.label = init?.label ?? "Web Source";
    this.url = init?.url ?? "";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
  }

  data(): { frame: FrameValue | null } {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
    const ref = this.url.trim();
    const key = connectionStore.key(this.id, ref);
    if (key === this.lastKey) return { frame: this.cachedResult };
    if (ref !== "" && !requestNetwork(this.id)) return { frame: this.cachedResult };
    if (this.inflightKey !== key) {
      this.inflightKey = key;
      fetchInBackground(this.id, this.fetchFrame(ref, key));
    }
    return { frame: this.cachedResult };
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
      this.lastKey = key;
      const msg = e instanceof Error ? e.message : String(e);
      connectionStore.setState(this.id, { status: "error", message: msg });
      return { frame: null };
    }
  }
}

// ─── Shared fetch + status (IMPORT nodes) ───────────────────────────────────────
async function fetchParsed<T>(
  nodeId: string,
  url: string,
  parse: (text: string, contentType: string) => T,
  size: (v: T) => { rows: number; cols: number },
): Promise<T | null> {
  if (url === "") { connectionStore.setState(nodeId, { status: "idle" }); return null; }
  if (!requestNetwork(nodeId)) return null;
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

export function xpathToList(html: string, query: string): string[] {
  if (typeof DOMParser === "undefined") throw new Error("XML parsing needs a browser environment.");
  const q = query.trim();
  if (q === "") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  // 7 is XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, written as a literal so the global is never referenced.
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
  tableIndex: number; // 1-based
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
  query: string;
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

// ─── LOCAL FILE (a file in the Settings target folder) ──────────────────────────
export class LocalFileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "Reads the named file from the folder chosen in Settings. Rows are never saved into the project file.",
    plan: "A project plan: Project XML, GanttProject, Primavera XER, or a CSV with Predecessors like 3FS+2d. Tasks nest as the outline. Empty otherwise.",
  };
  label: string;
  fileName: string;
  cachedPlan: CubeValue | null = null;
  planNotes: string[] = [];
  refreshMinutes: number;
  cachedResult: FrameValue | SolError | null = null;
  width = 260; height = 210;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;
  private inflight: Promise<{ frame: FrameValue | FrameRef | SolError | null; plan: CubeValue | null }> | undefined;
  /** Owned by this node: drop it with `dropFrameRef` before replacing or clearing it. */
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

  private static isPlanFile(name: string): boolean {
    return /\.(xml|gan|xer)$/i.test(name);
  }

  async data(): Promise<{ frame: FrameValue | FrameRef | SolError | null; plan: CubeValue | null }> {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
    const folder = getCsvFolder();
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
    const fail = (message: string, status: "idle" | "error" = "error") => {
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      const out = status === "error" && parquet ? solError("#REF!", message) : null;
      this.cachedResult = out;
      this.lastKey = key;
      connectionStore.setState(this.id, { status, message });
      return { frame: out, plan: null };
    };
    if (parquet ? (!isDesktop() || !engineAvailable()) : (!isDesktop() && !isDemoVaultPath(folder))) {
      return fail(parquet ? "Desktop app (native engine) only" : "Desktop app only");
    }
    if (folder === "") return fail("Set a target folder in Settings", "idle");
    if (name === "") return fail("Pick a file", "idle");
    connectionStore.setState(this.id, { status: "loading" });
    try {
      if (parquet) {
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
      if (this.ref) { dropFrameRef(this.ref); this.ref = null; }
      if (LocalFileNode.isPlanFile(name)) {
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
      const frame = engineAvailable() && !isDemoVaultPath(folder)
        ? await (async () => {
            const r = await readCsvFrame(folder, name);
            if (isSolError(r)) throw new Error(r.message);
            return r;
          })()
        : csvToFrame(await readFileText(folder, name));
      this.cachedResult = frame;
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
export class GeocodeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    place: "A place name, for example Boise or Paris.",
    timezone: "The IANA time zone name, for example America/Boise.",
  };
  label: string;
  stringLiterals: Record<string, string> = {};
  pickedLabel = "";
  width = 240; height = 230;
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
        // Commit the key only once the fetch launches, so a gated pass asks again.
        this._lastFetchKey = key;
        fetchInBackground(this.id, this.fetchMatches(place));
      }
    }
    const m = pickGeocodeMatch(this.matches, this.pickedLabel);
    return { lat: m?.lat ?? null, lon: m?.lon ?? null, timezone: m?.timezone ?? null, label: m?.label ?? null };
  }

  private async fetchMatches(place: string): Promise<void> {
    const key = this._lastFetchKey;
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(geocodeUrl(place));
      if (this._lastFetchKey !== key) return;
      this.matches = parseGeocode(text);
      connectionStore.setState(this.id, this.matches.length === 0
        ? { status: "error", message: "No match" }
        : { status: "ok", rows: this.matches.length, cols: 1, fetchedAt: Date.now() });
    } catch (e) {
      if (this._lastFetchKey !== key) return;
      this.matches = [];
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── WEATHER (Open-Meteo forecast: a Daily frame + Now scalars) ─────────────────
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
  refreshMinutes: number;
  width = 240; height = 280;
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

  frameShape(): Shape {
    return { columns: [
      { name: "Date", type: "date" }, { name: "Rain mm", type: "number" }, { name: "Rain %", type: "number" },
      { name: "High", type: "number" }, { name: "Low", type: "number" }, { name: "ET₀ mm", type: "number" },
      { name: "Condition", type: "string" },
    ] };
  }

  data(inputs: { lat?: number[]; lon?: number[] }): { daily: FrameValue | null; temp: unknown; condition: string | null } {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
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
        fetchInBackground(this.id, this.fetchWeather(lat, lon));
      }
    }
    const c = this.cached;
    const fcUnit = this.unit === "F" ? "degF" : "degC";
    return {
      daily: c?.daily ?? null,
      temp: c?.nowTemp != null ? applyFcUnit(c.nowTemp, fcUnit) : null,
      condition: c?.nowCondition ?? null,
    };
  }

  private async fetchWeather(lat: number, lon: number): Promise<void> {
    const key = this._lastKey;
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(weatherUrl(lat, lon, this.unit, this.pastDays, this.forecastDays));
      if (this._lastKey !== key) return;
      this.cached = parseWeather(text, this.unit);
      connectionStore.setState(this.id, { status: "ok", rows: frameRowCount(this.cached.daily), cols: this.cached.daily.columns.length, fetchedAt: Date.now() });
    } catch (e) {
      if (this._lastKey !== key) return;
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── HOLIDAYS (Nager.Date: a year's public holidays as a frame + a date list) ────
export class HolidaysNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "One row per holiday: date, English name, local name.",
    dates: "Every holiday's date. Skipped by NETWORKDAYS and WORKDAY.",
    next: "Whole days until the next holiday, counting from today.",
  };
  label: string;
  country: string;
  region: string;
  year: number;
  refreshMinutes: number;
  width = 240; height = 250;
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

  frameShape(): Shape {
    return { columns: [
      { name: "Date", type: "date" }, { name: "Name", type: "string" }, { name: "Local", type: "string" },
    ] };
  }

  private static todaySerial(): number {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }

  data(): { frame: FrameValue; dates: number[]; next: number | null } {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
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
        fetchInBackground(this.id, this.fetchHolidays(year, country));
      }
    }
    const applicable = filterHolidays(this.cached ?? [], this.region);
    return {
      frame: holidaysFrame(applicable),
      dates: applicable.map((h) => h.serial),
      next: daysToNextHoliday(applicable, HolidaysNode.todaySerial()),
    };
  }

  private async fetchHolidays(year: number, country: string): Promise<void> {
    const key = this._lastKey;
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(holidaysUrl(year, country));
      if (this._lastKey !== key) return;
      this.cached = parseHolidays(text);
      connectionStore.setState(this.id, this.cached.length === 0
        ? { status: "error", message: "No holidays" }
        : { status: "ok", rows: this.cached.length, cols: 3, fetchedAt: Date.now() });
    } catch (e) {
      if (this._lastKey !== key) return;
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── CURRENCY / FX (Frankfurter: convert an amount, forward the target currency) ──
export type FxMode = "spot" | "history";

export const FX_MODE_META: Record<FxMode, { label: string }> = {
  spot:    { label: "Spot" },
  history: { label: "History" },
};

const FX_INPUTS: Record<FxMode, string[]> = {
  spot:    ["amount", "from", "to"],
  history: ["from", "to", "from_date", "to_date"],
};
const FX_OUTPUTS: Record<FxMode, string[]> = {
  spot:    ["converted", "rate", "asof"],
  history: ["frame"],
};

function fxSerialToIso(serial: number): string {
  return serialToJsDate(serial).toISOString().slice(0, 10);
}
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export class FxNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    amount: "How much, in the From currency.",
    from: "The currency to convert out of.",
    to: "The currency to convert into.",
    from_date: "The history range's start. Blank means 90 days back.",
    to_date: "The history range's end. Blank means today.",
    converted: "The amount in the To currency, carrying that currency downstream.",
    rate: "Units of To per one From, on the as-of date.",
    asof: "The date these ECB reference rates are from.",
    frame: "One row per business day in the range: the date and the rate.",
  };
  label: string;
  mode: FxMode;
  literals: Record<string, number> = { amount: 1 };
  stringLiterals: Record<string, string> = { from: "", to: "", from_date: "", to_date: "" };
  refreshMinutes: number;
  width = 240; height = 250;
  cached: FxRate | null = null;
  cachedSeries: FxPoint[] | null = null;
  private _lastKey: string | undefined;

  constructor(init?: { label?: string; mode?: FxMode; refreshMinutes?: number }) {
    super("Fx");
    this.label = init?.label ?? "Currency";
    this.mode = init?.mode ?? "spot";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    for (const k of FX_INPUTS[this.mode]) this.addInput(k, this.makeInput(k));
    for (const k of FX_OUTPUTS[this.mode]) this.addOutput(k, this.makeOutput(k));
    if (this.mode === "history") this.seedDefaultRange();
  }

  private makeInput(key: string): ClassicPreset.Input<ClassicPreset.Socket> {
    switch (key) {
      case "amount":    return numIn("Amount");
      case "from":      return strIn("From");
      case "to":        return strIn("To");
      case "from_date": return dateIn("From date");
      default:          return dateIn("To date");
    }
  }
  private makeOutput(key: string): ClassicPreset.Output<ClassicPreset.Socket> {
    switch (key) {
      case "converted": return numOut("Converted");
      case "rate":      return numOut("Rate");
      case "asof":      return dateOut("As of");
      default:          return frameOut("Rates");
    }
  }

  frameShape(): Shape {
    return { columns: [{ name: "Date", type: "date" }, { name: "Rate", type: "number" }] };
  }

  keysDroppedBySwitch(next: FxMode): { inputs: string[]; outputs: string[] } {
    return {
      inputs: FX_INPUTS[this.mode].filter((k) => !FX_INPUTS[next].includes(k)),
      outputs: FX_OUTPUTS[this.mode].filter((k) => !FX_OUTPUTS[next].includes(k)),
    };
  }

  setMode(next: FxMode): void {
    if (next === this.mode) return;
    this.mode = next;
    for (const k of Object.keys(this.inputs)) if (!FX_INPUTS[next].includes(k)) this.removeInput(k);
    for (const k of Object.keys(this.outputs)) if (!FX_OUTPUTS[next].includes(k)) this.removeOutput(k);
    for (const k of FX_INPUTS[next]) if (!this.inputs[k]) this.addInput(k, this.makeInput(k));
    for (const k of FX_OUTPUTS[next]) if (!this.outputs[k]) this.addOutput(k, this.makeOutput(k));
    if (next === "history") this.seedDefaultRange();
    this._lastKey = undefined;
  }

  private seedDefaultRange(): void {
    if (!this.stringLiterals.to_date) this.stringLiterals.to_date = isoDaysFromNow(0);
    if (!this.stringLiterals.from_date) this.stringLiterals.from_date = isoDaysFromNow(-90);
  }

  data(inputs: Record<string, unknown[] | undefined>): Record<string, unknown> {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
    return this.mode === "history" ? this.dataHistory(inputs) : this.dataSpot(inputs);
  }

  private dataSpot(inputs: Record<string, unknown[] | undefined>): { converted: unknown; rate: number | null; asof: number | null } {
    const amount = readInput(inputs.amount as (number | number[])[] | undefined, this.literals.amount ?? 1);
    const fromRaw = readInput(inputs.from as (string | string[])[] | undefined, this.stringLiterals.from ?? "");
    const toRaw = readInput(inputs.to as (string | string[])[] | undefined, this.stringLiterals.to ?? "");
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
        fetchInBackground(this.id, this.fetchRate(from, to));
      }
    }
    const rate = this.cached?.rate ?? null;
    const converted = rate != null && typeof amount === "number" ? amount * rate : null;
    const tagged = converted != null ? applyFcUnit(converted, to.toLowerCase()) : null;
    const asof = this.cached && Number.isFinite(this.cached.serial) ? this.cached.serial : null;
    return { converted: tagged, rate, asof };
  }

  private dataHistory(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue } {
    const fromRaw = readInput(inputs.from as (string | string[])[] | undefined, this.stringLiterals.from ?? "");
    const toRaw = readInput(inputs.to as (string | string[])[] | undefined, this.stringLiterals.to ?? "");
    const from = (typeof fromRaw === "string" ? fromRaw : "").trim().toUpperCase();
    const to = (typeof toRaw === "string" ? toRaw : "").trim().toUpperCase();
    const start = this.readDate(inputs.from_date, this.stringLiterals.from_date, -90);
    const end = this.readDate(inputs.to_date, this.stringLiterals.to_date, 0);
    const have = from !== "" && to !== "" && start !== "" && end !== "";
    const key = connectionStore.key(this.id, have ? `${from},${to},${start},${end}` : "");
    if (key !== this._lastKey) {
      if (!have) {
        this._lastKey = key;
        this.cachedSeries = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        this._lastKey = key;
        fetchInBackground(this.id, this.fetchSeries(from, to, start, end));
      }
    }
    return { frame: this.seriesFrame() };
  }

  private readDate(wired: unknown[] | undefined, literal: string | undefined, dayOffset: number): string {
    if (wired && wired.length > 0) {
      const s = wired[0];
      return typeof s === "number" && Number.isFinite(s) ? fxSerialToIso(s) : "";
    }
    const iso = (literal ?? "").trim();
    return iso !== "" ? iso : isoDaysFromNow(dayOffset);
  }

  private seriesFrame(): FrameValue {
    const pts = this.cachedSeries ?? [];
    return { __frame: true, columns: [
      { name: "Date", type: "date", values: pts.map((p) => p.serial) },
      { name: "Rate", type: "number", values: pts.map((p) => p.rate) },
    ] };
  }

  private async fetchRate(from: string, to: string): Promise<void> {
    const key = this._lastKey;
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(fxLatestUrl(from, to));
      if (this._lastKey !== key) return;
      const parsed = parseFxRate(text, to);
      this.cached = parsed;
      connectionStore.setState(this.id, parsed.rate == null
        ? { status: "error", message: `No ${from}→${to} rate` }
        : { status: "ok", rows: 1, cols: 1, fetchedAt: Date.now() });
    } catch (e) {
      if (this._lastKey !== key) return;
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private async fetchSeries(from: string, to: string, start: string, end: string): Promise<void> {
    const key = this._lastKey;
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(fxRangeUrl(from, to, start, end));
      if (this._lastKey !== key) return;
      const pts = parseFxSeries(text, to);
      this.cachedSeries = pts;
      connectionStore.setState(this.id, pts.length === 0
        ? { status: "error", message: `No ${from}→${to} history` }
        : { status: "ok", rows: pts.length, cols: 2, fetchedAt: Date.now() });
    } catch (e) {
      if (this._lastKey !== key) return;
      this.cachedSeries = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── VAULT FOLDER (an Obsidian folder of notes → ONE cube) ───────────────────────

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
  folder: string;
  glob: string;
  includeBody: boolean;
  nameFormat: string;
  refreshMinutes: number;
  width = 260; height = 240;
  cached: CubeValue | null = null;
  private _lastKey: string | undefined;
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
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
    const folder = (readInput(inputs?.folder, this.folder) ?? "").trim().replace(/^\/+|\/+$/g, "");
    const glob = (readInput(inputs?.glob, this.glob) ?? "").trim();
    const vault = getVaultRoot();
    const key = connectionStore.key(this.id, `${vault}\u0000${folder}\u0000${glob}\u0000${this.nameFormat}\u0000${this.includeBody ? 1 : 0}`);
    if (key !== this._lastKey) {
      this._lastKey = key;
      this._folder = folder;
      this._glob = glob;
      if (!hasFs() && !isDemoVaultPath(vault)) {
        this.cached = null;
        connectionStore.setState(this.id, { status: "error", message: "Reading a vault is available in the desktop app only" });
      } else if (vault.trim() === "") {
        this.cached = null;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (folder !== "" && !isInsideVault(folder)) {
        this.cached = null;
        connectionStore.setState(this.id, { status: "error", message: `"${folder}" is not inside the vault` });
      } else {
        fetchInBackground(this.id, this.load(key));
      }
    }
    return { cube: this.cached };
  }

  /** A load that a newer key overtook lands nowhere, so a slow read never overwrites a fresh one. */
  private async load(key: string): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    const current = () => this._lastKey === key;
    try {
      const vault = getVaultRoot().trim();
      const folder = this._folder;
      const readRoot = folder ? await joinPath(vault, ...folder.split("/")) : vault;
      const globRe = this._glob ? nameGlobToRegExp(this._glob) : null;
      let files = (await listVaultMarkdownFiles(readRoot)).filter((p) => !p.split("/").includes("_types"));
      if (globRe) files = files.filter((p) => globRe.test(p.split("/").pop() ?? p));

      const rel = (p: string) => (folder ? `${folder}/${p}` : p);
      const notes: VaultNote[] = [];
      for (const f of files) {
        let text: string;
        // A note renamed or deleted between the listing and its read is simply gone.
        try { text = await readVaultFile(readRoot, f); } catch { continue; }
        const st = await statVaultFile(readRoot, f);
        notes.push({ path: rel(f), text, mtimeMs: st?.mtimeMs ?? null, birthtimeMs: st?.birthtimeMs ?? null });
      }

      const collections = await this.discoverMdbase(readRoot, files);
      const obsidian = await this.readObsidianTypes(vault);
      const columns = await this.readColumnPicks(vault);
      const sources: VaultTypeSources = { mdbaseFor: (p) => mdbaseHintFor(collections, folder, p), obsidian, columns };
      const nameFormat = this.nameFormat.trim() || (await this.defaultNameFormat(vault, folder));
      const cube = notesToCube(notes, sources, { nameFormat, includeBody: this.includeBody });

      if (!current()) return;
      this.cached = cube;
      connectionStore.setState(this.id, { status: "ok", rows: cubeRowCount(cube), cols: cube.columns.length, fetchedAt: Date.now() });
    } catch (e) {
      if (!current()) return;
      this.cached = null;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

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
        continue;
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

  private async readColumnPicks(vault: string): Promise<PluginColumnTypes> {
    try {
      return parsePluginColumnTypes(await readVaultFile(vault, PLUGIN_DATA_PATH));
    } catch {
      return {};
    }
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
