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
 *  reduce it to a two-column date/value frame (gaps → missing). */
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

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  fred: {
    id: "fred",
    label: "FRED — economic series",
    needsKey: true,
    keyProvider: "fred",
    keyUrl: "https://fredaccount.stlouisfed.org/apikeys",
    inputLabel: "Series ID",
    placeholder: "e.g. GDP, UNRATE, CPIAUCSL",
    buildUrl: (id, key) =>
      `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id.trim())}&api_key=${encodeURIComponent(key)}&file_type=json`,
    parse: parseFredObservations,
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

export function getProvider(id: string): ProviderPreset {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS.fred;
}
