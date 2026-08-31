// Rete-free ODE integrator, shared by the node and (if wired) a formula. The caller
// supplies the derivative as a plain function, so this stays free of the formula/rete
// layers (implReteFree).

/** Integrate dy/dt = f(t, y) from t0 to t1 with the classic fixed-step RK4, returning the
 *  `steps + 1` sample points (t0 included). `steps` clamps to 1..100000. Returns null when
 *  a bound is non-finite, or when `f` yields null / a non-finite value, or the solution
 *  blows up — the caller surfaces that as an error. */
export function rk4(
  f: (t: number, y: number) => number | null,
  y0: number, t0: number, t1: number, steps: number,
): { t: number[]; y: number[] } | null {
  if (![y0, t0, t1].every(Number.isFinite)) return null;
  const n = Math.max(1, Math.min(100000, Math.floor(steps) || 1));
  const h = (t1 - t0) / n;
  const ts: number[] = [t0];
  const ys: number[] = [y0];
  let t = t0, y = y0;
  const deriv = (tt: number, yy: number): number | null => {
    const r = f(tt, yy);
    return r != null && Number.isFinite(r) ? r : null;
  };
  for (let i = 0; i < n; i++) {
    const k1 = deriv(t, y);
    if (k1 === null) return null;
    const k2 = deriv(t + h / 2, y + (h / 2) * k1);
    if (k2 === null) return null;
    const k3 = deriv(t + h / 2, y + (h / 2) * k2);
    if (k3 === null) return null;
    const k4 = deriv(t + h, y + h * k3);
    if (k4 === null) return null;
    y = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    t = t + h;
    if (!Number.isFinite(y)) return null; // blow-up
    ts.push(t);
    ys.push(y);
  }
  return { t: ts, y: ys };
}
