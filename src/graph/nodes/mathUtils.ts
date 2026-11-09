// [[C17]] shareImpl

// ─── Clamp ────────────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Min / max over an iterable ───────────────────────────────────────────────
// Use these on user data, never `Math.min(...arr)`, whose spread throws RangeError past about 125k elements.
export function iterMin(it: Iterable<number>): number {
  let m = Infinity;
  for (const v of it) if (v < m) m = v;
  return m;
}
export function iterMax(it: Iterable<number>): number {
  let m = -Infinity;
  for (const v of it) if (v > m) m = v;
  return m;
}

// ─── Normal distribution ──────────────────────────────────────────────────────

const CODY_A = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582, 18154.981253343561249, 0.065682337918207449113];
const CODY_B = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205, 45507.789335026729956];
const CODY_C = [0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979, 597.27027639480026226, 2494.5375852903726711, 6848.1904505362823326, 11602.651437647350124, 9842.7148383839780218, 1.0765576773720192317e-8];
const CODY_D = [22.266688044328115691, 235.38790178262499861, 1519.377599407554805, 6485.558298266760755, 18615.571640885098091, 34900.952721145977266, 38912.003286093271411, 19685.429676859990727];
const CODY_P = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807, 0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
const CODY_Q = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515, 0.00378239633202758244, 7.29751555083966205e-5];
const M_1_SQRT_2PI = 0.398942280401432677939946059934;
export function stdNormCDF(z: number): number {
  if (Number.isNaN(z)) return NaN;
  const y = Math.abs(z);
  if (y <= 0.67448975) {
    let xnum = 0, xden = 0;
    if (y > 1e-16) {
      const xsq = z * z;
      xnum = CODY_A[4] * xsq; xden = xsq;
      for (let i = 0; i < 3; i++) { xnum = (xnum + CODY_A[i]) * xsq; xden = (xden + CODY_B[i]) * xsq; }
    }
    return 0.5 + z * (xnum + CODY_A[3]) / (xden + CODY_B[3]);
  }
  let lower: number;
  if (y <= Math.sqrt(32)) {
    let xnum = CODY_C[8] * y, xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + CODY_C[i]) * y; xden = (xden + CODY_D[i]) * y; }
    const temp = (xnum + CODY_C[7]) / (xden + CODY_D[7]);
    const xsq = Math.trunc(y * 16) / 16, del = (y - xsq) * (y + xsq);
    lower = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
  } else {
    const xsq0 = 1 / (z * z);
    let xnum = CODY_P[5] * xsq0, xden = xsq0;
    for (let i = 0; i < 4; i++) { xnum = (xnum + CODY_P[i]) * xsq0; xden = (xden + CODY_Q[i]) * xsq0; }
    let temp = xsq0 * (xnum + CODY_P[4]) / (xden + CODY_Q[4]);
    temp = (M_1_SQRT_2PI - temp) / y;
    const xsq = Math.trunc(y * 16) / 16, del = (y - xsq) * (y + xsq);
    lower = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
  }
  return z < 0 ? lower : 1 - lower;
}
