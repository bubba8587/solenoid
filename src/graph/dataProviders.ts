// Provider presets for the Data connection node. Must stay pure + side-effect-free
// so they unit-test without the network.
import { frameFromColumnar, type FrameValue } from "./frame";
import { csvToFrame } from "./nodes/connection";

export type ProviderId = "fred" | "alphavantage";

/** Per-fetch refinements folded into the URL; all are in the cache key, so
 *  changing any of them re-fetches. */
export type DataFeedOpts = { start?: string; end?: string; freq?: string };

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
  /** Show start/end date fields — only when the provider filters by date in-URL. */
  supportsDateRange?: boolean;
  /** Frequency options (undefined/[] = no control); `value: ""` = the provider's
   *  own default. */
  frequencies?: ReadonlyArray<{ value: string; label: string }>;
  /** Symbol/series quick-picks that fill the input field (the ids are cryptic). */
  quickPicks?: ReadonlyArray<{ id: string; label: string }>;
  /** Build the fetch URL from the trimmed user input, (optional) key + refinements. */
  buildUrl(input: string, key: string, opts?: DataFeedOpts): string;
  /** Parse the fetched text into a Frame. */
  parse(text: string): FrameValue;
}

/** FRED's keyed JSON route: `{observations: […]}` with "." for a gap → a
 *  two-column date/value frame. */
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

/** The KEYLESS FRED route (`fredgraph.csv`) is parsed here rather than through
 *  csvToFrame, which would turn the whole column to text on the first `.` gap. */
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

/** Quick-picks that fill the Series ID field; any id can still be typed. */
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

/** The same quick-fill for stocks/ETFs. */
export const AV_QUICK_PICKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "AAPL", label: "Apple" },
  { id: "MSFT", label: "Microsoft" },
  { id: "GOOGL", label: "Alphabet" },
  { id: "AMZN", label: "Amazon" },
  { id: "NVDA", label: "NVIDIA" },
  { id: "TSLA", label: "Tesla" },
  { id: "SPY", label: "S&P 500 ETF" },
];

// FRED aggregates in-URL (fq/fam); AV uses separate TIME_SERIES_* functions.
const FRED_FREQUENCIES = [
  { value: "", label: "As published" },
  { value: "Daily", label: "Daily" },
  { value: "Weekly", label: "Weekly" },
  { value: "Monthly", label: "Monthly" },
  { value: "Quarterly", label: "Quarterly" },
  { value: "Annual", label: "Annual" },
] as const;
const AV_FREQUENCIES = [
  { value: "", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  fred: {
    id: "fred",
    // KEYLESS by default via the public fredgraph.csv download — works out of the box.
    label: "FRED economic series, no key needed",
    needsKey: false,
    inputLabel: "Series ID",
    placeholder: "e.g. UNRATE, CPIAUCSL, GDP",
    supportsDateRange: true,
    frequencies: FRED_FREQUENCIES,
    quickPicks: FRED_QUICK_PICKS,
    buildUrl: (id, _key, opts) => {
      const p = new URLSearchParams({ id: id.trim() });
      if (opts?.start) p.set("cosd", opts.start); // observation start date
      if (opts?.end) p.set("coed", opts.end); // observation end date
      if (opts?.freq) { p.set("fq", opts.freq); p.set("fam", "avg"); } // aggregate: mean
      return `https://fred.stlouisfed.org/graph/fredgraph.csv?${p.toString()}`;
    },
    parse: parseFredCsv,
  },
  alphavantage: {
    id: "alphavantage",
    label: "Alpha Vantage stocks",
    needsKey: true,
    keyProvider: "alphavantage",
    keyUrl: "https://www.alphavantage.co/support/#api-key",
    inputLabel: "Symbol",
    placeholder: "e.g. AAPL, MSFT",
    // No URL date filter on AV's time-series endpoints — frequency only (via function).
    frequencies: AV_FREQUENCIES,
    quickPicks: AV_QUICK_PICKS,
    // datatype=csv keeps parsing on the shared csvToFrame path (no bespoke JSON shape).
    buildUrl: (s, key, opts) => {
      const fn = opts?.freq === "weekly" ? "TIME_SERIES_WEEKLY"
        : opts?.freq === "monthly" ? "TIME_SERIES_MONTHLY"
        : "TIME_SERIES_DAILY";
      // Weekly/monthly return full history already; daily stays compact (100 pts).
      const size = fn === "TIME_SERIES_DAILY" ? "&outputsize=compact" : "";
      return `https://www.alphavantage.co/query?function=${fn}&symbol=${encodeURIComponent(s.trim())}${size}&datatype=csv&apikey=${encodeURIComponent(key)}`;
    },
    parse: csvToFrame,
  },
};

export const PROVIDER_LIST: ProviderPreset[] = Object.values(PROVIDERS);

export function getProvider(id: string): ProviderPreset {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS.fred;
}
