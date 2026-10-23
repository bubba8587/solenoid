// [[C17]] shareImpl, [[C24]] arraySemantics
import { stdNormCDF } from "./mathUtils";

export interface EtsFit {
  alpha: number; beta: number; gamma: number;
  season: number;
  level: number; trend: number; seasonal: number[];
  fitted: number[];
  sigma: number;
}

export function runHW(y: readonly number[], m: number, alpha: number, beta: number, gamma: number): { sse: number; fit: EtsFit } {
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
    if (t >= (m > 1 ? m : 1)) { sse += err * err; count++; }
    const prevLevel = level, prevTrend = trend;
    if (m > 1) {
      level = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonal[t % m] = gamma * (y[t] - prevLevel - prevTrend) + (1 - gamma) * s;
    } else {
      level = alpha * y[t] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
  }
  const sigma = count > 1 ? Math.sqrt(sse / count) : 0;
  return { sse, fit: { alpha, beta, gamma, season: m, level, trend, seasonal: [...seasonal], fitted, sigma } };
}

export const confidenceOk = (c: number): boolean => c > 0 && c < 1 && Number.isFinite(stdNormCDF(c));

export type DecomposeModel = "additive" | "multiplicative" | "stl";
export interface Decomposition { trend: (number | null)[]; seasonal: (number | null)[]; residual: (number | null)[] }

