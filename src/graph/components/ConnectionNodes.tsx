import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  WebSourceNode as WebSourceNodeType,
  LocalFileNode as LocalFileNodeType,
  ImportHtmlNode as ImportHtmlNodeType,
  ImportXmlNode as ImportXmlNodeType,
  DataFeedNode as DataFeedNodeType,
  GeocodeNode as GeocodeNodeType,
  WeatherNode as WeatherNodeType,
} from "../rete-nodes";
import { processGraph } from "../process";
import { connectionStore, refreshConnection, type ConnectionState } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, listLocalFiles } from "../fileBridge";
import { apiKeyStore } from "../apiKeyStore";
import { PROVIDER_LIST, getProvider, type ProviderId } from "../dataProviders";
import { FrameDisplay } from "./FrameDisplay";
import { LazySelect } from "./LazySelect";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { RefreshIcon } from "./RefreshIcon";
import "./ConnectionNodes.css";
import { stopDragStart } from "../coarse";
import { nodeDisplayName } from "../catalogUtils";
import { pickGeocodeMatch } from "../geocodeProvider";
import { frameRowCount } from "../frame";

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

  return (
    <NodeShell node={data} emit={emit}>
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
        <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
      </div>
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
        <LazySelect
          className="sol-conn__select"
          value={data.unit}
          title="Temperature unit"
          onChange={(e) => { data.unit = e.target.value === "F" ? "F" : "C"; void processGraph(); }}
        >
          <option value="C">°C</option>
          <option value="F">°F</option>
        </LazySelect>
      </div>
      {/* Lat/Lon are wireable socket rows — Geocode drives them, or the typed fallback does. */}
      <InlineInputs node={data} emit={emit} />
      <div className="sol-conn">
        {numField("Past days", past, setPast)}
        {numField("Forecast days", fwd, setFwd)}
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
