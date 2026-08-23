// Distribution fitting (scipy.stats.<dist>.fit, R fitdistrplus::fitdist, @RISK / Crystal Ball
// "fit distribution") behind the Fit Distribution node AND the FITDIST formula. Must not
// import rete. Each family: a maximum-likelihood (or moment) estimate of its parameters on
// the Distribution node's own parameterization (distributionOps.DIST_SPECS — so a fitted
// family plugs straight back into that card), the log-likelihood, AIC, and the one-sample
// Kolmogorov–Smirnov D against the fitted CDF for the goodness-of-fit ranking.
import { lnGamma, regularizedBeta, regularizedGamma, stdNormCDF } from "./mathUtils";

export type FitFamily = "normal" | "lognorm" | "expon" | "gamma" | "weibull" | "uniform" | "beta" | "poisson";
export const FIT_FAMILIES: readonly FitFamily[] = ["normal", "lognorm", "expon", "gamma", "weibull", "uniform", "beta", "poisson"];

export interface DistFit {
  family: FitFamily;
  /** Parameter names in the Distribution node's order (e.g. mean, stdev). */
  paramNames: string[];
  params: number[];
  logLik: number;
  aic: number;
  /** One-sample KS statistic against the fitted CDF (smaller = closer). */
  ks: number;
  n: number;
}

const mean = (a: readonly number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const variance = (a: readonly number[], m: number) => a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; // MLE (÷n)

function ksStat(sorted: readonly number[], cdf: (x: number) => number): number {
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const F = cdf(sorted[i]);
    d = Math.max(d, Math.abs(F - (i + 1) / n), Math.abs(F - i / n));
  }
  return d;
}

/** Newton on the Weibull shape k (profile likelihood), scale from k. */
function fitWeibull(x: readonly number[]): { k: number; lambda: number } | null {
  if (x.some((v) => v <= 0)) return null;
  const lx = x.map(Math.log), n = x.length, meanLx = mean(lx);
  let k = 1.2;
  for (let it = 0; it < 100; it++) {
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) { const xk = Math.pow(x[i], k); a += xk; b += xk * lx[i]; c += xk * lx[i] * lx[i]; }
    const f = b / a - 1 / k - meanLx;
    const df = (c * a - b * b) / (a * a) + 1 / (k * k);
    const next = k - f / df;
    if (!Number.isFinite(next) || next <= 0) break;
    if (Math.abs(next - k) < 1e-10) { k = next; break; }
    k = next;
  }
  const lambda = Math.pow(x.reduce((s, v) => s + Math.pow(v, k), 0) / n, 1 / k);
  return Number.isFinite(k) && Number.isFinite(lambda) && k > 0 ? { k, lambda } : null;
}

/** Gamma shape by Newton on the MLE equation ln(a) − ψ(a) = ln(mean) − mean(ln x). */
function fitGamma(x: readonly number[]): { alpha: number; beta: number } | null {
  if (x.some((v) => v <= 0)) return null;
  const m = mean(x), s = Math.log(m) - mean(x.map(Math.log));
  if (!(s > 0)) return null;
  const digamma = (a: number): number => { let r = 0; while (a < 6) { r -= 1 / a; a += 1; } return r + Math.log(a) - 1 / (2 * a) - 1 / (12 * a * a) + 1 / (120 * a ** 4) - 1 / (252 * a ** 6); };
  const trigamma = (a: number): number => { let r = 0; while (a < 6) { r += 1 / (a * a); a += 1; } return r + 1 / a + 1 / (2 * a * a) + 1 / (6 * a ** 3) - 1 / (30 * a ** 5) + 1 / (42 * a ** 7); };
  let a = (3 - s + Math.sqrt((s - 3) ** 2 + 24 * s)) / (12 * s); // Minka's start
  for (let it = 0; it < 100; it++) {
    const f = Math.log(a) - digamma(a) - s;
    const next = a - f / (1 / a - trigamma(a));
    if (!Number.isFinite(next) || next <= 0) break;
    if (Math.abs(next - a) < 1e-10) { a = next; break; }
    a = next;
  }
  return a > 0 ? { alpha: a, beta: m / a } : null;
}

/** Fit one family; `null` when the data can't support it (wrong support, too few points). */
export function fitDistribution(data: readonly number[], family: FitFamily): DistFit | null {
  const x = data.filter((v) => Number.isFinite(v));
  const n = x.length;
  if (n < 3) return null;
  const sorted = [...x].sort((a, b) => a - b);
  const m = mean(x);
  const done = (paramNames: string[], params: number[], logLik: number, cdf: (v: number) => number): DistFit => ({
    family, paramNames, params, logLik, aic: 2 * params.length - 2 * logLik, ks: ksStat(sorted, cdf), n,
  });
  switch (family) {
    case "normal": {
      const sd = Math.sqrt(variance(x, m));
      if (!(sd > 0)) return null;
      const ll = -n * Math.log(sd * Math.sqrt(2 * Math.PI)) - x.reduce((s, v) => s + ((v - m) / sd) ** 2, 0) / 2;
      return done(["mean", "stdev"], [m, sd], ll, (v) => stdNormCDF((v - m) / sd));
    }
    case "lognorm": {
      if (x.some((v) => v <= 0)) return null;
      const lx = x.map(Math.log), mu = mean(lx), sd = Math.sqrt(variance(lx, mu));
      if (!(sd > 0)) return null;
      const ll = -n * Math.log(sd * Math.sqrt(2 * Math.PI)) - lx.reduce((s, v) => s + ((v - mu) / sd) ** 2, 0) / 2 - lx.reduce((s, v) => s + v, 0);
      return done(["mean", "stdev"], [mu, sd], ll, (v) => (v <= 0 ? 0 : stdNormCDF((Math.log(v) - mu) / sd)));
    }
    case "expon": {
      if (x.some((v) => v < 0) || !(m > 0)) return null;
      const lambda = 1 / m;
      const ll = n * Math.log(lambda) - lambda * x.reduce((s, v) => s + v, 0);
      return done(["lambda"], [lambda], ll, (v) => (v < 0 ? 0 : 1 - Math.exp(-lambda * v)));
    }
    case "gamma": {
      const g = fitGamma(x);
      if (!g) return null;
      const { alpha, beta } = g;
      const ll = x.reduce((s, v) => s + (alpha - 1) * Math.log(v) - v / beta, 0) - n * (lnGamma(alpha) + alpha * Math.log(beta));
      return done(["alpha", "beta"], [alpha, beta], ll, (v) => (v <= 0 ? 0 : regularizedGamma(alpha, v / beta)));
    }
    case "weibull": {
      const w = fitWeibull(x);
      if (!w) return null;
      const { k, lambda } = w;
      const ll = x.reduce((s, v) => s + Math.log(k / lambda) + (k - 1) * Math.log(v / lambda) - Math.pow(v / lambda, k), 0);
      return done(["alpha", "beta"], [k, lambda], ll, (v) => (v < 0 ? 0 : 1 - Math.exp(-Math.pow(v / lambda, k))));
    }
    case "uniform": {
      const lo = sorted[0], hi = sorted[n - 1];
      if (!(hi > lo)) return null;
      const ll = -n * Math.log(hi - lo);
      return done(["min", "max"], [lo, hi], ll, (v) => (v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo)));
    }
    case "beta": {
      if (x.some((v) => v <= 0 || v >= 1)) return null;
      const v = variance(x, m);
      if (!(v > 0) || v >= m * (1 - m)) return null;
      const common = (m * (1 - m)) / v - 1; // method of moments
      const a = m * common, b = (1 - m) * common;
      const ll = x.reduce((s, t) => s + (a - 1) * Math.log(t) + (b - 1) * Math.log(1 - t), 0) - n * (lnGamma(a) + lnGamma(b) - lnGamma(a + b));
      return done(["alpha", "beta"], [a, b], ll, (t) => (t <= 0 ? 0 : t >= 1 ? 1 : regularizedBeta(t, a, b)));
    }
    case "poisson": {
      if (x.some((v) => v < 0 || Math.round(v) !== v)) return null;
      const lam = m;
      if (!(lam > 0)) return null;
      const ll = x.reduce((s, k) => s + k * Math.log(lam) - lam - lnGamma(k + 1), 0);
      const cdf = (v: number): number => { const k = Math.floor(v); if (k < 0) return 0; return 1 - regularizedGamma(k + 1, lam); };
      return done(["lambda"], [lam], ll, cdf);
    }
  }
}

/** Fit every family the data supports, best AIC first. */
export function fitAll(data: readonly number[]): DistFit[] {
  const fits: DistFit[] = [];
  for (const f of FIT_FAMILIES) { const r = fitDistribution(data, f); if (r && Number.isFinite(r.aic)) fits.push(r); }
  return fits.sort((a, b) => a.aic - b.aic);
}
