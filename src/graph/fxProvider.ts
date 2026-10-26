// [[C51]] formulaNaming
// Frankfurter (ECB reference rates, keyless, CORS-open). The node owns fetch and cache; the core reads the reply.
import { frameFnOnCore } from "./frameBackend";
import type { FrameValue } from "./frame";

export interface Currency { code: string; name: string; }

// A bundled copy of Frankfurter's /currencies, so the picker spends no call on a list that almost never changes.
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

/** The reply read on the core (`providers.rs`); a malformed body gives a null rate. */
export function parseFxRate(text: string, to: string): FxRate {
  const r = frameFnOnCore("fxRate", [], [text, to]);
  const [date, serial, rate] = (r && !("frame" in r) ? r.value : ["", NaN, null]) as [string, number | null, number | null];
  return { date, serial: serial ?? NaN, rate };
}

export function fxRangeUrl(from: string, to: string, start: string, end: string): string {
  const f = encodeURIComponent(from.trim().toUpperCase());
  const t = encodeURIComponent(to.trim().toUpperCase());
  return `https://api.frankfurter.dev/v1/${start}..${end}?base=${f}&symbols=${t}`;
}

/** A Date and a Rate column, by date, read on the core (`providers.rs`); a day with no rate gives no row. */
export function parseFxSeries(text: string, to: string): FrameValue {
  const r = frameFnOnCore("fxSeries", [], [text, to]);
  return r && "frame" in r ? r.frame : fxSeriesFrame();
}

/** The history's empty frame, before any reply. */
export function fxSeriesFrame(): FrameValue {
  return { __frame: true, columns: [{ name: "Date", type: "date", values: [] }, { name: "Rate", type: "number", values: [] }] };
}
