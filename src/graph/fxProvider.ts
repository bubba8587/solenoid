// Frankfurter (ECB reference rates, keyless + CORS-open, ~30 currencies, updated once
// per business day). The URL build + PARSE are pure and fixture-tested (widget rule 5);
// the node owns the fetch/cache and authors the target-currency unit on its output.
import { type Unit } from "./dimension";
import { registerDisplayUnits } from "./unitBridge";
import { parseDateToSerial } from "./nodes/dateSerial";

export interface Currency { code: string; name: string; }

// Frankfurter's /currencies (captured 2026-09-06) — the bundled picker list; a fetch
// would spend a call on a set that turns over about never.
const CURRENCY_TSV = `AUD Australian Dollar
BRL Brazilian Real
CAD Canadian Dollar
CHF Swiss Franc
CNY Chinese Renminbi Yuan
CZK Czech Koruna
DKK Danish Krone
EUR Euro
GBP British Pound
HKD Hong Kong Dollar
HUF Hungarian Forint
IDR Indonesian Rupiah
ILS Israeli New Shekel
INR Indian Rupee
ISK Icelandic Króna
JPY Japanese Yen
KRW South Korean Won
MXN Mexican Peso
MYR Malaysian Ringgit
NOK Norwegian Krone
NZD New Zealand Dollar
PHP Philippine Peso
PLN Polish Złoty
RON Romanian Leu
SEK Swedish Krona
SGD Singapore Dollar
THB Thai Baht
TRY Turkish Lira
USD United States Dollar
ZAR South African Rand`;

export const FX_CURRENCIES: Currency[] = CURRENCY_TSV.trim().split("\n").map((line) => {
  const i = line.indexOf(" ");
  return { code: line.slice(0, i), name: line.slice(i + 1) };
});

// Register every code as a currency-dimension display unit, so applyFcUnit(value, code)
// authors a tagged cell AND the display id resolves at render — the same requirement
// Convert unit ids carry (unitFlow: an unregistered author id falls back to the base-SI
// symbol). usd/eur/gbp/jpy already ship in unitBridge; re-registering is harmless.
const CURRENCY_UNIT: Unit = { dim: { currency: 1 }, scale: 1 };
registerDisplayUnits(Object.fromEntries(FX_CURRENCIES.map((c) => [c.code.toLowerCase(), CURRENCY_UNIT])));

/** The latest-rate endpoint for one From→To pair. */
export function fxLatestUrl(from: string, to: string): string {
  const f = encodeURIComponent(from.trim().toUpperCase());
  const t = encodeURIComponent(to.trim().toUpperCase());
  return `https://api.frankfurter.dev/v1/latest?base=${f}&symbols=${t}`;
}

export interface FxRate {
  /** The rate's as-of date as an ISO string ("" when absent). */
  date: string;
  /** The as-of date as an Excel serial (NaN when absent). */
  serial: number;
  /** Units of `to` per one `from`, or null when the response lacks it. */
  rate: number | null;
}

/** Parse the latest-rate response, pulling out the `to` rate. A malformed body → a null
 *  rate. Frankfurter's date is machine ISO (YYYY-MM-DD), never ambiguous. */
export function parseFxRate(text: string, to: string): FxRate {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { date: "", serial: NaN, rate: null }; }
  const o = (data ?? {}) as { date?: unknown; rates?: Record<string, unknown> };
  const date = typeof o.date === "string" ? o.date : "";
  const r = o.rates?.[to.trim().toUpperCase()];
  return { date, serial: date ? parseDateToSerial(date) : NaN, rate: typeof r === "number" ? r : null };
}

/** The time-series endpoint for one From→To pair over an inclusive date range (ISO
 *  YYYY-MM-DD). Frankfurter: `/v1/{start}..{end}?base=X&symbols=Y`. */
export function fxRangeUrl(from: string, to: string, start: string, end: string): string {
  const f = encodeURIComponent(from.trim().toUpperCase());
  const t = encodeURIComponent(to.trim().toUpperCase());
  return `https://api.frankfurter.dev/v1/${start}..${end}?base=${f}&symbols=${t}`;
}

/** One day of the time series. */
export interface FxPoint { date: string; serial: number; rate: number; }

/** Parse the time-series response into rows sorted by date, pulling each day's `to`
 *  rate. Days without the rate (weekends/holidays have no entry) and a malformed body
 *  yield an empty run rather than gaps of null. */
export function parseFxSeries(text: string, to: string): FxPoint[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const rates = (data as { rates?: Record<string, unknown> } | null)?.rates;
  if (!rates || typeof rates !== "object") return [];
  const sym = to.trim().toUpperCase();
  const out: FxPoint[] = [];
  for (const [date, day] of Object.entries(rates)) {
    const r = (day as Record<string, unknown> | null)?.[sym];
    if (typeof r === "number") out.push({ date, serial: parseDateToSerial(date), rate: r });
  }
  return out.sort((a, b) => a.serial - b.serial);
}
