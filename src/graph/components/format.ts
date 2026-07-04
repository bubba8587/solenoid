// Shared display formatting for node output values.

export function formatScalar(n: number): string {
  // Defensive: a non-number reaching here (a frame/cube/array object, or a string
  // in a numeric slot) would otherwise throw on `.toFixed` — and a throw during
  // React render blacks out the whole app. A display formatter must degrade, not
  // crash, so coerce anything unexpected to a readable string instead. (See
  // CLAUDE.md "false.toFixed()/err.toFixed() throws -> blacked-out app".)
  if (typeof n !== "number") return n == null ? "" : String(n);
  // A residual NaN is DIRTY DATA (an undefined value in the source), not an error:
  // post-finding-13 `#N/A` is a real, catchable tagged error, so labelling NaN
  // "N/A" was a lie. Render it as the literal `NaN`; the value box gives it a quiet
  // muted affordance + tooltip (see ValueDisplay / .solenoid-value--nan).
  if (Number.isNaN(n)) return "NaN";
  return Number.isInteger(n) ? n.toString() : n.toFixed(4);
}

export function listPreview(arr: number[]): string {
  if (arr.length === 0) return "[ ]";
  const p = arr.slice(0, 4).map((n) =>
    Number.isNaN(n) ? "NaN" : Number.isInteger(n) ? n.toString() : n.toFixed(2),
  );
  return `[${p.join(", ")}${arr.length > 4 ? ", …" : ""}]  (${arr.length})`;
}
