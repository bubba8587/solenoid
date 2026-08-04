// Shared display formatting for node output values.

// Forced scientific past the readable range: |n| ≥ 1e12 (Excel's General format
// flips to scientific at 12 digits too) or a nonzero |n| < 1e-4 (where fixed
// decimals lie as "0.0000"). ONE rule shared by the hero box (formatScalar), the
// matrix viewer (TableDisplay), the frame popup's auto format, and chip previews
// — so a tan() spike reads 1.6331e+16 everywhere, not a 17-digit wall.
export function extremeSci(n: number): string | null {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return null;
  if (a >= 1e12 || (a > 0 && a < 1e-4)) return n.toExponential(4).replace(/\.?0+e/, "e");
  return null;
}

export function formatScalar(n: number): string {
  // A non-number reaching here would throw on `.toFixed`, and a throw during
  // React render blacks out the whole app. A display formatter must degrade,
  // never crash.
  if (typeof n !== "number") return n == null ? "" : String(n);
  // A residual NaN is DIRTY DATA, not an error: `#N/A` is a real catchable
  // tagged error, so NaN must NOT be labeled "N/A".
  if (Number.isNaN(n)) return "NaN";
  const sci = extremeSci(n);
  if (sci !== null) return sci;
  return Number.isInteger(n) ? n.toString() : n.toFixed(4);
}

export function listPreview(arr: number[]): string {
  if (arr.length === 0) return "[ ]";
  const p = arr.slice(0, 4).map((n) =>
    Number.isNaN(n) ? "NaN" : Number.isInteger(n) ? n.toString() : n.toFixed(2),
  );
  return `[${p.join(", ")}${arr.length > 4 ? ", …" : ""}]  (${arr.length})`;
}
