// Provider presets for the Finance/Data connection node (E-2). ONE node family with
// a provider dropdown, not N bespoke nodes: each preset knows how to build its fetch
// URL from the user's input (+ an API key where needed) and how to parse the response
// into a Frame. Pure + side-effect-free so it unit-tests without the network — the
// node layer wires these to httpBridge + apiKeyStore + connectionStore.
import { frameFromColumnar, type FrameValue } from "./frame";
import { csvToFrame } from "./nodes/connection";

export type ProviderId = "fred" | "stooq" | "alphavantage";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Whether a stored API key is required before a fetch can run. */
  needsKey: boolean;
  /** apiKeyStore provider id (only set when needsKey). */
  keyProvider?: string;
  /** Where to get a free key (shown in the node's "add key" state). */
  keyUrl?: string;
  inputLabel: string;
  placeholder: string;
  /** Build the fetch URL from the trimmed user input and (optional) key. */
  buildUrl(input: string, key: string): string;
  /** Parse the fetched text into a Frame. */
  parse(text: string): FrameValue;
}

/** FRED returns `{observations: [{date, value}, …]}` with value "." for a gap —
 *  reduce it to a two-column date/value frame (gaps → missing). Kept for the keyed
 *  API path (not the default). */
export function parseFredObservations(text: string): FrameValue {
  const data = JSON.parse(text) as { observations?: Array<{ date?: string; value?: string }> };
  const obs = data.observations ?? [];
  const date = obs.map((o) => o.date ?? "");
  const value = obs.map((o) => {
    const v = o.value ?? "";
    if (v === "." || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
  return frameFromColumnar({ date, value });
}

/** The KEYLESS FRED route: `fredgraph.csv?id=SERIES` returns a 2-column CSV
 *  (`observation_date,SERIES_ID`) with `.` for a gap. Parse it directly (csvToFrame
 *  would turn the whole column to text on the first `.`), keeping the real column
 *  names (so the value column is named after the series) and mapping gaps → missing. */
export function parseFredCsv(text: string): FrameValue {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  const header = (lines[0] ?? "date,value").split(",");
  const dateCol = header[0]?.trim() || "date";
  const valCol = header[1]?.trim() || "value";
  const date: string[] = [];
  const value: (number | null)[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const d = cells[0]?.trim();
    if (!d) continue;
    date.push(d);
    const raw = cells[1]?.trim();
    const n = raw === undefined || raw === "" || raw === "." ? NaN : Number(raw);
    value.push(Number.isFinite(n) ? n : null);
  }
  return frameFromColumnar({ [dateCol]: date, [valCol]: value });
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  fred: {
    id: "fred",
    // KEYLESS by default via the public fredgraph.csv download — works out of the box.
    label: "FRED — economic series (no key)",
    needsKey: false,
    inputLabel: "Series ID",
    placeholder: "e.g. UNRATE, CPIAUCSL, GDP",
    buildUrl: (id) =>
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id.trim())}`,
    parse: parseFredCsv,
  },
  stooq: {
    id: "stooq",
    label: "Stooq — stocks (no key)",
    needsKey: false,
    inputLabel: "Ticker",
    placeholder: "e.g. aapl.us, ^spx, eurusd",
    // Daily OHLC CSV: Date,Open,High,Low,Close,Volume. Tickers are lower-case.
    buildUrl: (t) => `https://stooq.com/q/d/l/?s=${encodeURIComponent(t.trim().toLowerCase())}&i=d`,
    parse: csvToFrame,
  },
  alphavantage: {
    id: "alphavantage",
    label: "Alpha Vantage — stocks",
    needsKey: true,
    keyProvider: "alphavantage",
    keyUrl: "https://www.alphavantage.co/support/#api-key",
    inputLabel: "Symbol",
    placeholder: "e.g. AAPL, MSFT",
    // datatype=csv keeps parsing on the shared csvToFrame path (no bespoke JSON shape).
    buildUrl: (s, key) =>
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(s.trim())}&outputsize=compact&datatype=csv&apikey=${encodeURIComponent(key)}`,
    parse: csvToFrame,
  },
};

export const PROVIDER_LIST: ProviderPreset[] = Object.values(PROVIDERS);

/** Common FRED series — the ids are cryptic, so the node offers these as quick-picks
 *  that fill the Series ID field (you can still type any id). */
export const FRED_QUICK_PICKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "UNRATE", label: "Unemployment rate" },
  { id: "CPIAUCSL", label: "CPI (inflation)" },
  { id: "GDPC1", label: "Real GDP" },
  { id: "FEDFUNDS", label: "Fed funds rate" },
  { id: "DGS10", label: "10-yr Treasury yield" },
  { id: "T10Y2Y", label: "10yr–2yr spread" },
  { id: "MORTGAGE30US", label: "30-yr mortgage rate" },
  { id: "SP500", label: "S&P 500" },
];

export function getProvider(id: string): ProviderPreset {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS.fred;
}
