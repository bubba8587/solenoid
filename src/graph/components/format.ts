// [[C118]] formatTravelsWithValue
import { settingsStore } from "../settingsStore";
import { coreFormatScalar, setCoreDisplaySettings, whenWasmEngineLoads } from "../engineWasm";

/** The decimal places an unformatted number shows, the "Decimal places" setting ([[C118]] formatTravelsWithValue). */
export function displayDecimals(): number {
  const d = Number(settingsStore.get("numberDecimals"));
  return Number.isInteger(d) && d >= 0 ? d : 4;
}

/** The one key both display settings change, so a store can redraw on either. */
export function displaySettingsKey(): string {
  return `${settingsStore.get("numberDecimals")}|${settingsStore.get("sciAbove")}`;
}

// The core formats by both settings; it hears them on load, after a trap and on every change.
const pushDisplaySettings = () => setCoreDisplaySettings(Number(settingsStore.get("numberDecimals")), String(settingsStore.get("sciAbove")));
whenWasmEngineLoads(pushDisplaySettings);
settingsStore.subscribe(pushDisplaySettings);

/** The one display of a number nobody formatted, the Format Controller's General (`auto`) style ([[C118]] formatTravelsWithValue): an integer as it is, anything else to the "Decimal places" setting with trailing zeros dropped, extremes in scientific. */
export function formatScalar(n: number): string {
  // A throw during React render blacks out the app: a display formatter degrades.
  if (typeof n !== "number") return n == null ? "" : String(n);
  return coreFormatScalar(n);
}
