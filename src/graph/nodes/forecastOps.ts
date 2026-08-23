// Holt–Winters exponential smoothing (additive level / trend / season — ETS AAN and AAA)
// behind the Forecast (ETS) node AND the FORECAST.ETS family (capabilityParity). Must not
// import rete. statsmodels ExponentialSmoothing(trend="add", seasonal="add"), R
// HoltWinters / forecast::ets("AAA"); Excel's FORECAST.ETS is the same model family with
// Microsoft's own parameter search, so values are close, not bit-identical (parity:false).
import { stdNormCDF, normSInv } from "./mathUtils";

export interface EtsFit {
  /** Smoothing parameters the search settled on. */
  alpha: number; beta: number; gamma: number;
  /** Season length used (1 = no seasonality). */
  season: number;
  level: number; trend: number; seasonal: number[];
  /** One-step-ahead fitted values, aligned with the input. */
  fitted: number[];
  /** Residual standard deviation of the one-step errors. */
  sigma: number;
}

function runHW(y: readonly number[], m: number, alpha: number, beta: number, gamma: number): { sse: number; fit: EtsFit } {
  const n = y.length;
  let level: number, trend: number;
  const seasonal: number[] = [];
  if (m > 1) {
    const first = y.slice(0, m), second = y.slice(m, 2 * m);
    const m1 = first.reduce((a, b) => a + b, 0) / m;
    const m2 = second.length === m ? second.reduce((a, b) => a + b, 0) / m : m1;
    level = m1;
    trend = second.length === m ? (m2 - m1) / m : 0;
    for (let i = 0; i < m; i++) seasonal.push(first[i] - m1);
  } else {
    level = y[0];
    trend = n > 1 ? y[1] - y[0] : 0;
    seasonal.push(0);
  }
  const fitted: number[] = [];
  let sse = 0, count = 0;
  for (let t = 0; t < n; t++) {
    const s = seasonal[t % m] ?? 0;
    const pred = level + trend + (m > 1 ? s : 0);
    fitted.push(pred);
    const err = y[t] - pred;
    if (t >= (m > 1 ? m : 1)) { sse += err * err; count++; } // skip the initialization window
    const prevLevel = level;
    if (m > 1) {
      level = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonal[t % m] = gamma * (y[t] - prevLevel - trend) + (1 - gamma) * s;
    } else {
      level = alpha * y[t] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
  }
  const sigma = count > 1 ? Math.sqrt(sse / count) : 0;
  return { sse, fit: { alpha, beta, gamma, season: m, level, trend, seasonal: [...seasonal], fitted, sigma } };
}

/** Fit additive Holt–Winters to an equally spaced series; `season` 1 = trend only (Holt).
 *  Parameters by a coarse grid then coordinate refinement on the one-step SSE.
 *  `null` when the series is too short (< 3, or < 2 seasons when seasonal). */
export function fitEts(y: readonly number[], season = 1): EtsFit | null {
  const n = y.length, m = Math.max(1, Math.round(season));
  if (n < 3 || (m > 1 && n < 2 * m)) return null;
  let best: { sse: number; fit: EtsFit } | null = null;
  const grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
  for (const a of grid) for (const b of [0, 0.05, 0.15, 0.3, 0.6]) for (const g of m > 1 ? grid : [0]) {
    const r = runHW(y, m, a, b, g);
    if (!best || r.sse < best.sse) best = r;
  }
  let { alpha, beta, gamma } = best!.fit;
  for (let step = 0.05; step > 1e-4; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [da, db, dg] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, step], [0, 0, -step]]) {
        const a = Math.min(1, Math.max(0, alpha + da)), b = Math.min(1, Math.max(0, beta + db)), g = Math.min(1, Math.max(0, gamma + dg));
        if (m === 1 && dg !== 0) continue;
        const r = runHW(y, m, a, b, g);
        if (r.sse < best!.sse - 1e-12) { best = r; alpha = a; beta = b; gamma = g; improved = true; }
      }
    }
  }
  return best!.fit;
}

/** Forecast h steps ahead from a fit. */
export function etsForecast(fit: EtsFit, h: number): number[] {
  const out: number[] = [];
  const m = fit.season;
  for (let k = 1; k <= h; k++) out.push(fit.level + k * fit.trend + (m > 1 ? fit.seasonal[(fit.fitted.length + k - 1) % m] : 0));
  return out;
}

/** Half-width of the prediction interval h steps ahead at `confidence` (default 95%):
 *  z · σ · √h — the usual growing-band approximation (Excel's ETS.CONFINT is the same shape). */
export function etsInterval(fit: EtsFit, h: number, confidence = 0.95): number {
  const z = normSInv(0.5 + confidence / 2);
  return z * fit.sigma * Math.sqrt(h);
}

/** Detect a season length from the autocorrelation of the differenced series: the lag
 *  2..min(n/2, 24) with the highest ACF, when it clears 0.3 and beats its neighbours; else
 *  1 (no seasonality). FORECAST.ETS.SEASONALITY's job, with an open method. */
export function detectSeason(y: readonly number[]): number {
  const n = y.length;
  if (n < 6) return 1;
  const d = y.slice(1).map((v, i) => v - y[i]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const denom = d.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (denom === 0) return 1;
  const maxLag = Math.min(Math.floor(n / 2), 24);
  const acf: number[] = [0, 0];
  for (let lag = 2; lag <= maxLag; lag++) {
    let s = 0;
    for (let t = lag; t < d.length; t++) s += (d[t] - mean) * (d[t - lag] - mean);
    acf.push(s / denom);
  }
  let bestLag = 1, bestVal = 0.3;
  for (let lag = 2; lag <= maxLag; lag++) {
    const v = acf[lag];
    const left = acf[lag - 1] ?? -1, right = acf[lag + 1] ?? -1;
    if (v > bestVal && v >= left && v >= right) { bestVal = v; bestLag = lag; }
  }
  return bestLag;
}

/** Two-sided normal tail helper exported for the confidence argument validation. */
export const confidenceOk = (c: number): boolean => c > 0 && c < 1 && Number.isFinite(stdNormCDF(c));
