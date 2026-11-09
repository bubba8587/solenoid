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

const CODY_A = [2.2352520354606837, 161.02823106855587, 1067.6894854603709, 18154.98125334356, 0.06568233791820745];
const CODY_B = [47.202581904688245, 976.0985517377767, 10260.932208618979, 45507.78933502673];
const CODY_C = [0.39894151208813466, 8.883149794388377, 93.50665613217785, 597.2702763948002, 2494.5375852903726, 6848.190450536283, 11602.65143764735, 9842.714838383978, 1.0765576773720192e-8];
const CODY_D = [22.266688044328117, 235.387901782625, 1519.3775994075547, 6485.558298266761, 18615.571640885097, 34900.95272114598, 38912.00328609327, 19685.429676859992];
const CODY_P = [0.215898534057957, 0.12740116116024736, 0.022235277870649807, 0.0014216191932278934, 0.000029112874951168793, 0.023073441764940174];
const CODY_Q = [1.284260096144911, 0.4682382124808651, 0.06598813786892856, 0.0037823963320275824, 0.00007297515550839662];
const M_1_SQRT_2PI = 0.3989422804014327;
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
