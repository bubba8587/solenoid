// [[C118]] formatTravelsWithValue
import { settingsStore } from "../settingsStore";

/** The decimal places an unformatted number shows, the "Decimal places" setting ([[D94]] oneNumberDisplay). */
export function displayDecimals(): number {
  const d = Number(settingsStore.get("numberDecimals"));
  return Number.isInteger(d) && d >= 0 ? d : 4;
}

/** The size at which an unformatted number turns scientific, the "Scientific from" setting; Infinity when it is off. */
export function sciThreshold(): number {
  const s = settingsStore.get("sciAbove");
  const p = Number(s);
  return s === "off" ? Infinity : Number.isInteger(p) ? 10 ** p : 1e9;
}

/** The one key both display settings change, so a store can redraw on either. */
export function displaySettingsKey(): string {
  return `${settingsStore.get("numberDecimals")}|${settingsStore.get("sciAbove")}`;
}

// |n| at or past the "Scientific from" setting, or a nonzero |n| below the smallest shown decimal, where fixed decimals would lie as "0".
export function extremeSci(n: number, decimals = displayDecimals()): string | null {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return null;
  if (a >= sciThreshold() || (a > 0 && a < 10 ** -decimals)) return n.toExponential(4).replace(/\.?0+e/, "e");
  return null;
}

/** The one display of a number nobody formatted, the Format Controller's General (`auto`) style ([[D94]] oneNumberDisplay): an integer as it is, anything else to the "Decimal places" setting with trailing zeros dropped, extremes in scientific. */
export function formatScalar(n: number): string {
  // A throw during React render blacks out the app: a display formatter degrades.
  if (typeof n !== "number") return n == null ? "" : String(n);
  // A residual NaN is dirty data; `#N/A` is a real tagged error, so never label it so.
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const decimals = displayDecimals();
  const sci = extremeSci(n, decimals);
  if (sci !== null) return sci;
  if (Number.isInteger(n)) return n.toString();
  const s = n.toFixed(decimals).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}
