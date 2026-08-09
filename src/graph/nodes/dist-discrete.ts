import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, syncInverseInput, type BroadcastResult } from "./shared";
import { lnCombin, lnGamma, regularizedBeta, regularizedGamma } from "./mathUtils";

export type BinomDistOp = "pmf" | "cdf" | "inv";

export const BINOM_DIST_OP_META = {
  pmf: { label: "PMF",     description: "Binomial P(X = k) = C(n,k)\u00b7p^k\u00b7(1\u2212p)^(n\u2212k). Excel: BINOM.DIST, cumulative=FALSE." },
  cdf: { label: "CDF",     description: "Cumulative binomial P(X \u2264 k). Excel: BINOM.DIST, cumulative=TRUE." },
  inv: { label: "Inverse", description: "Smallest k whose cumulative probability reaches alpha. Excel: BINOM.INV / CRITBINOM." },
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

function binomInv(alpha: number, n: number, p: number): number | null {
  n = Math.floor(n);
  if (n < 0 || p < 0 || p > 1 || alpha < 0 || alpha > 1) return null;
  let cumP = 0;
  for (let k = 0; k <= n; k++) {
    const pmf = binomPmf(k, n, p);
    if (pmf === null) return null;
    cumP += pmf;
    if (cumP >= alpha) return k;
  }
  return n; // nothing crosses alpha
}

export class BinomDistNode extends ClassicPreset.Node {
  label: string;
  op: BinomDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { k: 3, prob: 0.95, n: 10, p: 0.5 };
  readonly xKey = "k";
  readonly paramKeys = ["n", "p"];
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: BinomDistOp }) {
    super("BinomDist");
    this.label = init?.label ?? "Binomial";
    this.op = init?.op ?? "pmf";
    syncInverseInput(this, this.op, this.xKey, "k (successes)", "alpha");
    this.addInput("n", numListIn("n (trials)"));
    this.addInput("p", numListIn("p (probability)"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: BinomDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "k (successes)", "alpha");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const n = readInput(inputs.n, this.literals.n);
    const p = readInput(inputs.p, this.literals.p);
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.k, this.literals.k);
    const result = broadcast((fv, nv, pv) => {
      if (op === "inv") return binomInv(fv, nv, pv);
      return op === "pmf" ? binomPmf(fv, nv, pv) : binomCdf(fv, nv, pv);
    }, first, n, p);
    this.cachedResult = result;
    return { result };
  }
}

export type PoissonDistOp = "pmf" | "cdf";

export const POISSON_DIST_OP_META = {
  pmf: { label: "PMF", description: "Poisson P(X = k) = e^(−λ)·λ^k/k! Excel: POISSON.DIST, cumulative=FALSE." },
  cdf: { label: "CDF", description: "Poisson P(X ≤ k) = 1 − Γ(k+1, λ)/Γ(k+1). Excel: POISSON.DIST, cumulative=TRUE." },
} satisfies Record<PoissonDistOp, { label: string; description: string }>;

export class PoissonDistNode extends ClassicPreset.Node {
  label: string;
  op: PoissonDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { k: 3, lambda: 2 };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: PoissonDistOp }) {
    super("PoissonDist");
    this.label = init?.label ?? "Poisson";
    this.op = init?.op ?? "pmf";
    this.addInput("k",      numListIn("k"));
    this.addInput("lambda", numListIn("λ (mean)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const k      = readInput(inputs.k,      this.literals.k);
    const lambda = readInput(inputs.lambda, this.literals.lambda);
    const op = this.op;
    const result = broadcast((kv, lv) => {
      const ki = Math.floor(kv);
      if (ki < 0 || lv < 0) return null;
      if (op === "pmf") {
        if (lv === 0) return ki === 0 ? 1 : 0;
        const r = Math.exp(-lv + ki * Math.log(lv) - lnGamma(ki + 1));
        return Number.isFinite(r) ? r : null;
      } else {
        if (lv === 0) return 1;
        const r = 1 - regularizedGamma(ki + 1, lv);
        return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
      }
    }, k, lambda);
    this.cachedResult = result;
    return { result };
  }
}

export type HypgeomDistOp = "pmf" | "cdf";

export const HYPGEOM_DIST_OP_META = {
  pmf: { label: "PMF", description: "Hypergeometric P(X = k) = C(M,k)·C(N−M,n−k)/C(N,n). Excel: HYPGEOM.DIST, cumulative=FALSE." },
  cdf: { label: "CDF", description: "Hypergeometric cumulative P(X ≤ k). Excel: HYPGEOM.DIST, cumulative=TRUE." },
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { k: 2, n: 5, M: 10, N: 20 };
  width = 180; height = 240;

  constructor(init?: { label?: string; op?: HypgeomDistOp }) {
    super("HypgeomDist");
    this.label = init?.label ?? "Hypergeometric";
    this.op = init?.op ?? "pmf";
    this.addInput("k", numListIn("k (sample successes)"));
    this.addInput("n", numListIn("n (sample size)"));
    this.addInput("M", numListIn("M (pop. successes)"));
    this.addInput("N", numListIn("N (pop. size)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const k = readInput(inputs.k, this.literals.k);
    const n = readInput(inputs.n, this.literals.n);
    const M = readInput(inputs.M, this.literals.M);
    const N = readInput(inputs.N, this.literals.N);
    const op = this.op;
    const result = broadcast((kv, nv, Mv, Nv) => {
      const ki = Math.floor(kv); const ni = Math.floor(nv);
      const Mi = Math.floor(Mv); const Ni = Math.floor(Nv);
      if (op === "pmf") {
        return hypgeomPmf(ki, ni, Mi, Ni);
      } else {
        const lo = Math.max(0, ni + Mi - Ni);
        if (ki < lo) return 0;
        let sum = 0;
        for (let j = lo; j <= ki; j++) {
          const pmf = hypgeomPmf(j, ni, Mi, Ni);
          if (pmf === null) return null;
          sum += pmf;
        }
        return Number.isFinite(sum) ? Math.min(1, Math.max(0, sum)) : null;
      }
    }, k, n, M, N);
    this.cachedResult = result;
    return { result };
  }
}

export type NegbinomDistOp = "pmf" | "cdf";

export const NEGBINOM_DIST_OP_META = {
  pmf: { label: "PMF", description: "Negative binomial P(X = k failures before r successes). Excel: NEGBINOM.DIST, cumulative=FALSE." },
  cdf: { label: "CDF", description: "Negative binomial cumulative. Excel: NEGBINOM.DIST, cumulative=TRUE." },
} satisfies Record<NegbinomDistOp, { label: string; description: string }>;

export class NegbinomDistNode extends ClassicPreset.Node {
  label: string;
  op: NegbinomDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { k: 3, r: 5, p: 0.5 };
  width = 180; height = 220;

  constructor(init?: { label?: string; op?: NegbinomDistOp }) {
    super("NegbinomDist");
    this.label = init?.label ?? "Negative Binomial";
    this.op = init?.op ?? "pmf";
    this.addInput("k", numListIn("k (failures)"));
    this.addInput("r", numListIn("r (successes)"));
    this.addInput("p", numListIn("p (probability)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const k = readInput(inputs.k, this.literals.k);
    const r = readInput(inputs.r, this.literals.r);
    const p = readInput(inputs.p, this.literals.p);
    const op = this.op;
    const result = broadcast((kv, rv, pv) => {
      const ki = Math.floor(kv); const ri = Math.floor(rv);
      if (ki < 0 || ri < 1 || pv <= 0 || pv > 1) return null;
      if (op === "pmf") {
        const v = Math.exp(lnCombin(ki + ri - 1, ki) + ri * Math.log(pv) + ki * Math.log(1 - pv));
        return Number.isFinite(v) ? v : null;
      } else {
        const v = regularizedBeta(pv, ri, ki + 1);
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
      }
    }, k, r, p);
    this.cachedResult = result;
    return { result };
  }
}
