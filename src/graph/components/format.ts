// [[C94]] formatFamilyGates
// |n| ≥ 1e12 (as Excel's General does) or a nonzero |n| < 1e-4, where fixed decimals would lie as "0.0000".
export function extremeSci(n: number): string | null {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return null;
  if (a >= 1e12 || (a > 0 && a < 1e-4)) return n.toExponential(4).replace(/\.?0+e/, "e");
  return null;
}

/** The one display of a number nobody formatted, the Format Controller's General (`auto`) style ([[D94]] oneNumberDisplay): an integer as it is, anything else to 6 significant digits with trailing zeros dropped, extremes in scientific. */
export function formatScalar(n: number): string {
  // A throw during React render blacks out the app: a display formatter degrades.
  if (typeof n !== "number") return n == null ? "" : String(n);
  // A residual NaN is dirty data; `#N/A` is a real tagged error, so never label it so.
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const sci = extremeSci(n);
  if (sci !== null) return sci;
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toPrecision(6)).toString();
}
