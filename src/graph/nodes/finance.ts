import { ClassicPreset } from "rete";
import { numIn, numOut, listIn, dateIn } from "./shared";
import { serialToJsDate, jsDateToSerial } from "./date";
import { solError, isSolError, type SolError } from "../errorValue";
import { resolveExcelFunction } from "../excelFunctions";

// Cashflow-list prep for NPV/IRR/MIRR/FVSCHEDULE: propagate the first SolError in the
// list (error-in → error-out, was silently swallowed to NaN), and coerce a null cell
// to 0 — a missing period IS a zero cashflow for a position-discounted sum (skipping
// would misalign every later period's exponent).
function cashPrep(raw: (number | null | SolError)[] | null): { error?: SolError; nums: number[] } {
  if (!raw) return { nums: [] };
  for (const v of raw) if (isSolError(v)) return { error: v, nums: [] };
  return { nums: raw.map((v) => (typeof v === "number" ? v : 0)) };
}

export type PaymentTiming = "end" | "beg";
export const PAYMENT_TIMING_META: Record<PaymentTiming, string> = {
  end: "End of period (0)",
  beg: "Beginning of period (1)",
};

// ─── Coupon / accrual date helpers ────────────────────────────────────────────

function _coupAddMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

function _coupDates(settle: Date, maturity: Date, freq: number): { prev: Date; next: Date } {
  const step = 12 / freq;
  let next = new Date(maturity.getTime());
  while (next > settle) next = _coupAddMonths(next, -step);
  next = _coupAddMonths(next, step);
  return { prev: _coupAddMonths(next, -step), next };
}

function _days30_360(d1: Date, d2: Date): number {
  const y1 = d1.getUTCFullYear(), m1 = d1.getUTCMonth() + 1;
  let v1 = d1.getUTCDate();
  const y2 = d2.getUTCFullYear(), m2 = d2.getUTCMonth() + 1, v2raw = d2.getUTCDate();
  if (v1 === 31) v1 = 30;
  const v2 = (v2raw === 31 && v1 === 30) ? 30 : v2raw;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (v2 - v1);
}

function _actualDays(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

// â”€â”€â”€ Bitwise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type BitwiseOp = "bitand" | "bitor" | "bitxor" | "bitlshift" | "bitrshift";

export const BITWISE_OP_META = {
  bitand:    { label: "BITAND",    description: "Bitwise AND — keeps only the bits set in BOTH numbers (mask out the rest); non-negative integers   (Excel: =BITAND)" },
  bitor:     { label: "BITOR",     description: "Bitwise OR — sets a bit if it's on in EITHER number (combine flags)   (Excel: =BITOR)" },
  bitxor:    { label: "BITXOR",    description: "Bitwise XOR — sets a bit where the two numbers DIFFER (toggle flags)   (Excel: =BITXOR)" },
  bitlshift: { label: "BITLSHIFT", description: "Shift A's bits left by B places — each place doubles the value (A × 2ᴮ)   (Excel: =BITLSHIFT)" },
  bitrshift: { label: "BITRSHIFT", description: "Shift A's bits right by B places — each place halves it, dropping low bits (⌊A ÷ 2ᴮ⌋)   (Excel: =BITRSHIFT)" },
} satisfies Record<BitwiseOp, { label: string; description: string }>;

export class BitwiseNode extends ClassicPreset.Node {
  label: string;
  op: BitwiseOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: BitwiseOp }) {
    super("Bitwise");
    this.label = init?.label ?? "BITAND";
    this.op = init?.op ?? "bitand";
    this.addInput("a", numIn("A"));
    this.addInput("b", numIn("B"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { a?: number[]; b?: number[] }) {
    const a = Math.trunc(inputs.a?.[0] ?? this.literals.a ?? 0);
    const b = Math.trunc(inputs.b?.[0] ?? this.literals.b ?? 0);
    let result: number | null = null;
    switch (this.op) {
      case "bitand":    result = a & b; break;
      case "bitor":     result = a | b; break;
      case "bitxor":    result = a ^ b; break;
      case "bitlshift": result = b >= 0 && b < 32 ? a << b : null; break;
      case "bitrshift": result = b >= 0 && b < 32 ? a >>> b : null; break;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ Interest Rate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type InterestRateOp = "effect" | "nominal";

export const INTEREST_RATE_OP_META = {
  effect:  { label: "EFFECT",  description: "Effective annual rate (APY) from a nominal rate and how many times a year it compounds — what you actually earn or pay   (Excel: =EFFECT)" },
  nominal: { label: "NOMINAL", description: "Nominal annual rate (APR) from an effective rate and the compounding frequency — the inverse of EFFECT   (Excel: =NOMINAL)" },
} satisfies Record<InterestRateOp, { label: string; description: string }>;

export class InterestRateNode extends ClassicPreset.Node {
  label: string;
  op: InterestRateOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, npery: 12 };
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: InterestRateOp }) {
    super("InterestRate");
    this.label = init?.label ?? "EFFECT";
    this.op = init?.op ?? "effect";
    this.addInput("rate",  numIn("Rate"));
    this.addInput("npery", numIn("Periods/year"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; npery?: number[] }) {
    const rate  = inputs.rate?.[0]  ?? this.literals.rate  ?? null;
    const npery = inputs.npery?.[0] ?? this.literals.npery ?? null;
    let result: number | null = null;
    if (rate !== null && npery !== null && npery > 0) {
      const n = Math.round(npery);
      result = this.op === "effect"
        ? Math.pow(1 + rate / n, n) - 1
        : n * (Math.pow(1 + rate, 1 / n) - 1);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ Depreciation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type DepreciationOp = "sln" | "syd" | "ddb" | "db";

export const DEPRECIATION_OP_META = {
  sln: { label: "SLN", description: "Straight-line depreciation — the asset loses the SAME amount every period (the simplest method)   (Excel: =SLN(cost, salvage, life))" },
  syd: { label: "SYD", description: "Sum-of-years'-digits depreciation — accelerated: writes off more in the early periods, tapering each year   (Excel: =SYD(cost, salvage, life, per))" },
  ddb: { label: "DDB", description: "Double-declining-balance depreciation — accelerated: takes twice the straight-line rate off the REMAINING value each period   (Excel: =DDB(cost, salvage, life, period, [factor]))" },
  db:  { label: "DB",  description: "Fixed-declining-balance depreciation — accelerated: a constant rate applied to the remaining value each period   (Excel: =DB(cost, salvage, life, period))" },
} satisfies Record<DepreciationOp, { label: string; description: string }>;

export class DepreciationNode extends ClassicPreset.Node {
  label: string;
  op: DepreciationOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { cost: 10000, salvage: 1000, life: 5, per: 1, factor: 2 };
  width = 180; height = 310;

  constructor(init?: { label?: string; op?: DepreciationOp }) {
    super("Depreciation");
    this.label = init?.label ?? "SLN";
    this.op = init?.op ?? "sln";
    this.addInput("cost",    numIn("Cost"));
    this.addInput("salvage", numIn("Salvage"));
    this.addInput("life",    numIn("Life (periods)"));
    this.addInput("per",     numIn("Period (SYD/DDB only)"));
    this.addInput("factor",  numIn("Factor (DDB)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { cost?: number[]; salvage?: number[]; life?: number[]; per?: number[]; factor?: number[] }) {
    const cost    = inputs.cost?.[0]    ?? this.literals.cost    ?? null;
    const salvage = inputs.salvage?.[0] ?? this.literals.salvage ?? null;
    const life    = inputs.life?.[0]    ?? this.literals.life    ?? null;
    const per     = inputs.per?.[0]     ?? this.literals.per     ?? null;
    const factor  = inputs.factor?.[0]  ?? this.literals.factor  ?? 2;
    // SLN/SYD/DDB/DB are closed-form and verified byte-identical to Formula.js across
    // the domain this node allows — the domain GUARDS above stay hand-rolled (they gate
    // which op even runs), only the actual depreciation formula routes through the seam.
    let result: number | null = null;
    if (cost !== null && salvage !== null && life !== null && life > 0) {
      if (this.op === "sln") {
        result = resolveExcelFunction("SLN")!(cost, salvage, life) as number;
      } else if (per !== null && per >= 1 && per <= life) {
        if (this.op === "syd") {
          result = resolveExcelFunction("SYD")!(cost, salvage, life, per) as number;
        } else if (this.op === "ddb") {
          result = resolveExcelFunction("DDB")!(cost, salvage, life, per, factor) as number;
        } else if (this.op === "db") {
          result = (cost <= 0 || salvage <= 0) ? null : (resolveExcelFunction("DB")!(cost, salvage, life, per) as number);
        }
      }
    }
    if (result !== null && !Number.isFinite(result)) result = null;
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ TVM (Time Value of Money) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type TvmOp = "pmt" | "pv" | "fv" | "nper";

export const TVM_OP_META = {
  pmt:  { label: "PMT",  description: "Periodic payment for a loan or annuity   (Excel: =PMT(rate, nper, pv, [fv], [type]))" },
  pv:   { label: "PV",   description: "Present value of future cash flows   (Excel: =PV(rate, nper, pmt, [fv], [type]))" },
  fv:   { label: "FV",   description: "Future value of an investment or loan   (Excel: =FV(rate, nper, pmt, [pv], [type]))" },
  nper: { label: "NPER", description: "Number of periods to pay off a loan   (Excel: =NPER(rate, pmt, pv, [fv], [type]))" },
} satisfies Record<TvmOp, { label: string; description: string }>;

export class TvmNode extends ClassicPreset.Node {
  label: string;
  op: TvmOp;
  paymentTiming: PaymentTiming;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, nper: 12, pmt: 0, pv: 1000, fv: 0 };
  // 4 input rows shown at a time (the solved-for quantity is hidden).
  width = 180; height = 342;

  constructor(init?: { label?: string; op?: TvmOp; paymentTiming?: PaymentTiming }) {
    super("Tvm");
    this.label         = init?.label         ?? "PMT";
    this.op            = init?.op            ?? "pmt";
    this.paymentTiming = init?.paymentTiming ?? "end";
    this.addInput("rate", numIn("Rate"));
    this.addInput("nper", numIn("Nper"));
    this.addInput("pmt",  numIn("Pmt"));
    this.addInput("pv",   numIn("PV"));
    this.addInput("fv",   numIn("FV"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; nper?: number[]; pmt?: number[]; pv?: number[]; fv?: number[] }) {
    const rate = inputs.rate?.[0] ?? this.literals.rate ?? 0;
    const nper = inputs.nper?.[0] ?? this.literals.nper ?? 0;
    const pmt  = inputs.pmt?.[0]  ?? this.literals.pmt  ?? 0;
    const pv   = inputs.pv?.[0]   ?? this.literals.pv   ?? 0;
    const fv   = inputs.fv?.[0]   ?? this.literals.fv   ?? 0;
    const type = this.paymentTiming === "beg" ? 1 : 0;

    // PMT/PV/FV/NPER are closed-form and verified byte-identical to Formula.js —
    // including its own rate≈0 handling, so THAT branch doesn't need a hand-rolled
    // formula either. The null-producing DEGENERACY guards (n===0, pmt===0, a bad
    // log ratio) stay hand-rolled: they gate whether we call Formula.js at all, so
    // we never have to know what it does on an input this node treats as "no result".
    let result: number | null = null;
    const r = rate;
    const n = nper;
    const t = type;

    if (Math.abs(r) < 1e-12) {
      switch (this.op) {
        case "pmt":  result = n !== 0 ? -(pv + fv) / n : null; break;
        case "pv":   result = -(pmt * n + fv); break;
        case "fv":   result = -(pv + pmt * n); break;
        case "nper": result = pmt !== 0 ? -(pv + fv) / pmt : null; break;
      }
    } else {
      switch (this.op) {
        case "pmt":  result = resolveExcelFunction("PMT")!(r, n, pv, fv, t) as number; break;
        case "pv":   result = resolveExcelFunction("PV")!(r, n, pmt, fv, t) as number; break;
        case "fv":   result = resolveExcelFunction("FV")!(r, n, pmt, pv, t) as number; break;
        case "nper":
          if (pmt === 0) {
            result = null;
          } else {
            const num = pmt * (1 + r * t) - fv * r;
            const den = pmt * (1 + r * t) + pv * r;
            // The log needs num/den > 0, not num,den individually > 0: a normal
            // loan (pv > 0, pmt < 0) makes both negative but their ratio valid.
            const ratio = num / den;
            result = (!Number.isFinite(ratio) || ratio <= 0) ? null : resolveExcelFunction("NPER")!(r, pmt, pv, fv, t) as number;
          }
          break;
      }
    }

    if (result !== null && !Number.isFinite(result)) result = null;
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ RATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const RATE_OP_META = {
  label: "RATE",
  description: "Interest rate per period for a loan — solved iteratively   (Excel: =RATE(nper, pmt, pv, [fv], [type], [guess]))",
};

export class RateNode extends ClassicPreset.Node {
  label: string;
  paymentTiming: PaymentTiming;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { nper: 12, pmt: -100, pv: 1000, fv: 0, guess: 0.1 };
  width = 180; height = 340;

  constructor(init?: { label?: string; paymentTiming?: PaymentTiming }) {
    super("Rate");
    this.label         = init?.label         ?? "RATE";
    this.paymentTiming = init?.paymentTiming ?? "end";
    this.addInput("nper",  numIn("Nper"));
    this.addInput("pmt",   numIn("Pmt"));
    this.addInput("pv",    numIn("PV"));
    this.addInput("fv",    numIn("FV"));
    this.addInput("guess", numIn("Guess"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { nper?: number[]; pmt?: number[]; pv?: number[]; fv?: number[]; guess?: number[] }) {
    const nper  = inputs.nper?.[0]  ?? this.literals.nper  ?? 12;
    const pmt   = inputs.pmt?.[0]   ?? this.literals.pmt   ?? 0;
    const pv    = inputs.pv?.[0]    ?? this.literals.pv    ?? 0;
    const fv    = inputs.fv?.[0]    ?? this.literals.fv    ?? 0;
    const type  = this.paymentTiming === "beg" ? 1 : 0;
    const guess = inputs.guess?.[0] ?? this.literals.guess ?? 0.1;

    let rate = guess;
    let result: number | null = null;
    let converged = false;

    for (let i = 0; i < 100; i++) {
      if (Math.abs(rate) < 1e-12) {
        // degenerate r=0 case
        result = pmt !== 0 ? -(pv + fv) / (nper * pmt) : null;
        converged = result !== null;
        break;
      }
      const rN = Math.pow(1 + rate, nper);
      const f = pv * rN + pmt * (1 + rate * type) * (rN - 1) / rate + fv;
      const df =
        nper * pv * Math.pow(1 + rate, nper - 1)
        + pmt * type * (rN - 1) / rate
        + pmt * (1 + rate * type) * (nper * Math.pow(1 + rate, nper - 1) * rate - (rN - 1)) / (rate * rate);
      if (Math.abs(df) < 1e-20) break;
      const newRate = rate - f / df;
      if (Math.abs(newRate - rate) < 1e-12) {
        result = newRate;
        converged = true;
        break;
      }
      rate = newRate;
    }

    // The annuity equation Newton-solves here can fail to settle (no rate
    // satisfies the cashflow pattern) — Excel returns #NUM! there; we split that
    // into the more specific #CONV!.
    if (!converged || result === null || !Number.isFinite(result)) {
      const err = solError("#CONV!", "RATE couldn't converge on a periodic rate for these terms — check the payment, present value, and future value signs, or try a different guess");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ IPMT / PPMT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type IpmtPpmtOp = "ipmt" | "ppmt";

export const IPMT_PPMT_OP_META = {
  ipmt: { label: "IPMT", description: "Interest portion of a periodic payment   (Excel: =IPMT(rate, per, nper, pv, [fv], [type]))" },
  ppmt: { label: "PPMT", description: "Principal portion of a periodic payment   (Excel: =PPMT(rate, per, nper, pv, [fv], [type]))" },
} satisfies Record<IpmtPpmtOp, { label: string; description: string }>;

export class IpmtPpmtNode extends ClassicPreset.Node {
  label: string;
  op: IpmtPpmtOp;
  paymentTiming: PaymentTiming;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, per: 1, nper: 12, pv: 1000, fv: 0 };
  width = 180; height = 340;

  constructor(init?: { label?: string; op?: IpmtPpmtOp; paymentTiming?: PaymentTiming }) {
    super("IpmtPpmt");
    this.label         = init?.label         ?? "IPMT";
    this.op            = init?.op            ?? "ipmt";
    this.paymentTiming = init?.paymentTiming ?? "end";
    this.addInput("rate", numIn("Rate"));
    this.addInput("per",  numIn("Period"));
    this.addInput("nper", numIn("Nper"));
    this.addInput("pv",   numIn("PV"));
    this.addInput("fv",   numIn("FV"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; per?: number[]; nper?: number[]; pv?: number[]; fv?: number[] }) {
    const rate = inputs.rate?.[0] ?? this.literals.rate ?? 0;
    const per  = inputs.per?.[0]  ?? this.literals.per  ?? 1;
    const nper = inputs.nper?.[0] ?? this.literals.nper ?? 0;
    const pv   = inputs.pv?.[0]   ?? this.literals.pv   ?? 0;
    const fv   = inputs.fv?.[0]   ?? this.literals.fv   ?? 0;
    const type = this.paymentTiming === "beg" ? 1 : 0;

    let result: number | null = null;

    // Compute PMT first
    let pmt: number;
    if (Math.abs(rate) < 1e-12) {
      pmt = nper !== 0 ? -(pv + fv) / nper : 0;
    } else {
      const rN = Math.pow(1 + rate, nper);
      pmt = -(pv * rN + fv) * rate / ((1 + rate * type) * (rN - 1));
    }

    if (Number.isFinite(pmt)) {
      // IPMT/PPMT are closed-form and verified byte-identical to Formula.js (incl. the
      // type=1 "no interest in period 1" case) once rate is non-negligible — the
      // rate≈0 case stays hand-rolled (trivially 0 interest either way, untested
      // against Formula.js at that degenerate input).
      let ipmt: number;
      if (Math.abs(rate) < 1e-12) {
        ipmt = 0;
      } else {
        ipmt = resolveExcelFunction("IPMT")!(rate, per, nper, pv, fv, type) as number;
      }
      if (Number.isFinite(ipmt)) {
        result = this.op === "ipmt" ? ipmt : pmt - ipmt;
      }
    }

    if (result !== null && !Number.isFinite(result)) result = null;
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ NPV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const NPV_META = {
  label: "NPV",
  description: "Net present value of cash flows at a given discount rate (first value = period 1)   (Excel: =NPV(rate, values))",
};

export class NpvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.1 };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Npv");
    this.label = init?.label ?? "NPV";
    this.addInput("rate", numIn("Rate"));
    this.addInput("list", listIn("Cash flows"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; list?: (number | null | SolError)[][] }) {
    const rate = inputs.rate?.[0] ?? this.literals.rate ?? 0.1;
    const { error, nums: cashflows } = cashPrep(inputs.list?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    let result: number | null = null;
    if (cashflows.length > 0) {
      const npv = resolveExcelFunction("NPV")!(rate, ...cashflows) as number;
      result = Number.isFinite(npv) ? npv : null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ IRR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const IRR_META = {
  label: "IRR",
  description: "Internal rate of return for irregular cash flows — solved iteratively   (Excel: =IRR(values, [guess]))",
};

export class IrrNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  width = 180; height = 135;

  constructor(init?: { label?: string }) {
    super("Irr");
    this.label = init?.label ?? "IRR";
    this.addInput("list", listIn("Cash flows"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }): { result: number | SolError | null } {
    const { error, nums: cashflows } = cashPrep(inputs.list?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    if (cashflows.length <= 1) {
      this.cachedResult = null;
      return { result: null }; // not wired / too few points — a blank, not an error
    }
    let rate = 0.1;
    let converged = false;
    for (let i = 0; i < 100; i++) {
      let npv = 0;
      let dnpv = 0;
      for (let t = 0; t < cashflows.length; t++) {
        const disc = Math.pow(1 + rate, t);
        npv += cashflows[t] / disc;
        if (t > 0) {
          dnpv += -t * cashflows[t] / (disc * (1 + rate));
        }
      }
      if (Math.abs(dnpv) < 1e-30) break; // flat derivative — Newton can't proceed
      const newRate = rate - npv / dnpv;
      if (Math.abs(newRate - rate) < 1e-12) {
        rate = newRate;
        converged = true;
        break;
      }
      rate = newRate;
    }
    // Newton ran out of iterations (or hit a flat derivative) without settling —
    // typically an all-same-sign cashflow series with no internal rate at all.
    if (!converged || !Number.isFinite(rate)) {
      const err = solError("#CONV!", "IRR couldn't converge — the cash flows may have no internal rate of return (e.g. they never change sign)");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = rate;
    return { result: rate };
  }
}

// â”€â”€â”€ MIRR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const MIRR_META = {
  label: "MIRR",
  description: "Modified IRR — accounts for cost of capital and reinvestment rate   (Excel: =MIRR(values, finance_rate, reinvest_rate))",
};

export class MirrNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { finrate: 0.1, reinrate: 0.12 };
  width = 180; height = 215;

  constructor(init?: { label?: string }) {
    super("Mirr");
    this.label = init?.label ?? "MIRR";
    this.addInput("list",    listIn("Cash flows"));
    this.addInput("finrate", numIn("Finance rate"));
    this.addInput("reinrate", numIn("Reinvest rate"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][]; finrate?: number[]; reinrate?: number[] }): { result: number | SolError | null } {
    const { error, nums: cashflows } = cashPrep(inputs.list?.[0] ?? null);
    const finrate    = inputs.finrate?.[0]  ?? this.literals.finrate  ?? 0.1;
    const reinrate   = inputs.reinrate?.[0] ?? this.literals.reinrate ?? 0.12;
    if (error) { this.cachedResult = error; return { result: error }; }
    if (cashflows.length <= 1) {
      this.cachedResult = null;
      return { result: null }; // not wired / too few points — a blank, not an error
    }
    const n = cashflows.length;
    let pvNeg = 0;
    let fvPos = 0;
    for (let i = 0; i < n; i++) {
      const cf = cashflows[i];
      if (cf < 0) {
        pvNeg += cf / Math.pow(1 + finrate, i);
      } else {
        fvPos += cf * Math.pow(1 + reinrate, n - 1 - i);
      }
    }
    // MIRR needs at least one negative AND one positive flow — otherwise the
    // present-value-of-outflows / future-value-of-inflows ratio divides by zero
    // (Excel returns #DIV/0! for an all-same-sign series).
    if (pvNeg === 0 || fvPos === 0) {
      const err = solError("#DIV/0!", "MIRR needs both a negative (investment) and a positive (return) cash flow");
      this.cachedResult = err;
      return { result: err };
    }
    const mirr = Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1;
    if (!Number.isFinite(mirr)) {
      const err = solError("#RANGE!", "MIRR overflowed — the cash flows or rates are extreme");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = mirr;
    return { result: mirr };
  }
}

// â”€â”€â”€ PDURATION / RRI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PDURATION_META = {
  label: "PDURATION",
  description: "Periods required for an investment to reach a target value at a given rate   (Excel: =PDURATION(rate, pv, fv))",
};

export class PdurationNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, pv: 1000, fv: 2000 };
  width = 180; height = 235;

  constructor(init?: { label?: string }) {
    super("Pduration");
    this.label = init?.label ?? "PDURATION";
    this.addInput("rate", numIn("Rate"));
    this.addInput("pv",   numIn("PV"));
    this.addInput("fv",   numIn("FV"));
    this.addOutput("result", numOut("Periods"));
  }

  data(inputs: { rate?: number[]; pv?: number[]; fv?: number[] }) {
    const rate = inputs.rate?.[0] ?? this.literals.rate ?? 0;
    const pv   = inputs.pv?.[0]   ?? this.literals.pv   ?? null;
    const fv   = inputs.fv?.[0]   ?? this.literals.fv   ?? null;
    let result: number | null = null;
    if (pv !== null && fv !== null && pv > 0 && fv > 0 && rate > 0) {
      result = Math.log(fv / pv) / Math.log(1 + rate);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

export const RRI_META = {
  label: "RRI",
  description: "Equivalent interest rate for growth from PV to FV over nper periods   (Excel: =RRI(nper, pv, fv))",
};

export class RriNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { nper: 5, pv: 1000, fv: 2000 };
  width = 180; height = 235;

  constructor(init?: { label?: string }) {
    super("Rri");
    this.label = init?.label ?? "RRI";
    this.addInput("nper", numIn("Nper"));
    this.addInput("pv",   numIn("PV"));
    this.addInput("fv",   numIn("FV"));
    this.addOutput("result", numOut("Rate"));
  }

  data(inputs: { nper?: number[]; pv?: number[]; fv?: number[] }) {
    const nper = inputs.nper?.[0] ?? this.literals.nper ?? null;
    const pv   = inputs.pv?.[0]   ?? this.literals.pv   ?? null;
    const fv   = inputs.fv?.[0]   ?? this.literals.fv   ?? null;
    let result: number | null = null;
    if (nper !== null && pv !== null && fv !== null && nper > 0 && pv > 0 && fv > 0) {
      result = Math.pow(fv / pv, 1 / nper) - 1;
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ FVSCHEDULE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const FVSCHEDULE_META = {
  label: "FVSCHEDULE",
  description: "Future value of principal after a schedule of compound interest rates   (Excel: =FVSCHEDULE(principal, schedule))",
};

export class FvScheduleNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { pv: 1000 };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("FvSchedule");
    this.label = init?.label ?? "FVSCHEDULE";
    this.addInput("pv",       numIn("Principal"));
    this.addInput("schedule", listIn("Rate schedule"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { pv?: number[]; schedule?: (number | null | SolError)[][] }) {
    const pv    = inputs.pv?.[0]       ?? this.literals.pv ?? 1000;
    const { error, nums: rates } = cashPrep(inputs.schedule?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    let result: number | null = null;
    {
      let fv = pv;
      for (const r of rates) fv *= (1 + r);
      result = Number.isFinite(fv) ? fv : null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ ISPMT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ISPMT_META = {
  label: "ISPMT",
  description: "Interest paid in a given period of a straight-line-principal loan   (Excel: =ISPMT(rate, per, nper, pv))",
};

export class IspmtNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, per: 1, nper: 12, pv: 10000 };
  width = 180; height = 270;

  constructor(init?: { label?: string }) {
    super("Ispmt");
    this.label = init?.label ?? "ISPMT";
    this.addInput("rate", numIn("Rate"));
    this.addInput("per",  numIn("Period"));
    this.addInput("nper", numIn("Nper"));
    this.addInput("pv",   numIn("PV"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; per?: number[]; nper?: number[]; pv?: number[] }) {
    const rate = inputs.rate?.[0] ?? this.literals.rate ?? 0;
    const per  = inputs.per?.[0]  ?? this.literals.per  ?? 1;
    const nper = inputs.nper?.[0] ?? this.literals.nper ?? 0;
    const pv   = inputs.pv?.[0]   ?? this.literals.pv   ?? 0;
    let result: number | null = null;
    if (nper > 0) {
      result = pv * rate * (1 - per / nper);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ DOLLARDE / DOLLARFR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type DollarOp = "dollarde" | "dollarfr";

export const DOLLAR_OP_META = {
  dollarde: { label: "DOLLARDE", description: "Fractional-notation dollar to decimal (e.g. 1.02 in 32nds â†’ 1.0625)   (Excel: =DOLLARDE)" },
  dollarfr: { label: "DOLLARFR", description: "Decimal dollar to fractional notation (e.g. 1.0625 â†’ 1.02 in 32nds)   (Excel: =DOLLARFR)" },
} satisfies Record<DollarOp, { label: string; description: string }>;

export class DollarNode extends ClassicPreset.Node {
  label: string;
  op: DollarOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { dollar: 1.02, fraction: 32 };
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: DollarOp }) {
    super("Dollar");
    this.label = init?.label ?? "DOLLARDE";
    this.op    = init?.op    ?? "dollarde";
    this.addInput("dollar",   numIn("Dollar"));
    this.addInput("fraction", numIn("Fraction"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { dollar?: number[]; fraction?: number[] }) {
    const dollar   = inputs.dollar?.[0]   ?? this.literals.dollar   ?? 0;
    const fraction = Math.floor(inputs.fraction?.[0] ?? this.literals.fraction ?? 32);
    let result: number | null = null;
    if (fraction > 0) {
      const intPart = Math.trunc(dollar);
      const decPart = dollar - intPart;
      const digits  = fraction === 1 ? 0 : Math.ceil(Math.log10(fraction));
      const mult    = Math.pow(10, digits);
      result = this.op === "dollarde"
        ? intPart + (decPart * mult) / fraction
        : intPart + (decPart * fraction) / mult;
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ VDB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const VDB_META = {
  label: "VDB",
  description: "Variable declining balance depreciation over a period range — switches to straight-line when SL is higher   (Excel: =VDB(cost, salvage, life, start, end, [factor]))",
};

function vdbBookValue(cost: number, salvage: number, life: number, periodEnd: number, factor: number): number {
  let book     = cost;
  const n      = Math.min(Math.floor(periodEnd), life);
  const frac   = periodEnd - Math.floor(periodEnd);
  for (let p = 0; p < n && book > salvage; p++) {
    const remLife = life - p;
    if (remLife <= 0) break;
    const ddb  = (book * factor) / life;
    const sl   = (book - salvage) / remLife;
    let depr   = Math.max(ddb, sl);
    depr       = Math.min(depr, Math.max(0, book - salvage));
    book      -= depr;
  }
  if (frac > 0 && book > salvage) {
    const remLife = life - n;
    if (remLife > 0) {
      const ddb  = (book * factor) / life;
      const sl   = (book - salvage) / remLife;
      let depr   = Math.max(ddb, sl) * frac;
      depr       = Math.min(depr, Math.max(0, book - salvage));
      book      -= depr;
    }
  }
  return book;
}

export class VdbNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { cost: 10000, salvage: 1000, life: 10, start: 0, end: 1, factor: 2 };
  width = 180; height = 330;

  constructor(init?: { label?: string }) {
    super("Vdb");
    this.label = init?.label ?? "VDB";
    this.addInput("cost",    numIn("Cost"));
    this.addInput("salvage", numIn("Salvage"));
    this.addInput("life",    numIn("Life"));
    this.addInput("start",   numIn("Start period"));
    this.addInput("end",     numIn("End period"));
    this.addInput("factor",  numIn("Factor"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { cost?: number[]; salvage?: number[]; life?: number[]; start?: number[]; end?: number[]; factor?: number[] }) {
    const cost    = inputs.cost?.[0]    ?? this.literals.cost    ?? 0;
    const salvage = inputs.salvage?.[0] ?? this.literals.salvage ?? 0;
    const life    = inputs.life?.[0]    ?? this.literals.life    ?? 0;
    const start   = inputs.start?.[0]   ?? this.literals.start   ?? 0;
    const end     = inputs.end?.[0]     ?? this.literals.end     ?? 0;
    const factor  = inputs.factor?.[0]  ?? this.literals.factor  ?? 2;
    let result: number | null = null;
    if (cost >= 0 && salvage >= 0 && life > 0 && start >= 0 && end >= start && end <= life && factor > 0) {
      const startBook = vdbBookValue(cost, salvage, life, start, factor);
      const endBook   = vdbBookValue(cost, salvage, life, end,   factor);
      result = Math.max(0, startBook - endBook);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// â”€â”€â”€ CUMIPMT / CUMPRINC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type CumPmtOp = "cumipmt" | "cumprinc";

export const CUM_PMT_OP_META = {
  cumipmt:  { label: "CUMIPMT",  description: "Cumulative interest paid between two periods   (Excel: =CUMIPMT(rate, nper, pv, start_period, end_period, type))" },
  cumprinc: { label: "CUMPRINC", description: "Cumulative principal paid between two periods   (Excel: =CUMPRINC(rate, nper, pv, start_period, end_period, type))" },
} satisfies Record<CumPmtOp, { label: string; description: string }>;

export class CumPmtNode extends ClassicPreset.Node {
  label: string;
  op: CumPmtOp;
  paymentTiming: PaymentTiming;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.05, nper: 12, pv: 1000, start: 1, end: 12 };
  width = 180; height = 340;

  constructor(init?: { label?: string; op?: CumPmtOp; paymentTiming?: PaymentTiming }) {
    super("CumPmt");
    this.label         = init?.label         ?? "CUMIPMT";
    this.op            = init?.op            ?? "cumipmt";
    this.paymentTiming = init?.paymentTiming ?? "end";
    this.addInput("rate",  numIn("Rate"));
    this.addInput("nper",  numIn("Nper"));
    this.addInput("pv",    numIn("PV"));
    this.addInput("start", numIn("Start period"));
    this.addInput("end",   numIn("End period"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { rate?: number[]; nper?: number[]; pv?: number[]; start?: number[]; end?: number[] }) {
    const rate  = inputs.rate?.[0]  ?? this.literals.rate  ?? 0;
    const nper  = inputs.nper?.[0]  ?? this.literals.nper  ?? 0;
    const pv    = inputs.pv?.[0]    ?? this.literals.pv    ?? 0;
    const start = Math.round(inputs.start?.[0] ?? this.literals.start ?? 1);
    const end   = Math.round(inputs.end?.[0]   ?? this.literals.end   ?? 1);
    const type  = this.paymentTiming === "beg" ? 1 : 0;

    let result: number | null = null;

    if (start >= 1 && end >= start && nper > 0) {
      // Compute PMT
      let pmt: number;
      if (Math.abs(rate) < 1e-12) {
        pmt = nper !== 0 ? -(pv + 0) / nper : 0; // fv = 0 assumed
      } else {
        const rN = Math.pow(1 + rate, nper);
        pmt = -(pv * rN) * rate / ((1 + rate * type) * (rN - 1));
      }

      if (Number.isFinite(pmt)) {
        let cumSum = 0;
        for (let per = start; per <= end; per++) {
          let ipmt: number;
          if (Math.abs(rate) < 1e-12) {
            ipmt = 0;
          } else {
            const rPer1 = Math.pow(1 + rate, per - 1);
            const B = pv * rPer1 + pmt * (1 + rate * type) * (rPer1 - 1) / rate;
            if (type === 0) {
              ipmt = B * rate;
            } else {
              ipmt = (B - pmt) * rate;
            }
          }
          cumSum += this.op === "cumipmt" ? ipmt : pmt - ipmt;
        }
        result = Number.isFinite(cumSum) ? cumSum : null;
      }
    }

    this.cachedResult = result;
    return { result };
  }
}

// ─── TBILL ────────────────────────────────────────────────────────────────────

export type TBillOp = "tbilleq" | "tbillprice" | "tbillyield";

export const TBILL_OP_META = {
  tbilleq:    { label: "TBILLEQ",    description: "T-bill bond-equivalent yield from settle, maturity, and discount rate   (Excel: =TBILLEQ)" },
  tbillprice: { label: "TBILLPRICE", description: "T-bill price per $100 face value from settle, maturity, and discount rate   (Excel: =TBILLPRICE)" },
  tbillyield: { label: "TBILLYIELD", description: "T-bill yield from settle, maturity, and price   (Excel: =TBILLYIELD)" },
} satisfies Record<TBillOp, { label: string; description: string }>;

export class TBillNode extends ClassicPreset.Node {
  label: string;
  op: TBillOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { discount: 0.05, price: 97.5 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: TBillOp }) {
    super("TBill");
    this.op    = init?.op    ?? "tbilleq";
    this.label = init?.label ?? TBILL_OP_META[this.op].label;
    this.addInput("settle",   dateIn("Settlement date"));
    this.addInput("maturity", dateIn("Maturity date"));
    if (this.op === "tbillyield") {
      this.addInput("price",    numIn("Price ($100 face)"));
    } else {
      this.addInput("discount", numIn("Discount rate (e.g. 0.05)"));
    }
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; discount?: number[]; price?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0];
    const m = inputs.maturity?.[0];
    if (s == null || m == null || m <= s) { this.cachedResult = null; return { result: null }; }
    const dsm = Math.round(m - s);
    let result: number;
    switch (this.op) {
      case "tbilleq": {
        const d = inputs.discount?.[0] ?? this.literals.discount ?? 0.05;
        result = (365 * d) / (360 - d * dsm);
        break;
      }
      case "tbillprice": {
        const d = inputs.discount?.[0] ?? this.literals.discount ?? 0.05;
        result = 100 * (1 - d * dsm / 360);
        break;
      }
      case "tbillyield": {
        const pr = inputs.price?.[0] ?? this.literals.price ?? 97.5;
        result = ((100 - pr) / pr) * (365 / dsm);
        break;
      }
    }
    this.cachedResult = result!;
    return { result: result! };
  }
}

// ─── DISC / INTRATE / RECEIVED ────────────────────────────────────────────────

export type SecurityDiscOp = "disc" | "intrate" | "received";

export const SECURITY_DISC_OP_META = {
  disc:     { label: "DISC",     description: "Discount rate for a fully-invested security (redemption>price)   (Excel: =DISC)" },
  intrate:  { label: "INTRATE",  description: "Interest rate for a fully-invested security   (Excel: =INTRATE)" },
  received: { label: "RECEIVED", description: "Amount received at maturity for a fully-invested security   (Excel: =RECEIVED)" },
} satisfies Record<SecurityDiscOp, { label: string; description: string }>;

function basisDays(basis: number): number {
  if (basis === 3) return 365;
  if (basis === 1) return 365.25;
  return 360;
}

export class SecurityDiscNode extends ClassicPreset.Node {
  label: string;
  op: SecurityDiscOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { pr: 95, redemption: 100, investment: 1000, discount: 0.05, basis: 0 };
  width = 180; height = 280;

  constructor(init?: { label?: string; op?: SecurityDiscOp }) {
    super("SecurityDisc");
    this.op    = init?.op    ?? "disc";
    this.label = init?.label ?? SECURITY_DISC_OP_META[this.op].label;
    this.addInput("settle",   dateIn("Settlement date"));
    this.addInput("maturity", dateIn("Maturity date"));
    if (this.op === "disc") {
      this.addInput("pr",         numIn("Price (pr)"));
      this.addInput("redemption", numIn("Redemption"));
    } else if (this.op === "intrate") {
      this.addInput("investment", numIn("Investment"));
      this.addInput("redemption", numIn("Redemption"));
    } else {
      this.addInput("investment", numIn("Investment"));
      this.addInput("discount",   numIn("Discount rate"));
    }
    this.addInput("basis", numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; pr?: number[]; redemption?: number[]; investment?: number[]; discount?: number[]; basis?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0];
    const m = inputs.maturity?.[0];
    if (s == null || m == null || m <= s) { this.cachedResult = null; return { result: null }; }
    const dsm   = Math.round(m - s);
    const basis = Math.round(inputs.basis?.[0] ?? this.literals.basis ?? 0);
    const bd    = basisDays(basis);
    let result: number;
    switch (this.op) {
      case "disc": {
        const pr  = inputs.pr?.[0]         ?? this.literals.pr         ?? 95;
        const red = inputs.redemption?.[0] ?? this.literals.redemption ?? 100;
        result = ((red - pr) / red) * (bd / dsm);
        break;
      }
      case "intrate": {
        const inv = inputs.investment?.[0] ?? this.literals.investment ?? 1000;
        const red = inputs.redemption?.[0] ?? this.literals.redemption ?? 100;
        result = ((red - inv) / inv) * (bd / dsm);
        break;
      }
      case "received": {
        const inv  = inputs.investment?.[0] ?? this.literals.investment ?? 1000;
        const disc = inputs.discount?.[0]   ?? this.literals.discount   ?? 0.05;
        const denom = 1 - disc * dsm / bd;
        result = denom <= 0 ? 0 : inv / denom;
        break;
      }
    }
    this.cachedResult = result!;
    return { result: result! };
  }
}

// ─── COUPON functions (COUPDAYBS / COUPDAYS / COUPDAYSNC / COUPNCD / COUPPCD / COUPNUM) ─

export type CouponOp = "coupdaybs" | "coupdays" | "coupdaysnc" | "coupncd" | "couppcd" | "coupnum";

export const COUPON_OP_META = {
  coupdaybs:  { label: "COUPDAYBS",  description: "Days from beginning of coupon period to settlement   (Excel: =COUPDAYBS)" },
  coupdays:   { label: "COUPDAYS",   description: "Days in the coupon period containing settlement   (Excel: =COUPDAYS)" },
  coupdaysnc: { label: "COUPDAYSNC", description: "Days from settlement to next coupon date   (Excel: =COUPDAYSNC)" },
  coupncd:    { label: "COUPNCD",    description: "Next coupon date after settlement (as a date serial)   (Excel: =COUPNCD)" },
  couppcd:    { label: "COUPPCD",    description: "Previous coupon date before settlement (as a date serial)   (Excel: =COUPPCD)" },
  coupnum:    { label: "COUPNUM",    description: "Number of coupon periods between settlement and maturity   (Excel: =COUPNUM)" },
} satisfies Record<CouponOp, { label: string; description: string }>;

export class CouponNode extends ClassicPreset.Node {
  label: string;
  op: CouponOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { frequency: 2, basis: 0 };
  width = 180; height = 235;

  constructor(init?: { label?: string; op?: CouponOp }) {
    super("Coupon");
    this.op    = init?.op    ?? "coupdaybs";
    this.label = init?.label ?? COUPON_OP_META[this.op].label;
    this.addInput("settle",    dateIn("Settlement date"));
    this.addInput("maturity",  dateIn("Maturity date"));
    this.addInput("frequency", numIn("Freq (1=annual, 2=semi, 4=qtr)"));
    this.addInput("basis",     numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; frequency?: number[]; basis?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0];
    const m = inputs.maturity?.[0];
    if (s == null || m == null) { this.cachedResult = null; return { result: null }; }
    const freq  = Math.round(inputs.frequency?.[0] ?? this.literals.frequency ?? 2);
    const basis = Math.round(inputs.basis?.[0]     ?? this.literals.basis     ?? 0);
    if (![1, 2, 4].includes(freq)) { this.cachedResult = null; return { result: null }; }
    const settle  = serialToJsDate(s);
    const maturity = serialToJsDate(m);
    const { prev, next } = _coupDates(settle, maturity, freq);
    const use30 = basis === 0 || basis === 4;
    let result: number;
    switch (this.op) {
      case "coupdaybs":  result = use30 ? _days30_360(prev, settle) : _actualDays(prev, settle); break;
      case "coupdays":   result = use30 ? 360 / freq : basis === 3 ? 365 / freq : _actualDays(prev, next); break;
      case "coupdaysnc": result = use30 ? 360 / freq - _days30_360(prev, settle) : _actualDays(settle, next); break;
      case "coupncd":    result = jsDateToSerial(next); break;
      case "couppcd":    result = jsDateToSerial(prev); break;
      case "coupnum": {
        const step = 12 / freq;
        let count = 0, d = new Date(next.getTime());
        while (d <= maturity) { count++; d = _coupAddMonths(d, step); }
        result = count;
        break;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── ACCRINT ─────────────────────────────────────────────────────────────────

export class AccrintNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.06, par: 1000, frequency: 2, basis: 0 };
  width = 180; height = 280;

  constructor(init?: { label?: string }) {
    super("Accrint");
    this.label = init?.label ?? "ACCRINT";
    this.addInput("issue",     dateIn("Issue date"));
    this.addInput("settle",    dateIn("Settlement date"));
    this.addInput("rate",      numIn("Annual coupon rate"));
    this.addInput("par",       numIn("Par value"));
    this.addInput("frequency", numIn("Freq (1/2/4)"));
    this.addInput("basis",     numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Accrued interest"));
  }

  data(inputs: { issue?: number[]; settle?: number[]; rate?: number[]; par?: number[]; frequency?: number[]; basis?: number[] }): { result: number | null } {
    const is = inputs.issue?.[0];
    const ss = inputs.settle?.[0];
    if (is == null || ss == null) { this.cachedResult = null; return { result: null }; }
    const rate  = inputs.rate?.[0]      ?? this.literals.rate      ?? 0.06;
    const par   = inputs.par?.[0]       ?? this.literals.par       ?? 1000;
    const freq  = Math.round(inputs.frequency?.[0] ?? this.literals.frequency ?? 2);
    const basis = Math.round(inputs.basis?.[0]     ?? this.literals.basis     ?? 0);
    if (![1, 2, 4].includes(freq)) { this.cachedResult = null; return { result: null }; }
    const issue  = serialToJsDate(is);
    const settle = serialToJsDate(ss);
    const use30  = basis === 0 || basis === 4;
    const a = use30 ? _days30_360(issue, settle) : _actualDays(issue, settle);
    const e = use30 ? 360 / freq : basis === 3 ? 365 / freq : _actualDays(issue, _coupAddMonths(issue, 12 / freq));
    const result = par * (rate / freq) * (a / e);
    this.cachedResult = result;
    return { result };
  }
}

// ─── ACCRINTM ─────────────────────────────────────────────────────────────────

export class AccrintMNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.06, par: 1000, basis: 0 };
  width = 180; height = 245;

  constructor(init?: { label?: string }) {
    super("AccrintM");
    this.label = init?.label ?? "ACCRINTM";
    this.addInput("issue",  dateIn("Issue date"));
    this.addInput("settle", dateIn("Settlement date"));
    this.addInput("rate",   numIn("Annual coupon rate"));
    this.addInput("par",    numIn("Par value"));
    this.addInput("basis",  numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Accrued interest"));
  }

  data(inputs: { issue?: number[]; settle?: number[]; rate?: number[]; par?: number[]; basis?: number[] }): { result: number | null } {
    const is = inputs.issue?.[0], ss = inputs.settle?.[0];
    if (is == null || ss == null) { this.cachedResult = null; return { result: null }; }
    const rate  = inputs.rate?.[0]  ?? this.literals.rate  ?? 0.06;
    const par   = inputs.par?.[0]   ?? this.literals.par   ?? 1000;
    const basis = Math.round(inputs.basis?.[0] ?? this.literals.basis ?? 0);
    const issue  = serialToJsDate(is), settle = serialToJsDate(ss);
    const use30  = basis === 0 || basis === 4;
    const a = use30 ? _days30_360(issue, settle) : _actualDays(issue, settle);
    const d = basis === 3 ? 365 : basis === 1 ? _actualDays(issue, _coupAddMonths(issue, 12)) : 360;
    const result = par * rate * a / d;
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICEDISC / YIELDDISC ────────────────────────────────────────────────────

export type PriceDiscOp = "pricedisc" | "yielddisc";

export const PRICE_DISC_OP_META = {
  pricedisc: { label: "PRICEDISC", description: "Price per $100 of a discounted security (e.g. T-bill)   (Excel: =PRICEDISC)" },
  yielddisc: { label: "YIELDDISC", description: "Annual yield of a discounted security   (Excel: =YIELDDISC)" },
} satisfies Record<PriceDiscOp, { label: string; description: string }>;

export class PriceDiscNode extends ClassicPreset.Node {
  label: string;
  op: PriceDiscOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { discount: 0.05, pr: 97, redemption: 100, basis: 0 };
  width = 180; height = 255;

  constructor(init?: { label?: string; op?: PriceDiscOp }) {
    super("PriceDisc");
    this.op    = init?.op    ?? "pricedisc";
    this.label = init?.label ?? PRICE_DISC_OP_META[this.op].label;
    this.addInput("settle",     dateIn("Settlement date"));
    this.addInput("maturity",   dateIn("Maturity date"));
    this.addInput("discount",   numIn("Discount rate"));
    this.addInput("pr",         numIn("Price (YIELDDISC only)"));
    this.addInput("redemption", numIn("Redemption (default 100)"));
    this.addInput("basis",      numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; discount?: number[]; pr?: number[]; redemption?: number[]; basis?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0], m = inputs.maturity?.[0];
    if (s == null || m == null) { this.cachedResult = null; return { result: null }; }
    const basis      = Math.round(inputs.basis?.[0]      ?? this.literals.basis      ?? 0);
    const redemption = inputs.redemption?.[0]             ?? this.literals.redemption ?? 100;
    const settle  = serialToJsDate(s), maturity = serialToJsDate(m);
    const use30   = basis === 0 || basis === 4;
    const dsm = use30 ? _days30_360(settle, maturity) : _actualDays(settle, maturity);
    const B   = basis === 3 ? 365 : 360;
    let result: number;
    if (this.op === "pricedisc") {
      const disc = inputs.discount?.[0] ?? this.literals.discount ?? 0.05;
      result = redemption * (1 - disc * dsm / B);
    } else {
      const pr = inputs.pr?.[0] ?? this.literals.pr ?? 97;
      result = (redemption - pr) / pr * B / dsm;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICEMAT / YIELDMAT ──────────────────────────────────────────────────────

export type PriceMatOp = "pricemat" | "yieldmat";

export const PRICE_MAT_OP_META = {
  pricemat: { label: "PRICEMAT", description: "Price per $100 of a security that pays interest at maturity   (Excel: =PRICEMAT)" },
  yieldmat: { label: "YIELDMAT", description: "Annual yield of a security that pays interest at maturity   (Excel: =YIELDMAT)" },
} satisfies Record<PriceMatOp, { label: string; description: string }>;

export class PriceMatNode extends ClassicPreset.Node {
  label: string;
  op: PriceMatOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.06, yld: 0.065, pr: 99, basis: 0 };
  width = 180; height = 280;

  constructor(init?: { label?: string; op?: PriceMatOp }) {
    super("PriceMat");
    this.op    = init?.op    ?? "pricemat";
    this.label = init?.label ?? PRICE_MAT_OP_META[this.op].label;
    this.addInput("settle",   dateIn("Settlement date"));
    this.addInput("maturity", dateIn("Maturity date"));
    this.addInput("issue",    dateIn("Issue date"));
    this.addInput("rate",     numIn("Coupon rate"));
    this.addInput("yld",      numIn("Yield (PRICEMAT only)"));
    this.addInput("pr",       numIn("Price (YIELDMAT only)"));
    this.addInput("basis",    numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; issue?: number[]; rate?: number[]; yld?: number[]; pr?: number[]; basis?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0], m = inputs.maturity?.[0], is = inputs.issue?.[0];
    if (s == null || m == null || is == null) { this.cachedResult = null; return { result: null }; }
    const rate  = inputs.rate?.[0] ?? this.literals.rate ?? 0.06;
    const basis = Math.round(inputs.basis?.[0] ?? this.literals.basis ?? 0);
    const settle = serialToJsDate(s), maturity = serialToJsDate(m), issue = serialToJsDate(is);
    const use30  = basis === 0 || basis === 4;
    const dsm = use30 ? _days30_360(settle, maturity) : _actualDays(settle, maturity);
    const B   = basis === 3 ? 365 : basis === 1 ? _actualDays(issue, _coupAddMonths(issue, 12)) : 360;
    let result: number;
    if (this.op === "pricemat") {
      const yld = inputs.yld?.[0] ?? this.literals.yld ?? 0.065;
      result = 100 * (1 + dsm * rate / B) / (1 + dsm * yld / B);
    } else {
      const pr = inputs.pr?.[0] ?? this.literals.pr ?? 99;
      result = (100 * (1 + dsm * rate / B) / (pr / 100) - 1) * B / dsm;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── DURATION / MDURATION ─────────────────────────────────────────────────────

export type DurationOp = "duration" | "mduration";

export const DURATION_OP_META = {
  duration:  { label: "DURATION",  description: "Macaulay duration — weighted average time to receive cash flows   (Excel: =DURATION)" },
  mduration: { label: "MDURATION", description: "Modified duration — price sensitivity to yield changes   (Excel: =MDURATION)" },
} satisfies Record<DurationOp, { label: string; description: string }>;

export class DurationNode extends ClassicPreset.Node {
  label: string;
  op: DurationOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { coupon: 0.08, yld: 0.09, frequency: 2, basis: 0 };
  width = 180; height = 265;

  constructor(init?: { label?: string; op?: DurationOp }) {
    super("Duration");
    this.op    = init?.op    ?? "duration";
    this.label = init?.label ?? DURATION_OP_META[this.op].label;
    this.addInput("settle",    dateIn("Settlement date"));
    this.addInput("maturity",  dateIn("Maturity date"));
    this.addInput("coupon",    numIn("Annual coupon rate"));
    this.addInput("yld",       numIn("Annual yield"));
    this.addInput("frequency", numIn("Freq (1=annual, 2=semi, 4=qtr)"));
    this.addInput("basis",     numIn("Basis (0=30/360)"));
    this.addOutput("result", numOut("Years"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; coupon?: number[]; yld?: number[]; frequency?: number[]; basis?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0], m = inputs.maturity?.[0];
    if (s == null || m == null) { this.cachedResult = null; return { result: null }; }
    const coupon = inputs.coupon?.[0]    ?? this.literals.coupon    ?? 0.08;
    const yld    = inputs.yld?.[0]       ?? this.literals.yld       ?? 0.09;
    const freq   = Math.round(inputs.frequency?.[0] ?? this.literals.frequency ?? 2);
    if (![1, 2, 4].includes(freq)) { this.cachedResult = null; return { result: null }; }
    const settle  = serialToJsDate(s), maturity = serialToJsDate(m);
    const { prev, next } = _coupDates(settle, maturity, freq);
    // Fractional first period (fraction of coupon period remaining)
    const dsc = _actualDays(settle, next) / _actualDays(prev, next);
    // Count coupon periods
    const step = 12 / freq;
    let N = 0; let d = new Date(next.getTime());
    while (d <= maturity) { N++; d = _coupAddMonths(d, step); }
    const C = coupon / freq * 100;
    const y = yld / freq;
    let price = 0, durNum = 0;
    for (let k = 1; k <= N; k++) {
      const t  = k - 1 + dsc;
      const cf = k === N ? C + 100 : C;
      const pv = cf / Math.pow(1 + y, t);
      price  += pv;
      durNum += t * pv;
    }
    if (price === 0) { this.cachedResult = null; return { result: null }; }
    const durYears = durNum / price / freq;
    const result   = this.op === "duration" ? durYears : durYears / (1 + y);
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICE / YIELD ────────────────────────────────────────────────────────────

function _bondCouponCount(next: Date, maturity: Date, freq: number): number {
  const step = 12 / freq;
  let N = 0; let d = new Date(next.getTime());
  while (d <= maturity) { N++; d = _coupAddMonths(d, step); }
  return N;
}

function _bondPrice(settle: Date, maturity: Date, couponRate: number, yld: number, redemption: number, freq: number): number {
  const { prev, next } = _coupDates(settle, maturity, freq);
  const E = _days30_360(prev, next);
  const DSC = _days30_360(settle, next);
  const A = E - DSC;
  const N = _bondCouponCount(next, maturity, freq);
  const C = couponRate / freq * 100;
  const y = yld / freq;
  let dirty = redemption / Math.pow(1 + y, N - 1 + DSC/E);
  for (let k = 1; k <= N; k++) dirty += C / Math.pow(1 + y, k - 1 + DSC/E);
  return dirty - C * A / E;
}

function _bondYield(settle: Date, maturity: Date, couponRate: number, pr: number, redemption: number, freq: number): number {
  let yld = couponRate > 0 ? couponRate : 0.05;
  for (let i = 0; i < 100; i++) {
    const p  = _bondPrice(settle, maturity, couponRate, yld, redemption, freq);
    const dp = (_bondPrice(settle, maturity, couponRate, yld + 1e-7, redemption, freq) - p) / 1e-7;
    if (Math.abs(dp) < 1e-15) break;
    const delta = (p - pr) / dp;
    yld -= delta;
    if (Math.abs(delta) < 1e-10) break;
    yld = Math.max(-0.9999, Math.min(100, yld));
  }
  return yld;
}

export type BondPriceOp = "price" | "yield";

export const BOND_PRICE_OP_META = {
  price: { label: "PRICE", description: "Clean price per $100 face for a coupon bond (30/360 basis)   (Excel: =PRICE)" },
  yield: { label: "YIELD", description: "Annual yield of a coupon bond given its market price (30/360 basis)   (Excel: =YIELD)" },
} satisfies Record<BondPriceOp, { label: string; description: string }>;

export class BondPriceNode extends ClassicPreset.Node {
  label: string;
  op: BondPriceOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.065, yld: 0.07, pr: 97.5, redemption: 100, frequency: 2 };
  width = 180; height = 280;

  constructor(init?: { label?: string; op?: BondPriceOp }) {
    super("BondPrice");
    this.op    = init?.op    ?? "price";
    this.label = init?.label ?? BOND_PRICE_OP_META[this.op].label;
    this.addInput("settle",     dateIn("Settlement date"));
    this.addInput("maturity",   dateIn("Maturity date"));
    this.addInput("rate",       numIn("Coupon rate"));
    this.addInput("yld",        numIn("Yield (PRICE only)"));
    this.addInput("pr",         numIn("Price (YIELD only)"));
    this.addInput("redemption", numIn("Redemption (default 100)"));
    this.addInput("frequency",  numIn("Frequency (1/2/4)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; rate?: number[]; yld?: number[]; pr?: number[]; redemption?: number[]; frequency?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0], m = inputs.maturity?.[0];
    if (s == null || m == null) { this.cachedResult = null; return { result: null }; }
    const rate       = inputs.rate?.[0]       ?? this.literals.rate       ?? 0.065;
    const redemption = inputs.redemption?.[0] ?? this.literals.redemption ?? 100;
    const freq       = Math.round(inputs.frequency?.[0] ?? this.literals.frequency ?? 2);
    const settle = serialToJsDate(s), maturity = serialToJsDate(m);
    let result: number;
    if (this.op === "price") {
      const yld = inputs.yld?.[0] ?? this.literals.yld ?? 0.07;
      result = _bondPrice(settle, maturity, rate, yld, redemption, freq);
    } else {
      const pr = inputs.pr?.[0] ?? this.literals.pr ?? 97.5;
      result = _bondYield(settle, maturity, rate, pr, redemption, freq);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── XIRR ─────────────────────────────────────────────────────────────────────

export class XirrNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Xirr");
    this.label = init?.label ?? "XIRR";
    this.addInput("values", listIn("Cash flows"));
    this.addInput("dates",  listIn("Date serials"));
    this.addOutput("result", numOut("Internal rate of return"));
  }

  data(inputs: { values?: number[][]; dates?: number[][] }): { result: number | SolError | null } {
    const values = inputs.values?.[0] ?? [];
    const dates  = inputs.dates?.[0]  ?? [];
    const n = Math.min(values.length, dates.length);
    if (n < 2) { this.cachedResult = null; return { result: null }; }
    const d0 = dates[0];
    let r = 0.1;
    let converged = false;
    for (let iter = 0; iter < 100; iter++) {
      let f = 0, df = 0;
      for (let i = 0; i < n; i++) {
        const t = (dates[i] - d0) / 365;
        const disc = Math.pow(1 + r, t);
        f  += values[i] / disc;
        df -= values[i] * t / (disc * (1 + r));
      }
      if (Math.abs(df) < 1e-15) break;
      const delta = f / df;
      r -= delta;
      if (Math.abs(delta) < 1e-10) { converged = true; break; }
      r = Math.max(-0.9999, r);
    }
    // Like RATE/IRR, the Newton solve can stall on cash flows with no real
    // rate of return — Excel returns #NUM!, we split that into #CONV!.
    if (!converged || !Number.isFinite(r)) {
      const err = solError("#CONV!", "XIRR couldn't converge — the dated cash flows may have no internal rate of return (e.g. they never change sign)");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = r;
    return { result: r };
  }
}

// ─── ODD COUPON — ODDFPRICE / ODDFYIELD / ODDLPRICE / ODDLYIELD ───────────────

export type OddCouponOp = "oddfprice" | "oddfyield" | "oddlprice" | "oddlyield";

export const ODD_COUPON_OP_META = {
  oddfprice: { label: "ODDFPRICE", description: "Price of a bond with an irregular first coupon period   (Excel: =ODDFPRICE)" },
  oddfyield: { label: "ODDFYIELD", description: "Yield of a bond with an irregular first coupon period   (Excel: =ODDFYIELD)" },
  oddlprice: { label: "ODDLPRICE", description: "Price of a bond with an irregular last coupon period   (Excel: =ODDLPRICE)" },
  oddlyield: { label: "ODDLYIELD", description: "Yield of a bond with an irregular last coupon period   (Excel: =ODDLYIELD)" },
} satisfies Record<OddCouponOp, { label: string; description: string }>;

function _oddfPrice(settle: Date, maturity: Date, issue: Date, firstCoupon: Date,
                    couponRate: number, yld: number, redemption: number, freq: number): number {
  if (settle >= firstCoupon) return _bondPrice(settle, maturity, couponRate, yld, redemption, freq);
  const step = 12 / freq;
  const E = 360 / freq;
  // Generate quasi-coupon dates backwards from firstCoupon
  const qcs: Date[] = [];
  let d = new Date(firstCoupon.getTime());
  do { qcs.unshift(new Date(d.getTime())); d = _coupAddMonths(d, -step); } while (d >= issue);
  const oddStart = _coupAddMonths(qcs[0], -step);
  const NLi = _days30_360(oddStart, firstCoupon) / E;
  let prevQC = oddStart;
  for (const qc of qcs) { if (qc <= settle) prevQC = qc; else break; }
  const Ai = _days30_360(prevQC, settle) / E;
  const DSC = _days30_360(settle, firstCoupon);
  const N = _bondCouponCount(firstCoupon, maturity, freq);
  const y = yld / freq, C = couponRate / freq * 100;
  let price = redemption / Math.pow(1 + y, N - 1 + DSC/E);
  for (let k = 1; k <= N; k++) price += C / Math.pow(1 + y, k - 1 + DSC/E);
  price += C * (NLi - Ai) / Math.pow(1 + y, DSC/E);
  price -= C * Ai;
  return price;
}

function _oddlPrice(settle: Date, maturity: Date, lastInterest: Date,
                    couponRate: number, yld: number, redemption: number, freq: number): number {
  const E = 360 / freq;
  const oddDays = _days30_360(lastInterest, maturity);
  const Nc = oddDays / E;
  const finalCF = redemption + couponRate / freq * 100 * Nc;
  if (settle >= lastInterest) {
    const DSC = _days30_360(settle, maturity);
    const A = _days30_360(lastInterest, settle);
    const price = finalCF / Math.pow(1 + yld/freq, DSC/E);
    return price - couponRate / freq * 100 * A / E;
  }
  // Regular coupons between settle and lastInterest, then odd last
  const { prev, next } = _coupDates(settle, lastInterest, freq);
  const DSC = _days30_360(settle, next);
  const A = _days30_360(prev, settle);
  const N = _bondCouponCount(next, lastInterest, freq);
  const y = yld / freq, C = couponRate / freq * 100;
  // finalCF is at maturity, which is N regular coupon periods + Nc odd period after next
  let price = finalCF / Math.pow(1 + y, N - 1 + DSC/E + Nc);
  for (let k = 1; k <= N; k++) price += C / Math.pow(1 + y, k - 1 + DSC/E);
  price -= C * A / E;
  return price;
}

export class OddCouponNode extends ClassicPreset.Node {
  label: string;
  op: OddCouponOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.0775, yld: 0.085, pr: 99.5, redemption: 100, frequency: 2 };
  width = 180; height = 300;

  constructor(init?: { label?: string; op?: OddCouponOp }) {
    super("OddCoupon");
    this.op    = init?.op    ?? "oddfprice";
    this.label = init?.label ?? ODD_COUPON_OP_META[this.op].label;
    const isFirst = this.op === "oddfprice" || this.op === "oddfyield";
    this.addInput("settle",     dateIn("Settlement date"));
    this.addInput("maturity",   dateIn("Maturity date"));
    if (isFirst) {
      this.addInput("issue",      dateIn("Issue date"));
      this.addInput("firstlast",  dateIn("First coupon date"));
    } else {
      this.addInput("firstlast",  dateIn("Last interest date"));
    }
    this.addInput("rate",       numIn("Coupon rate"));
    this.addInput("yld",        numIn("Yield (PRICE ops only)"));
    this.addInput("pr",         numIn("Price (YIELD ops only)"));
    this.addInput("redemption", numIn("Redemption (default 100)"));
    this.addInput("frequency",  numIn("Frequency (1/2/4)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { settle?: number[]; maturity?: number[]; issue?: number[]; firstlast?: number[]; rate?: number[]; yld?: number[]; pr?: number[]; redemption?: number[]; frequency?: number[] }): { result: number | null } {
    const s = inputs.settle?.[0], m = inputs.maturity?.[0], fl = inputs.firstlast?.[0];
    if (s == null || m == null || fl == null) { this.cachedResult = null; return { result: null }; }
    const rate       = inputs.rate?.[0]       ?? this.literals.rate       ?? 0.0775;
    const redemption = inputs.redemption?.[0] ?? this.literals.redemption ?? 100;
    const freq       = Math.round(inputs.frequency?.[0] ?? this.literals.frequency ?? 2);
    const settle = serialToJsDate(s), maturity = serialToJsDate(m), flDate = serialToJsDate(fl);
    const isFirst = this.op === "oddfprice" || this.op === "oddfyield";
    const issue = isFirst ? serialToJsDate(inputs.issue?.[0] ?? s) : settle;
    let result: number;
    if (this.op === "oddfprice") {
      const yld = inputs.yld?.[0] ?? this.literals.yld ?? 0.085;
      result = _oddfPrice(settle, maturity, issue, flDate, rate, yld, redemption, freq);
    } else if (this.op === "oddfyield") {
      const pr = inputs.pr?.[0] ?? this.literals.pr ?? 99.5;
      let yld = rate > 0 ? rate : 0.05;
      for (let i = 0; i < 100; i++) {
        const p  = _oddfPrice(settle, maturity, issue, flDate, rate, yld, redemption, freq);
        const dp = (_oddfPrice(settle, maturity, issue, flDate, rate, yld + 1e-7, redemption, freq) - p) / 1e-7;
        if (Math.abs(dp) < 1e-15) break;
        const delta = (p - pr) / dp;
        yld -= delta;
        if (Math.abs(delta) < 1e-10) break;
        yld = Math.max(-0.9999, Math.min(100, yld));
      }
      result = yld;
    } else if (this.op === "oddlprice") {
      const yld = inputs.yld?.[0] ?? this.literals.yld ?? 0.085;
      result = _oddlPrice(settle, maturity, flDate, rate, yld, redemption, freq);
    } else {
      const pr = inputs.pr?.[0] ?? this.literals.pr ?? 99.5;
      let yld = rate > 0 ? rate : 0.05;
      for (let i = 0; i < 100; i++) {
        const p  = _oddlPrice(settle, maturity, flDate, rate, yld, redemption, freq);
        const dp = (_oddlPrice(settle, maturity, flDate, rate, yld + 1e-7, redemption, freq) - p) / 1e-7;
        if (Math.abs(dp) < 1e-15) break;
        const delta = (p - pr) / dp;
        yld -= delta;
        if (Math.abs(delta) < 1e-10) break;
        yld = Math.max(-0.9999, Math.min(100, yld));
      }
      result = yld;
    }
    this.cachedResult = isNaN(result) ? null : result;
    return { result: this.cachedResult };
  }
}

// ─── XNPV ────────────────────────────────────────────────────────────────────

export class XnpvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { rate: 0.1 };
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("Xnpv");
    this.label = init?.label ?? "XNPV";
    this.addInput("rate",   numIn("Discount rate"));
    this.addInput("values", listIn("Cash flows"));
    this.addInput("dates",  listIn("Date serials"));
    this.addOutput("result", numOut("Net present value"));
  }

  data(inputs: { rate?: number[]; values?: number[][]; dates?: number[][] }): { result: number | null } {
    const rate   = inputs.rate?.[0]   ?? this.literals.rate ?? 0.1;
    const values = inputs.values?.[0] ?? [];
    const dates  = inputs.dates?.[0]  ?? [];
    if (values.length === 0 || dates.length === 0) { this.cachedResult = null; return { result: null }; }
    // Truncate to equal length BEFORE handing off — verified Formula.js's XNPV takes
    // our date serials directly (no Date-object conversion needed) and matches this
    // year-fraction-from-365 formula exactly, but its own ragged-array behavior is
    // untested, so keep that truncation hand-rolled.
    const n      = Math.min(values.length, dates.length);
    const result = resolveExcelFunction("XNPV")!(rate, values.slice(0, n), dates.slice(0, n)) as number;
    this.cachedResult = result;
    return { result };
  }
}