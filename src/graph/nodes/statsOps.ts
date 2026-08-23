// The ONE implementation behind the statistics NODES (Aggregate, Rank & Percentile,
// Correl, Covariance, Mode) AND their formula registrations (capabilityParity /
// shareImpl). Must not import rete. Inputs are the already-prepared numbers — the
// caller has applied the aggregator policy (an error propagates, a blank is skipped;
// `forAggregate` / `pairPresent` on the node side, `prepRangeArgs` on the formula side).
// `null` = undefined for this input (too few points, a flat list) — each surface shows
// that as a blank; a SolError is a real domain failure both surfaces display as-is.
import { solError, type SolError } from "../errorValue";
import { iterMin, iterMax } from "./mathUtils";

export type AggregateOp =
  | "sum" | "avg" | "min" | "max" | "count" | "countdistinct" | "median" | "product" | "stdev"
  | "geomean" | "harmean" | "sumsq" | "var_s" | "var_p" | "stdev_p" | "devsq" | "avedev" | "skew" | "skew_p" | "kurt";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: readonly number[]) => sum(a) / a.length;
const ssd = (a: readonly number[], m: number) => a.reduce((x, y) => x + (y - m) ** 2, 0);

/** The Aggregate node's reducers over PRESENT numbers (blanks already skipped). An empty
 *  list answers the op's identity for SUM (0) / PRODUCT (1) / COUNT (0) and `null` for
 *  everything else; a sample statistic under its minimum n is `null` — "not enough data"
 *  is a blank, not an error (the Running node's rule too; Excel says #DIV/0!) — as are the
 *  normalized moments of a flat list. GEOMEAN/HARMEAN over a non-positive value is a real
 *  log-domain failure: #DOMAIN!. */
export function aggregate(op: AggregateOp, arr: readonly number[]): number | SolError | null {
  if (arr.length === 0) return op === "sum" || op === "count" ? 0 : op === "product" ? 1 : null;
  const n = arr.length;
  switch (op) {
    case "sum":     return sum(arr);
    case "avg":     return mean(arr);
    case "min":     return iterMin(arr);
    case "max":     return iterMax(arr);
    case "count":   return n;
    case "countdistinct": return new Set(arr).size;
    case "product": return arr.reduce((a, b) => a * b, 1);
    case "median": {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    }
    case "stdev":   return n < 2 ? null : Math.sqrt(ssd(arr, mean(arr)) / (n - 1));
    case "stdev_p": return Math.sqrt(ssd(arr, mean(arr)) / n);
    case "var_s":   return n < 2 ? null : ssd(arr, mean(arr)) / (n - 1);
    case "var_p":   return ssd(arr, mean(arr)) / n;
    case "geomean": return arr.some((v) => v <= 0) ? solError("#DOMAIN!", "GEOMEAN needs every value > 0") : Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / n);
    case "harmean": return arr.some((v) => v <= 0) ? solError("#DOMAIN!", "HARMEAN needs every value > 0") : n / arr.reduce((a, b) => a + 1 / b, 0);
    case "sumsq":   return arr.reduce((a, b) => a + b * b, 0);
    case "devsq":   return ssd(arr, mean(arr));
    case "avedev": { const m = mean(arr); return arr.reduce((a, b) => a + Math.abs(b - m), 0) / n; }
    case "skew": {
      if (n < 3) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / (n - 1));
      if (s === 0) return null;
      return (n / ((n - 1) * (n - 2))) * arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0);
    }
    case "skew_p": {
      if (n < 2) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / n);
      if (s === 0) return null;
      return arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / n;
    }
    case "kurt": {
      if (n < 4) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / (n - 1));
      if (s === 0) return null;
      const sum4 = arr.reduce((a, b) => a + ((b - m) / s) ** 4, 0);
      return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    }
  }
}

/** The interpolating percentile over a SORTED list; `exc` uses Excel's exclusive rank. */
export function percentileOf(sorted: readonly number[], p: number, exc: boolean): number {
  const n = sorted.length;
  const i = exc ? p * (n + 1) - 1 : p * (n - 1);
  const lo = Math.floor(i), hi = exc ? Math.min(n - 1, Math.ceil(i)) : Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** PERCENTILE.INC / .EXC with Excel's domain rules: INC needs 0 ≤ p ≤ 1, EXC needs p
 *  strictly inside (1/(n+1), n/(n+1)) — Excel answers #NUM! outside (our #DOMAIN!). */
export function percentile(arr: readonly number[], p: number, exc: boolean): number | SolError | null {
  const n = arr.length;
  if (n === 0) return null;
  if (!exc && (p < 0 || p > 1)) return solError("#DOMAIN!", "Percentile must be between 0 and 1");
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)");
  }
  return percentileOf([...arr].sort((a, b) => a - b), p, exc);
}

/** QUARTILE.INC / .EXC = PERCENTILE at q/4; INC's quart 0 = MIN and 4 = MAX, EXC has
 *  neither (and an interior q can still leave the EXC domain at small n). */
export function quartile(arr: readonly number[], q: number, exc: boolean): number | SolError | null {
  const qi = Math.round(q);
  if (arr.length === 0) return null;
  if (qi < 0 || qi > 4) return solError("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4");
  if (exc && (qi === 0 || qi === 4)) return solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
  const n = arr.length, p = qi / 4;
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
  }
  return percentileOf([...arr].sort((a, b) => a - b), p, exc);
}

/** LARGE / SMALL: the k-th largest (or smallest), 1-based; out of range is `null`. */
export function nthExtreme(arr: readonly number[], k: number, largest: boolean): number | null {
  const ki = Math.round(k);
  if (arr.length === 0 || ki < 1 || ki > arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return largest ? sorted[arr.length - ki] : sorted[ki - 1];
}

/** Pearson r (or r², `rsq`) over PAIRED numbers — the caller has already dropped pairs
 *  with a blank. Fewer than two pairs is `null`; zero variance in either list is #DIV/0!. */
export function pearson(xs: readonly number[], ys: readonly number[], rsq = false): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return solError("#DIV/0!", "One of the lists has zero variance");
  const r = num / den;
  return rsq ? r * r : r;
}

/** COVARIANCE.P (`sample=false`) / .S over paired numbers; fewer than two pairs is `null`. */
export function covariance(xs: readonly number[], ys: readonly number[], sample: boolean): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  const cov = xs.slice(0, n).reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  return sample ? cov / (n - 1) : cov / n;
}

/** The mode(s): one mode → that number; a tie → every tied value, ascending (the combo
 *  answer that supersedes Excel's MODE.SNGL / MODE.MULT split). Empty → `null`. */
export function modes(arr: readonly number[]): number | number[] | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  const ms = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b);
  return ms.length === 1 ? ms[0] : ms;
}

/** FISHER / FISHERINV; FISHER is defined only on (−1, 1). */
export function fisher(x: number, inverse: boolean): number | SolError {
  if (inverse) return Math.tanh(x);
  return x <= -1 || x >= 1 ? solError("#DOMAIN!", "FISHER requires −1 < x < 1") : Math.atanh(x);
}

/** Excel MODE / MODE.SNGL: the most frequent value; among ties the one that occurs FIRST
 *  in the data (Excel's rule). Empty → `null`. The node's `modes` keeps every tie. */
export function modeSingle(arr: readonly number[]): number | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  for (const v of arr) if (counts.get(v) === maxCount) return v;
  return null;
}

/** SLOPE / INTERCEPT / STEYX of the least-squares line over paired numbers. Fewer than
 *  two pairs is `null`; zero X variance is #DIV/0!; STEYX's (n−2) needs three points
 *  (fewer → `null`). Same SS pass as mathUtils.linearFit, plus the residual term. */
export function regression(xs: readonly number[], ys: readonly number[], op: "slope" | "intercept" | "steyx"): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xMean = mean(xs.slice(0, n)), yMean = mean(ys.slice(0, n));
  let SSxy = 0, SSxx = 0, SSyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean, dy = ys[i] - yMean;
    SSxy += dx * dy; SSxx += dx * dx; SSyy += dy * dy;
  }
  if (SSxx === 0) return solError("#DIV/0!", "Known Xs have zero variance");
  const slope = SSxy / SSxx;
  if (op === "slope") return slope;
  if (op === "intercept") return yMean - slope * xMean;
  return n >= 3 ? Math.sqrt(Math.max(0, SSyy - slope * SSxy) / (n - 2)) : null;
}
