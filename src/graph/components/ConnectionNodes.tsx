import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  WebSourceNode as WebSourceNodeType,
  CsvConnectionNode as CsvConnectionNodeType,
  ParquetConnectionNode as ParquetConnectionNodeType,
  ImportHtmlNode as ImportHtmlNodeType,
  ImportXmlNode as ImportXmlNodeType,
  DataFeedNode as DataFeedNodeType,
} from "../rete-nodes";
import { processGraph } from "../process";
import { connectionStore, refreshConnection, type ConnectionState } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { isDesktop, listCsvFiles, listParquetFiles } from "../fileBridge";
import { apiKeyStore } from "../apiKeyStore";
import { PROVIDER_LIST, getProvider, type ProviderId } from "../dataProviders";
import { FrameDisplay } from "./FrameDisplay";
import { LazySelect } from "./LazySelect";
import { NodeShell, type NodeProps } from "./nodeKit";
import "./ConnectionNodes.css";

// Status line shown under a connection node's reference field: a colored dot +
// a short summary (or the error). Reads the shared connectionStore.
function statusText(s: ConnectionState): string {
  switch (s.status) {
    case "loading": return "Loading…";
    case "error":   return s.message || "Failed";
    case "ok":      return `${s.rows ?? 0}×${s.cols ?? 0}${s.fetchedAt ? ` · ${new Date(s.fetchedAt).toLocaleTimeString()}` : ""}`;
    default:        return "Not connected";
  }
}

// Tier 2 live-data: an optional per-node "refresh every N minutes" timer that
// calls the exact same refreshConnection(id) a manual click does — so a source
// backed by an interval and one backed by a click are indistinguishable to the
// rest of the graph (same token bump, same processGraph recompute, so anything
// downstream — including an Alert's edge-detect — reacts identically).
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
    <label className="sol-conn__field" title="Automatically refresh on this cadence; 0 turns it off">
      Auto-refresh (min)
      <input
        className="sol-conn__num"
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onPointerDown={(e) => e.stopPropagation()}
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
      <span className={`sol-conn__dot sol-conn__dot--${s.status}`} />
      <span className="sol-conn__status-text" title={s.status === "error" ? s.message : undefined}>
        {statusText(s)}
      </span>
      <button
        type="button"
        className="sol-conn__refresh"
        title="Refresh this connection"
        disabled={s.status === "loading"}
        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Lucide "refresh-cw" (ISC) — an icon, not a font glyph. */}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </button>
    </div>
  );
}

// ─── WEB SOURCE ─────────────────────────────────────────────────────────────────
// A URL → numeric Frame. The URL field commits on blur/Enter (not per keystroke)
// so typing never fires a fetch; committing changes the cache key and the node's
// async data() re-fetches on the next recompute.

export function WebSourceComponent({ data, emit }: NodeProps<WebSourceNodeType>) {
  const [url, setUrl] = useState(data.url);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  // Mirror external changes to the field (e.g. load / paste).
  useEffect(() => { setUrl(data.url); }, [data.url]);
  useAutoRefresh(data.id, minutes);

  function commit() {
    const next = url.trim();
    if (next !== data.url) { data.url = next; void processGraph(); }
  }

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Web Source">
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
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <RefreshIntervalField minutes={minutes} onCommit={(n) => { data.refreshMinutes = n; setMinutes(n); }} />
        <FrameDisplay frame={data.cachedResult} label={data.label} />
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
    <NodeShell node={data} emit={emit} labelPlaceholder="Import HTML">
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
          onPointerDown={(e) => e.stopPropagation()}
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
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </label>
        <ConnectionStatusRow nodeId={data.id} onRefresh={() => void refreshConnection(data.id)} />
        <FrameDisplay frame={data.cachedResult} label={data.label} />
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
    <NodeShell node={data} emit={emit} labelPlaceholder="Import XML">
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
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <input
          className="sol-conn__url"
          type="text"
          value={query}
          placeholder='XPath, e.g. //h2/a'
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onPointerDown={(e) => e.stopPropagation()}
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
// Pick a .csv from the Settings target folder. The dropdown is populated by
// listing the folder; the node reads the chosen file on refresh. Desktop only —
// the browser build shows a note instead (no filesystem). Native <LazySelect> needs
// pointerdown/mousedown stopPropagation so the node-drag re-render doesn't close
// the OS dropdown mid-pick (see CLAUDE.md).

export function CsvConnectionComponent({ data, emit }: NodeProps<CsvConnectionNodeType>) {
  const folder = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("csvFolder"));
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState(data.fileName);
  const [minutes, setMinutes] = useState(data.refreshMinutes);
  const desktop = isDesktop();
  useAutoRefresh(data.id, minutes);

  // (Re)list the folder's CSVs whenever the target folder changes.
  useEffect(() => {
    let alive = true;
    listCsvFiles(folder).then((fs) => { if (alive) setFiles(fs); }).catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, [folder]);

  useEffect(() => { setName(data.fileName); }, [data.fileName]);

  function pick(next: string) {
    setName(next);
    data.fileName = next;
    void processGraph();
  }

  function refresh() {
    // Re-scan the folder (a new file may have appeared) and re-read.
    listCsvFiles(folder).then(setFiles).catch(() => setFiles([]));
    void refreshConnection(data.id);
  }

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="CSV File">
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
        <FrameDisplay frame={data.cachedResult} label={data.label} />
      </div>
    </NodeShell>
  );
}

// ─── DATA FEED (Finance / economic data) ────────────────────────────────────────
// A provider dropdown (FRED / Stooq / Alpha Vantage) + a series/ticker field → a
// Frame. FRED is KEYLESS (public fredgraph.csv) and offers common-series quick-picks;
// stocks are keyless via Stooq (Alpha Vantage is the keyed backup). Wire the frame
// into a Chart node to "embed a FRED graph" natively. Same fetch/cache/refresh shape
// as the other connection nodes (data() stays sync; one background fetch per key).

const stopDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

export function DataFeedComponent({ data, emit }: NodeProps<DataFeedNodeType>) {
  // Re-render when a key is added/removed so the "add key" note + fetch-ability update.
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
    // Refinements are provider-specific (a FRED frequency word isn't an AV one) — reset
    // them on a provider switch so a stale value can't build a bad URL for the new one.
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
    <NodeShell node={data} emit={emit} labelPlaceholder="Data Feed">
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
        <FrameDisplay frame={data.cachedResult} label={data.label} />
      </div>
    </NodeShell>
  );
}

// ─── PARQUET CONNECTION (local folder, native engine read) ──────────────────────
// Same folder-picker shape as CSV Connection, but the read never touches JS — the
// file goes straight from disk into the Rust engine, so typed columns arrive
// intact (no CSV-style inference step).

export function ParquetConnectionComponent({ data, emit }: NodeProps<ParquetConnectionNodeType>) {
  const folder = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("csvFolder"));
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState(data.fileName);
  const desktop = isDesktop();

  useEffect(() => {
    let alive = true;
    listParquetFiles(folder).then((fs) => { if (alive) setFiles(fs); }).catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, [folder]);

  useEffect(() => { setName(data.fileName); }, [data.fileName]);

  function pick(next: string) {
    setName(next);
    data.fileName = next;
    void processGraph();
  }

  function refresh() {
    listParquetFiles(folder).then(setFiles).catch(() => setFiles([]));
    void refreshConnection(data.id);
  }

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Parquet File">
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
        <FrameDisplay frame={data.cachedResult} label={data.label} />
      </div>
    </NodeShell>
  );
}
