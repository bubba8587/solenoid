// ONE scientific-notation rule for every display surface: |n| ≥ 1e12 (as Excel's
// General does) or a nonzero |n| < 1e-4, where fixed decimals lie as "0.0000".
export function extremeSci(n: number): string | null {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return null;
  if (a >= 1e12 || (a > 0 && a < 1e-4)) return n.toExponential(4).replace(/\.?0+e/, "e");
  return null;
}

export function formatScalar(n: number): string {
  // A throw during React render blacks out the app: a display formatter degrades.
  if (typeof n !== "number") return n == null ? "" : String(n);
  // A residual NaN is DIRTY DATA: `#N/A` is a real tagged error, so never label it so.
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const sci = extremeSci(n);
  if (sci !== null) return sci;
  return Number.isInteger(n) ? n.toString() : n.toFixed(4);
}

export function listPreview(arr: number[]): string {
  if (arr.length === 0) return "[ ]";
  const p = arr.slice(0, 4).map((n) =>
    Number.isNaN(n) ? "NaN"
      : !Number.isFinite(n) ? (n > 0 ? "∞" : "-∞")
      : Number.isInteger(n) ? n.toString() : n.toFixed(2),
  );
  return `[${p.join(", ")}${arr.length > 4 ? ", …" : ""}]  (${arr.length})`;
}
