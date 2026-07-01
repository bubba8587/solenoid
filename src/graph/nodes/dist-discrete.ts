import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";
import { lnCombin, lnGamma, regularizedBeta, regularizedGamma } from "./mathUtils";

// ─── BINOM.DIST ───────────────────────────────────────────────────────────────
export type BinomDistOp = "pmf" | "cdf";

export const BINOM_DIST_OP_META = {
  pmf: { label: "PMF", description: "Binomial P(X = k) = C(n,k)·p^k·(1−p)^(n−k)   (Excel: BINOM.DIST, cumulative=FALSE)" },
  cdf: { label: "CDF", description: "Binomial P(X ≤ k) — cumulative   (Excel: BINOM.DIST, cumulative=TRUE)" },
} satisfies Record<BinomDistOp, { label: string; description: string }>;

function binomPmf(k: number, n: number, p: number): number | null {
  k = Math.floor(k);
  n = Math.floor(n);
  if (k < 0 || k > n || p < 0 || p > 1) return null;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const r = Math.exp(lnCombin(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  return Number.isFinite(r) ? r : null;
}

function binomCdf(k: number, n: number, p: number): number | null {
  k = Math.floor(k);
  n = Math.floor(n);
  if (k < 0 || n < 0 || p < 0 || p > 1) return null;
  if (k >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return k >= n ? 1 : 0;
  // regularizedBeta(1-p, n-k, k+1) = I_{1-p}(n-k, k+1) = P(X <= k)
  const r = regularizedBeta(1 - p, n - k, k + 1);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
}

export class BinomDistNode extends ClassicPreset.Node {
  label: string;
  op: BinomDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { k: 3, n: 10, p: 0.5 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: BinomDistOp }) {
    super("BinomDist");
    this.label = init?.label ?? "BINOM.DIST";
    this.op = init?.op ?? "pmf";
    this.addInput("k", numIn("k (successes)"));
    this.addInput("n", numIn("n (trials)"));
    this.addInput("p", numIn("p (probability)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { k?: number[]; n?: number[]; p?: number[] }) {
    const k = inputs.k?.[0] ?? this.literals.k ?? 3;
    const n = inputs.n?.[0] ?? this.literals.n ?? 10;
    const p = inputs.p?.[0] ?? this.literals.p ?? 0.5;
    const result = this.op === "pmf" ? binomPmf(k, n, p) : binomCdf(k, n, p);
    this.cachedResult = result;
    return { result };
  }
}

// ─── BINOM.INV ────────────────────────────────────────────────────────────────
export const BINOM_INV_META = {
  label: "BINOM.INV",
  description: "Smallest k such that BINOM.DIST(k, n, p) ≥ alpha   (Excel: BINOM.INV / CRITBINOM)",
};

export class BinomInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { n: 10, p: 0.5, alpha: 0.95 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("BinomInv");
    this.label = init?.label ?? "BINOM.INV";
    this.addInput("n",     numIn("n (trials)"));
    this.addInput("p",     numIn("p (probability)"));
    this.addInput("alpha", numIn("alpha"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { n?: number[]; p?: number[]; alpha?: number[] }) {
    const n     = Math.floor(inputs.n?.[0]     ?? this.literals.n     ?? 10);
    const p     = inputs.p?.[0]                ?? this.literals.p     ?? 0.5;
    const alpha = inputs.alpha?.[0]            ?? this.literals.alpha ?? 0.95;
    let result: number | null = null;

    if (n >= 0 && p >= 0 && p <= 1 && alpha >= 0 && alpha <= 1) {
      let cumP = 0;
      result = n; // default: return n if nothing crosses alpha
      for (let k = 0; k <= n; k++) {
        const pmf = binomPmf(k, n, p);
        if (pmf === null) break;
        cumP += pmf;
        if (cumP >= alpha) {
          result = k;
          break;
        }
      }
    }

    this.cachedResult = result;
    return { result };
  }
}

// ─── POISSON.DIST ─────────────────────────────────────────────────────────────
export type PoissonDistOp = "pmf" | "cdf";

export const POISSON_DIST_OP_META = {
  pmf: { label: "PMF", description: "Poisson P(X = k) = e^(−λ)·λ^k/k!   (Excel: POISSON.DIST, cumulative=FALSE)" },
  cdf: { label: "CDF", description: "Poisson P(X ≤ k) = 1 − Γ(k+1, λ)/Γ(k+1)   (Excel: POISSON.DIST, cumulative=TRUE)" },
} satisfies Record<PoissonDistOp, { label: string; description: string }>;

export class PoissonDistNode extends ClassicPreset.Node {
  label: string;
  op: PoissonDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { k: 3, lambda: 2 };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: PoissonDistOp }) {
    super("PoissonDist");
    this.label = init?.label ?? "POISSON.DIST";
    this.op = init?.op ?? "pmf";
    this.addInput("k",      numIn("k"));
    this.addInput("lambda", numIn("λ (mean)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { k?: number[]; lambda?: number[] }) {
    const k      = Math.floor(inputs.k?.[0]      ?? this.literals.k      ?? 3);
    const lambda = inputs.lambda?.[0]             ?? this.literals.lambda ?? 2;

    if (k < 0 || lambda < 0) {
      this.cachedResult = null;
      return { result: null };
    }

    let result: number | null = null;

    if (this.op === "pmf") {
      if (lambda === 0) {
        result = k === 0 ? 1 : 0;
      } else {
        const r = Math.exp(-lambda + k * Math.log(lambda) - lnGamma(k + 1));
        result = Number.isFinite(r) ? r : null;
      }
    } else {
      // CDF = P(X <= k) = 1 - regularizedGamma(k+1, lambda)  [upper incomplete]
      if (lambda === 0) {
        result = 1; // all mass at 0, so P(X <= k) = 1 for k >= 0
      } else {
        const r = 1 - regularizedGamma(k + 1, lambda);
        result = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
      }
    }

    this.cachedResult = result;
    return { result };
  }
}

// ─── HYPGEOM.DIST ─────────────────────────────────────────────────────────────
export type HypgeomDistOp = "pmf" | "cdf";

export const HYPGEOM_DIST_OP_META = {
  pmf: { label: "PMF", description: "Hypergeometric P(X = k) = C(M,k)·C(N−M,n−k)/C(N,n)   (Excel: HYPGEOM.DIST, cumulative=FALSE)" },
  cdf: { label: "CDF", description: "Hypergeometric cumulative P(X ≤ k)   (Excel: HYPGEOM.DIST, cumulative=TRUE)" },
} satisfies Record<HypgeomDistOp, { label: string; description: string }>;

function hypgeomPmf(k: number, n: number, M: number, N: number): number | null {
  k = Math.floor(k); n = Math.floor(n); M = Math.floor(M); N = Math.floor(N);
  const lo = Math.max(0, n + M - N);
  const hi = Math.min(n, M);
  if (k < lo || k > hi || N <= 0 || M < 0 || n < 0 || M > N || n > N) return null;
  const r = Math.exp(lnCombin(M, k) + lnCombin(N - M, n - k) - lnCombin(N, n));
  return Number.isFinite(r) ? r : null;
}

export class HypgeomDistNode extends ClassicPreset.Node {
  label: string;
  op: HypgeomDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { k: 2, n: 5, M: 10, N: 20 };
  width = 180; height = 240;

  constructor(init?: { label?: string; op?: HypgeomDistOp }) {
    super("HypgeomDist");
    this.label = init?.label ?? "HYPGEOM.DIST";
    this.op = init?.op ?? "pmf";
    this.addInput("k", numIn("k (sample successes)"));
    this.addInput("n", numIn("n (sample size)"));
    this.addInput("M", numIn("M (pop. successes)"));
    this.addInput("N", numIn("N (pop. size)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { k?: number[]; n?: number[]; M?: number[]; N?: number[] }) {
    const k = inputs.k?.[0] ?? this.literals.k ?? 2;
    const n = inputs.n?.[0] ?? this.literals.n ?? 5;
    const M = inputs.M?.[0] ?? this.literals.M ?? 10;
    const N = inputs.N?.[0] ?? this.literals.N ?? 20;

    let result: number | null = null;

    if (this.op === "pmf") {
      result = hypgeomPmf(k, n, M, N);
    } else {
      // CDF: sum PMF for j = max(0, n+M-N)..floor(k)
      const kf = Math.floor(k);
      const Mf = Math.floor(M); const Nf = Math.floor(N); const nf = Math.floor(n);
      const lo = Math.max(0, nf + Mf - Nf);
      if (kf < lo) {
        result = 0;
      } else {
        let sum = 0;
        for (let j = lo; j <= kf; j++) {
          const pmf = hypgeomPmf(j, nf, Mf, Nf);
          if (pmf === null) { sum = NaN; break; }
          sum += pmf;
        }
        result = Number.isFinite(sum) ? Math.min(1, Math.max(0, sum)) : null;
      }
    }

    this.cachedResult = result;
    return { result };
  }
}

// ─── NEGBINOM.DIST ────────────────────────────────────────────────────────────
export type NegbinomDistOp = "pmf" | "cdf";

export const NEGBINOM_DIST_OP_META = {
  pmf: { label: "PMF", description: "Negative binomial P(X = k failures before r successes)   (Excel: NEGBINOM.DIST, cumulative=FALSE)" },
  cdf: { label: "CDF", description: "Negative binomial cumulative   (Excel: NEGBINOM.DIST, cumulative=TRUE)" },
} satisfies Record<NegbinomDistOp, { label: string; description: string }>;

export class NegbinomDistNode extends ClassicPreset.Node {
  label: string;
  op: NegbinomDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { k: 3, r: 5, p: 0.5 };
  width = 180; height = 220;

  constructor(init?: { label?: string; op?: NegbinomDistOp }) {
    super("NegbinomDist");
    this.label = init?.label ?? "NEGBINOM.DIST";
    this.op = init?.op ?? "pmf";
    this.addInput("k", numIn("k (failures)"));
    this.addInput("r", numIn("r (successes)"));
    this.addInput("p", numIn("p (probability)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { k?: number[]; r?: number[]; p?: number[] }) {
    const k = Math.floor(inputs.k?.[0] ?? this.literals.k ?? 3);
    const r = Math.floor(inputs.r?.[0] ?? this.literals.r ?? 5);
    const p = inputs.p?.[0]            ?? this.literals.p ?? 0.5;

    if (k < 0 || r < 1 || p <= 0 || p > 1) {
      this.cachedResult = null;
      return { result: null };
    }

    let result: number | null = null;

    if (this.op === "pmf") {
      const v = Math.exp(lnCombin(k + r - 1, k) + r * Math.log(p) + k * Math.log(1 - p));
      result = Number.isFinite(v) ? v : null;
    } else {
      // CDF = regularizedBeta(p, r, k+1) = I_p(r, k+1)
      const v = regularizedBeta(p, r, k + 1);
      result = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
    }

    this.cachedResult = result;
    return { result };
  }
}
