import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  TaskNotesNode as TaskNotesNodeType,
  WebSourceNode as WebSourceNodeType,
  LocalFileNode as LocalFileNodeType,
  ImportHtmlNode as ImportHtmlNodeType,
  ImportXmlNode as ImportXmlNodeType,
  DataFeedNode as DataFeedNodeType,
  GeocodeNode as GeocodeNodeType,
  WeatherNode as WeatherNodeType,
  HolidaysNode as HolidaysNodeType,
  FxNode as FxNodeType,
  VaultFolderNode as VaultFolderNodeType,
} from "../rete-nodes";
import { processGraph } from "../process";
import { connectionStore, refreshConnection, type ConnectionState } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, listLocalFiles, listVaultFolders, openExternal } from "../fileBridge";
import { obsidianOpenUrl } from "../obsidianLinks";
import { apiKeyStore } from "../apiKeyStore";
import { PROVIDER_LIST, getProvider, type ProviderId } from "../dataProviders";
import { FrameDisplay } from "./FrameDisplay";
import { LazySelect } from "./LazySelect";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { InlineInputs, useConnectedInputs, useIncomingSources } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { RefreshIcon } from "./RefreshIcon";
import "./ConnectionNodes.css";
import { stopDragStart } from "../coarse";
import { nodeDisplayName } from "../catalogUtils";
import { pickGeocodeMatch } from "../geocodeProvider";
import { NAGER_COUNTRIES, filterHolidays, daysToNextHoliday } from "../holidaysProvider";
import { FX_CURRENCIES } from "../fxProvider";
import { frameRowCount, cubeRowCount } from "../frame";
import { useVaultWatch } from "./useVaultWatch";
import { TASKNOTES_KEY_ID, TASKNOTES_PROVIDER_META, statsToFrame, type TaskNotesProvider } from "../taskNotesApi";
import { dropInputCables } from "./cablePrune";
import { dropStrandedFrontmatterCables } from "../noteFrontmatterSync";
import { getActiveView } from "../activeGraph";

function statusText(s: ConnectionState): string {
  switch (s.status) {
    case "loading": return "Loading…";
    case "error":   return s.message || "Failed";
    case "ok":      return `${s.rows ?? 0}×${s.cols ?? 0}${s.fetchedAt ? ` · ${new Date(s.fetchedAt).toLocaleTimeString()}` : ""}`;
    case "gated":   return "Waiting for permission";
    default:        return "Not connected";
  }
}

// The timer calls the SAME refreshConnection(id) a manual click does, so an interval-
// backed source is indistinguishable downstream from a clicked one.
function useAutoRefresh(nodeId: string, minutes: number) {
  useEffect(() => {
    if (minutes <= 0) return;
    const id = setInterval(() => { void refreshConnection(nodeId); }, minutes * 60_000);
    return () => clearInterval(id);
  }, [nodeId, minutes]);
}

function RefreshIntervalField({ minutes, onCommit }: { minutes: number; onCommit: (n: number) => void }) {
  const [val, setVal] = useState(String(minutes));
  useEffect(() => { setVal(String(minutes)); }, [minutes]);
  function commit() {
    const n = Math.max(0, Math.round(Number(val) || 0));
    setVal(String(n));
    if (n !== minutes) onCommit(n);
  }
  return (
    <label className="sol-conn__field" title="Automatically refreshes on this cadence. 0 turns it off.">
      Auto-refresh (min)
      <input
        className="sol-conn__num"
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function ConnectionStatusRow({ nodeId, onRefresh }: { nodeId: string; onRefresh: () => void }) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version);
  const s = connectionStore.getState(nodeId);
  return (
    <div className="sol-conn__status">
      <span
        className={`sol-conn__dot sol-conn__dot--${s.status}`}
        title={s.status === "gated" ? "Waiting for permission. Allow this document to connect in Settings ▸ Data." : undefined}
      />
      <span className="sol-conn__status-text" title={s.status === "error" ? s.message : undefined}>
        {statusText(s)}
      </span>
      <button
        type="button"
        className="sol-conn__refresh"
        title="Refresh this connection"
        disabled={s.status === "loading"}
        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <RefreshIcon />
      </button>
    </div>
  );
}

// ─── WEB SOURCE ─────────────────────────────────────────────────────────────────
// The URL field commits on blur/Enter, never per keystroke, so typing can't fire a fetch.

export function WebSourceComponent({ data, emit }: NodeProps<WebSourceNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useEffect(() => { setUrl(data.url); }, [data.url]);
  useAutoRefresh(data.id, minutes);

  function commit() {
    const next = url.trim();
    if (next !== data.url) { data.url = next; void processGraph(); }
  }

  return (
    <NodeShell node={data} emit={emit}>
      <div className="sol-conn">
        <input
          className="sol-conn__url"
          type="text"
          value={url}
          placeholder="https://…/data.csv"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
        <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
      </div>
    </NodeShell>
  );
}

// ─── IMPORT HTML (Nth table on a page → Frame) ──────────────────────────────────

export function ImportHtmlComponent({ data, emit }: NodeProps<ImportHtmlNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [idx, setIdx] = useState(String(data.tableIndex));
  useEffect(() => { setUrl(data.url); }, [data.url]);
  useEffect(() => { setIdx(String(data.tableIndex)); }, [data.tableIndex]);

  function commit() {
    const nextUrl = url.trim();
    const nextIdx = Math.max(1, Math.round(Number(idx) || 1));
    setIdx(String(nextIdx));
    if (nextUrl !== data.url || nextIdx !== data.tableIndex) {
      data.url = nextUrl; data.tableIndex = nextIdx; void processGraph();
    }
  }

  return (
    <NodeShell node={data} emit={emit}>
      <div className="sol-conn">
        <input
          className="sol-conn__url"
          type="text"
          value={url}
          placeholder="https://…/page.html"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <label className="sol-conn__field">
          Table #
          <input
            className="sol-conn__num"
            type="number"
            min={1}
            value={idx}
            onChange={(e) => setIdx(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </label>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
      </div>
    </NodeShell>
  );
}

// ─── IMPORT XML (XPath on a page → text list) ───────────────────────────────────

export function ImportXmlComponent({ data, emit }: NodeProps<ImportXmlNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [query, setQuery] = useState(data.query);
  useEffect(() => { setUrl(data.url); }, [data.url]);
  useEffect(() => { setQuery(data.query); }, [data.query]);

  function commit() {
    const nextUrl = url.trim();
    const nextQuery = query;
    if (nextUrl !== data.url || nextQuery !== data.query) {
      data.url = nextUrl; data.query = nextQuery; void processGraph();
    }
  }

  const vals = data.cachedResult;
  return (
    <NodeShell node={data} emit={emit}>
      <div className="sol-conn">
        <input
          className="sol-conn__url"
          type="text"
          value={url}
          placeholder="https://…/page.html"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <input
          className="sol-conn__url"
          type="text"
          value={query}
          placeholder='XPath, for example //h2/a'
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        {vals && vals.length > 0 && (
          <div className="sol-conn__preview" title={`${vals.length} matches`}>
            {vals.slice(0, 4).map((v, i) => <div key={i} className="sol-conn__preview-row">{v}</div>)}
            {vals.length > 4 && <div className="sol-conn__preview-more">+{vals.length - 4} more</div>}
          </div>
        )}
      </div>
    </NodeShell>
  );
}

// ─── CSV CONNECTION (local folder) ──────────────────────────────────────────────
// Desktop only (no filesystem in the browser). The native <LazySelect> needs
// pointerdown/mousedown stopPropagation or the node-drag re-render closes it mid-pick.

// One node for the data folder's files — the file EXTENSION picks the reader (.parquet
// through the native engine, everything else CSV), so there is no format control.
export function LocalFileComponent({ data, emit }: NodeProps<LocalFileNodeType>) {
  const folder = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("csvFolder"));
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState(data.fileName);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  const desktop = isDesktop();
  useAutoRefresh(data.id, minutes);

  useEffect(() => {
    let alive = true;
    listLocalFiles(folder).then((fs) => { if (alive) setFiles(fs); }).catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, [folder]);

  useEffect(() => { setName(data.fileName); }, [data.fileName]);

  function pick(next: string) {
    setName(next);
    data.fileName = next;
    void processGraph();
  }

  function refresh() {
    listLocalFiles(folder).then(setFiles).catch(() => setFiles([]));
    void refreshConnection(data.id);
  }

  const frameOut = data.outputs.frame;
  const planRows = data.cachedPlan ? cubeRowCount(data.cachedPlan) : 0;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div className="sol-conn">
        {!desktop ? (
          <div className="sol-conn__note">Local files are available in the desktop app only.</div>
        ) : !folder ? (
          <div className="sol-conn__note">No target folder set. Open Settings ▸ Data to choose one.</div>
        ) : (
          <LazySelect
            className="sol-conn__select"
            value={name}
            onChange={(e) => pick(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="">Pick a file…</option>
            {name !== "" && !files.includes(name) && <option value={name}>{name} (missing)</option>}
            {files.map((f) => <option key={f} value={f}>{f}</option>)}
          </LazySelect>
        )}
        <ConnectionStatusRow nodeId={data.id} onRefresh={refresh} />
        {desktop && folder && (
          <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
        )}
      </div>
      {frameOut && (
        <MeasuredSocketRow hero side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frameOut.socket}>
          <div style={{ width: "100%" }}>
            <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
          </div>
        </MeasuredSocketRow>
      )}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[{ key: "plan", label: "Plan", value: planRows > 0 ? `${planRows} task${planRows === 1 ? "" : "s"}` : null }]}
      />
    </NodeShell>
  );
}

// ─── DATA FEED (Finance / economic data) ────────────────────────────────────────
// FRED is KEYLESS (public fredgraph.csv); Alpha Vantage is keyed. Same fetch/cache
// shape as the other connection nodes — data() stays sync, one background fetch per key.

const stopDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

export function DataFeedComponent({ data, emit }: NodeProps<DataFeedNodeType>) {
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  const [provider, setProvider] = useState<ProviderId>(data.provider);
  const [input, setInput] = useState(data.stringLiterals.input ?? "");
  const [freq, setFreq] = useState(data.stringLiterals.freq ?? "");
  const [start, setStart] = useState(data.stringLiterals.start ?? "");
  const [end, setEnd] = useState(data.stringLiterals.end ?? "");
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useEffect(() => { setProvider(data.provider); }, [data.provider]);
  useEffect(() => { setInput(data.stringLiterals.input ?? ""); }, [data.stringLiterals.input]);
  useAutoRefresh(data.id, minutes);

  const preset = getProvider(provider);

  function pickProvider(next: ProviderId) {
    setProvider(next);
    data.provider = next;
    // Refinements are provider-specific, so a stale one would build a bad URL — reset them.
    data.stringLiterals.freq = ""; data.stringLiterals.start = ""; data.stringLiterals.end = "";
    setFreq(""); setStart(""); setEnd("");
    void processGraph();
  }
  function commitInput(next: string) {
    const v = next.trim();
    setInput(v);
    if (v !== (data.stringLiterals.input ?? "")) { data.stringLiterals.input = v; void processGraph(); }
  }
  // Discrete refinements (frequency select, date pickers) apply immediately.
  function setParam(key: "freq" | "start" | "end", v: string) {
    data.stringLiterals[key] = v;
    if (key === "freq") setFreq(v); else if (key === "start") setStart(v); else setEnd(v);
    void processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <div className="sol-conn">
        <LazySelect className="sol-conn__select" value={provider} onChange={(e) => pickProvider(e.target.value as ProviderId)} {...stopDrag}>
          {PROVIDER_LIST.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </LazySelect>
        {preset.quickPicks && (
          // Quick-picks fill the field (the ids are cryptic); reset to "" so it's re-pickable.
          <LazySelect className="sol-conn__select" value="" onChange={(e) => { if (e.target.value) commitInput(e.target.value); }} {...stopDrag}>
            <option value="">Common {preset.inputLabel.toLowerCase()}s…</option>
            {preset.quickPicks.map((q) => <option key={q.id} value={q.id}>{q.label} ({q.id})</option>)}
          </LazySelect>
        )}
        <input
          className="sol-conn__url"
          type="text"
          value={input}
          placeholder={preset.placeholder}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onBlur={(e) => commitInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          {...stopDrag}
        />
        {preset.frequencies && (
          <LazySelect className="sol-conn__select" value={freq} onChange={(e) => setParam("freq", e.target.value)} title="Frequency" {...stopDrag}>
            {preset.frequencies.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </LazySelect>
        )}
        {preset.supportsDateRange && (
          <div className="sol-conn__dates">
            <input className="sol-conn__date" type="date" value={start} max={end || undefined} onChange={(e) => setParam("start", e.target.value)} title="Start date" {...stopDrag} />
            <span className="sol-conn__date-sep">→</span>
            <input className="sol-conn__date" type="date" value={end} min={start || undefined} onChange={(e) => setParam("end", e.target.value)} title="End date" {...stopDrag} />
          </div>
        )}
        {data.needsKey() && (
          <div className="sol-conn__note">Add a {preset.label} API key in Settings ▸ Data.</div>
        )}
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
        <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
      </div>
    </NodeShell>
  );
}


// ─── GEOCODE ─────────────────────────────────────────────────────────────────────
// Place name → lat / lon / timezone. The Place field commits on blur/Enter (never per
// keystroke); when several places match, a pick chooses which (stored by label).
export function GeocodeComponent({ data, emit }: NodeProps<GeocodeNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version); // re-read matches when a fetch lands
  // The SAME pick the node computes, so the rows never disagree with the cables.
  const m = pickGeocodeMatch(data.matches, data.pickedLabel);

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets className="solenoid-node--geocode">
      {/* The Place input is a wireable socket row, not bare chrome — a Text Input or a
          frame cell drives it exactly as a typed name does. */}
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {data.matches.length > 1 && (
          <LazySelect
            className="sol-conn__select"
            value={data.pickedLabel || data.matches[0].label}
            title="Which match"
            onChange={(e) => { data.pickedLabel = e.target.value; void processGraph(); }}
          >
            {data.matches.map((m2) => <option key={m2.label} value={m2.label}>{m2.label}</option>)}
          </LazySelect>
        )}
        <div className="sol-conn__note">Open-Meteo geocoding.</div>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
      </div>
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "lat",      label: "LAT",       value: m?.lat ?? null },
          { key: "lon",      label: "LON",       value: m?.lon ?? null },
          { key: "timezone", label: "TIME ZONE", value: m?.timezone ?? null },
          { key: "label",    label: "PLACE",     value: m?.label ?? null },
        ]}
      />
    </NodeShell>
  );
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────────
// Lat/lon come from Geocode's sockets or the typed fallbacks; the °C/°F toggle sets the
// API unit and tags the temps downstream. Numeric fields commit on blur/Enter.
const WEATHER_UNIT_OPTIONS: { value: "C" | "F"; label: string }[] = [
  { value: "C", label: "°C" },
  { value: "F", label: "°F" },
];
export function WeatherComponent({ data, emit }: NodeProps<WeatherNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version); // fill the Now rows when a fetch lands
  const [past, setPast] = useState(String(data.pastDays));
  const [fwd, setFwd] = useState(String(data.forecastDays));
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useAutoRefresh(data.id, minutes);

  function commit() {
    const nPast = Math.max(0, Math.min(92, Math.round(Number(past) || 0)));
    const nFwd = Math.max(1, Math.min(16, Math.round(Number(fwd) || 7)));
    setPast(String(nPast)); setFwd(String(nFwd));
    if (nPast !== data.pastDays || nFwd !== data.forecastDays) {
      data.pastDays = nPast; data.forecastDays = nFwd;
      void processGraph();
    }
  }
  const numField = (label: string, val: string, set: (s: string) => void) => (
    <label className="sol-conn__field">
      {label}
      <input
        className="sol-conn__num" type="number" value={val}
        onChange={(e) => set(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
      />
    </label>
  );
  const daily = data.outputs.daily;
  const rows = data.cached ? frameRowCount(data.cached.daily) : 0;

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div className="sol-conn">
        <SegToggle
          value={data.unit}
          options={WEATHER_UNIT_OPTIONS}
          onChange={(u) => { data.unit = u; void processGraph(); }}
        />
      </div>
      {/* Lat/Lon are wireable socket rows — Geocode drives them, or the typed fallback does. */}
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {numField("Past days", past, setPast)}
        {numField("Forecast days", fwd, setFwd)}
        <div className="sol-conn__note">Open-Meteo forecast.</div>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
      </div>
      {daily && (
        <MeasuredSocketRow side="output" socketKey="daily" nodeId={data.id} emit={emit} payload={daily.socket}>
          <span className="solenoid-node__io-label">DAILY</span>
          <span className="solenoid-node__output-value">{rows > 0 ? `${rows} days` : "—"}</span>
        </MeasuredSocketRow>
      )}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "temp",      label: `NOW °${data.unit}`, value: data.cached?.nowTemp ?? null },
          { key: "condition", label: "CONDITION",         value: data.cached?.nowCondition || null },
        ]}
      />
    </NodeShell>
  );
}

// ─── HOLIDAYS ──────────────────────────────────────────────────────────────────────
// A country + year → the year's public holidays. Country is a card dropdown; the year
// and optional region commit on blur/Enter. The Dates output feeds NETWORKDAYS / WORKDAY.
function todaySerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
}

export function HolidaysComponent({ data, emit }: NodeProps<HolidaysNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version); // fill the rows when a fetch lands
  const [year, setYear] = useState(data.year ? String(data.year) : "");
  const [region, setRegion] = useState(data.region);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useEffect(() => { setRegion(data.region); }, [data.region]);
  useAutoRefresh(data.id, minutes);

  function commitYear() {
    const n = Math.max(0, Math.round(Number(year) || 0));
    setYear(n ? String(n) : "");
    if (n !== data.year) { data.year = n; void processGraph(); }
  }
  function commitRegion() {
    const next = region.trim();
    setRegion(next);
    if (next !== data.region) { data.region = next; void processGraph(); }
  }

  const applicable = filterHolidays(data.cached ?? [], data.region);
  const count = applicable.length;
  const next = daysToNextHoliday(applicable, todaySerial());
  const frame = data.outputs.frame;
  const dates = data.outputs.dates;

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div className="sol-conn">
        <LazySelect
          className="sol-conn__select"
          value={data.country}
          title="Country"
          onChange={(e) => { data.country = e.target.value; void processGraph(); }}
        >
          <option value="">Pick a country…</option>
          {NAGER_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </LazySelect>
        <label className="sol-conn__field">
          Year
          <input
            className="sol-conn__num" type="number" value={year} placeholder="This year"
            onChange={(e) => setYear(e.target.value)} onBlur={commitYear}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
          />
        </label>
        <input
          className="sol-conn__url" type="text" value={region} placeholder="Region, for example US-CA (optional)"
          spellCheck={false}
          onChange={(e) => setRegion(e.target.value)} onBlur={commitRegion}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
        />
        <div className="sol-conn__note">Nager.Date public holidays.</div>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
      </div>
      {frame && (
        <MeasuredSocketRow side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frame.socket}>
          <span className="solenoid-node__io-label">HOLIDAYS</span>
          <span className="solenoid-node__output-value">{count > 0 ? `${count} days` : "—"}</span>
        </MeasuredSocketRow>
      )}
      {dates && (
        <MeasuredSocketRow side="output" socketKey="dates" nodeId={data.id} emit={emit} payload={dates.socket}>
          <span className="solenoid-node__io-label">DATES</span>
          <span className="solenoid-node__output-value">{count > 0 ? `${count} dates` : "—"}</span>
        </MeasuredSocketRow>
      )}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[{ key: "next", label: "DAYS TO NEXT", value: next }]}
      />
    </NodeShell>
  );
}

// ─── CURRENCY / FX ─────────────────────────────────────────────────────────────────
// Amount is a wireable number row; From/To are wireable currency dropdowns (a cable
// overrides the pick). The Converted socket carries the target currency downstream.
function CurrencyRow({ data, emit, socketKey, label }: {
  data: FxNodeType; emit: NodeProps<FxNodeType>["emit"]; socketKey: "from" | "to"; label: string;
}) {
  const connected = useConnectedInputs(data.id);
  const incoming = useIncomingSources(data.id);
  const wired = connected.has(socketKey);
  const socket = data.inputs[socketKey]!.socket;
  return (
    <MeasuredSocketRow side="input" socketKey={socketKey} nodeId={data.id} emit={emit} payload={socket}>
      <span className="solenoid-node__io-label">{label}</span>
      {wired ? (
        <span className="solenoid-node__io-wired" title="Driven by the incoming cable named here">↩ {incoming.get(socketKey)?.label || "wired"}</span>
      ) : (
        <LazySelect
          className="sol-conn__select"
          value={data.stringLiterals[socketKey] ?? ""}
          title={label}
          onChange={(e) => { data.stringLiterals[socketKey] = e.target.value; void processGraph(); }}
          {...stopDrag}
        >
          <option value="">Pick…</option>
          {FX_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </LazySelect>
      )}
    </MeasuredSocketRow>
  );
}

export function FxComponent({ data, emit }: NodeProps<FxNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version); // fill rows when a fetch lands
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useAutoRefresh(data.id, minutes);

  const rate = data.cached?.rate ?? null;
  // A preview off the typed amount; the socket carries the true (possibly wired) value.
  const preview = rate != null ? (data.literals.amount ?? 1) * rate : null;

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["amount"]} />
      <CurrencyRow data={data} emit={emit} socketKey="from" label="FROM" />
      <CurrencyRow data={data} emit={emit} socketKey="to" label="TO" />
      <div className="sol-conn">
        <div className="sol-conn__note">Frankfurter: ECB reference rates, once per business day.</div>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
      </div>
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "converted", label: `CONVERTED ${data.stringLiterals.to || ""}`.trim(), value: preview },
          { key: "rate",      label: "RATE",  value: rate },
          { key: "asof",      label: "AS OF", value: data.cached?.date || null },
        ]}
      />
    </NodeShell>
  );
}

// ─── VAULT FOLDER ────────────────────────────────────────────────────────────────
// An Obsidian folder → one cube. The vault is a per-node path (a chip, defaulting from
// Settings ▸ Obsidian); folder / glob / name-format / include-body commit on blur/Enter.
const VAULT_CABLE_ONLY = new Set(["folder", "glob"]);

export function VaultFolderComponent({ data, emit }: NodeProps<VaultFolderNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version); // fill the preview when a read lands
  const vault = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("obsidianVault")); // the one vault
  const connected = useConnectedInputs(data.id);
  const [folder, setFolder] = useState(data.folder);
  const [glob, setGlob] = useState(data.glob);
  const [nameFormat, setNameFormat] = useState(data.nameFormat);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  const [folders, setFolders] = useState<string[]>([]);
  const desktop = isDesktop();
  useAutoRefresh(data.id, minutes);
  // Obsidian saved under this folder → re-read (bundle E; the cadence stays the stopgap).
  useVaultWatch(vault, folder, () => { void refreshConnection(data.id); }, desktop);
  useEffect(() => { setFolder(data.folder); }, [data.folder]);
  // The subfolder dropdown lists the vault's folders (same control as Write to Obsidian).
  useEffect(() => {
    let alive = true;
    void listVaultFolders(vault).then((f) => { if (alive) setFolders(f); });
    return () => { alive = false; };
  }, [vault]);
  function pickFolder(next: string) {
    setFolder(next);
    if (next !== data.folder) { data.folder = next; void processGraph(); }
  }
  function refreshFolders() { void listVaultFolders(vault).then(setFolders); }

  function commitField(next: string, current: string, set: (v: string) => void, apply: (v: string) => void) {
    const v = next.trim();
    set(v);
    if (v !== current) { apply(v); void processGraph(); }
  }

  const cube = data.cached;
  const cols = cube?.columns.map((c) => c.name) ?? [];
  const firstCell = cube?.columns.find((c) => c.name === "path")?.cells[0];
  const openUrl = typeof firstCell === "string" ? obsidianOpenUrl(vault, firstCell) : null;

  return (
    <NodeShell node={data} emit={emit}>
      {/* Wireable folder / glob: the dots + a "wired" tag when a cable drives them, else
          the card controls below stay the editor. */}
      <InlineInputs node={data} emit={emit} keys={["folder", "glob"]} cableOnlyKeys={VAULT_CABLE_ONLY} />
      <div className="sol-conn">
        {!desktop ? (
          <div className="sol-conn__note">Reading a vault is available in the desktop app only.</div>
        ) : (
          <>
            {vault.trim() === "" && <div className="sol-conn__note">Set the Obsidian vault folder in Settings.</div>}
            <div className="sol-conn__vault">
              <div className="sol-conn__note" style={{ flex: 1 }}>Obsidian vault{data.folder ? ` · ${data.folder}` : ""}</div>
              {openUrl && (
                <button
                  type="button" className="sol-conn__refresh" title="Open the first note in Obsidian"
                  onClick={(e) => { e.stopPropagation(); void openExternal(openUrl); }}
                  onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* Lucide "external-link" (ISC). */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <select
                className="sol-conn__select"
                style={{ flex: 1 }}
                value={folder}
                disabled={connected.has("folder")}
                title={connected.has("folder") ? "Driven by the Folder cable" : undefined}
                onChange={(e) => pickFolder(e.target.value)}
                onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
              >
                <option value="">Whole vault</option>
                {/* A previously-picked folder that no longer lists still shows so the
                    selection isn't silently lost. */}
                {folder && !folders.includes(folder) && <option value={folder}>{folder}</option>}
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button
                type="button"
                className="sol-conn__refresh"
                title="Rescan vault folders"
                onClick={(e) => { e.stopPropagation(); refreshFolders(); }}
                onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
              >
                ⟳
              </button>
            </div>
            <input
              className="sol-conn__url" type="text" value={connected.has("glob") ? "" : glob}
              placeholder={connected.has("glob") ? "Driven by the Filter cable" : "Name filter, e.g. 2026-* (optional)"}
              spellCheck={false} disabled={connected.has("glob")}
              onChange={(e) => setGlob(e.target.value)}
              onBlur={(e) => commitField(e.target.value, data.glob, setGlob, (v) => { data.glob = v; })}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
            />
            <input
              className="sol-conn__url" type="text" value={nameFormat} placeholder="Date-from-name, e.g. YYYY-MM-DD (auto)" spellCheck={false}
              onChange={(e) => setNameFormat(e.target.value)}
              onBlur={(e) => commitField(e.target.value, data.nameFormat, setNameFormat, (v) => { data.nameFormat = v; })}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
            />
            <label className="sol-conn__field" title="Add a body column with each note's markdown">
              <input
                type="checkbox" checked={data.includeBody}
                onChange={(e) => { data.includeBody = e.target.checked; void processGraph(); }}
                onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
              />
              Include body
            </label>
            <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
            <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
            {cols.length > 0 && (
              <div className="sol-conn__preview" title={`${cols.length} columns`}>
                {cols.slice(0, 6).map((c, i) => <div key={i} className="sol-conn__preview-row">{c}</div>)}
                {cols.length > 6 && <div className="sol-conn__preview-more">+{cols.length - 6} more</div>}
              </div>
            )}
          </>
        )}
      </div>
    </NodeShell>
  );
}

// ─── TASKNOTES ────────────────────────────────────────────────────────────────────
// The Obsidian plugin's local HTTP API. Provider select reshapes the sockets (Tasks → a
// cube; Calendar → From/To + an events frame; Stats → five counts); the bearer token
// lives in apiKeyStore like the Data Feed keys, the URL in Settings ▸ Obsidian.
export function TaskNotesComponent({ data, emit }: NodeProps<TaskNotesNodeType>) {
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version);
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  const [provider, setProvider] = useState<TaskNotesProvider>(data.provider);
  const [token, setToken] = useState(apiKeyStore.get(TASKNOTES_KEY_ID));
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  useEffect(() => { setProvider(data.provider); }, [data.provider]);
  useAutoRefresh(data.id, minutes);

  async function pickProvider(next: TaskNotesProvider) {
    if (next === data.provider) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.inputs.length > 0) await dropInputCables(data.id, departing.inputs);
    if (departing.outputs.length > 0) await dropStrandedFrontmatterCables(data.id, departing.outputs, []);
    data.setProvider(next);
    setProvider(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }
  function commitToken() {
    if (token.trim() !== apiKeyStore.get(TASKNOTES_KEY_ID)) {
      apiKeyStore.set(TASKNOTES_KEY_ID, token);
      void refreshConnection(data.id);
    }
  }

  const tasks = data.outputs.tasks;
  const events = data.outputs.events;
  const stats = data.outputs.stats;
  const s = data.cachedStats;
  const eventRows = data.cachedEvents ? frameRowCount(data.cachedEvents) : 0;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <div className="sol-conn">
        <LazySelect
          className="sol-conn__select"
          value={provider}
          title="What to read"
          onChange={(e) => void pickProvider(e.target.value as TaskNotesProvider)}
        >
          {(Object.keys(TASKNOTES_PROVIDER_META) as TaskNotesProvider[]).map((k) => (
            <option key={k} value={k} title={TASKNOTES_PROVIDER_META[k].description}>{TASKNOTES_PROVIDER_META[k].label}</option>
          ))}
        </LazySelect>
      </div>
      {provider === "calendar" && <InlineInputs node={data} emit={emit} />}
      <div className="sol-conn">
        <input
          className="sol-conn__url"
          type="password"
          value={token}
          placeholder="API token"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          onBlur={commitToken}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div className="sol-conn__note">TaskNotes plugin, local HTTP API.</div>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
      </div>
      {tasks && (
        <MeasuredSocketRow side="output" socketKey="tasks" nodeId={data.id} emit={emit} payload={tasks.socket}>
          <span className="solenoid-node__io-label">TASKS</span>
          <span className="solenoid-node__output-value">{data.cachedTasks ? `${data.cachedTasks.length} task${data.cachedTasks.length === 1 ? "" : "s"}` : "—"}</span>
        </MeasuredSocketRow>
      )}
      {events && (
        <MeasuredSocketRow side="output" socketKey="events" nodeId={data.id} emit={emit} payload={events.socket}>
          <span className="solenoid-node__io-label">EVENTS</span>
          <span className="solenoid-node__output-value">{data.cachedEvents ? `${eventRows} event${eventRows === 1 ? "" : "s"}` : "—"}</span>
        </MeasuredSocketRow>
      )}
      {stats && (
        <MeasuredSocketRow side="output" socketKey="stats" nodeId={data.id} emit={emit} payload={stats.socket}>
          <span className="solenoid-node__io-label">STATS</span>
          <span className="solenoid-node__output-value">{s ? `${s.total ?? 0} task${s.total === 1 ? "" : "s"}` : "—"}</span>
        </MeasuredSocketRow>
      )}
      {provider === "stats" && s && <FrameDisplay frame={statsToFrame(s)} label="Stats" />}
    </NodeShell>
  );
}
