import { ClassicPreset } from "rete";
import { numIn, numOut, listIn, listOut, dateIn, dateListIn, frameOut, readInput } from "./shared";
import type { FrameValue } from "../frame";
import { serialToJsDate } from "./date";
import { solError, type SolError } from "../errorValue";
import { resolveExcelFunction } from "../excelFunctions";
import { EquationNode } from "./equation";
// The pure bond/security math, shared verbatim with the formula surface
// (financeOps.ts). The op types stay re-exported so the node barrel keeps its shape.
import {
  coupAddMonths, days30_360, actualDays,
  couponValue, accrintM, securityDisc, priceDisc, priceMat, durationValue,
  bondPriceYield, oddCoupon, vdb, solveDiscountRate, cashPrep, datedPrep, mirr, amortizationSchedule,
  returnsOp, RETURNS_OP_META, type ReturnsOp,
} from "./financeOps";
export { RETURNS_OP_META } from "./financeOps";
export type { ReturnsOp } from "./financeOps";
import type {
  CouponOp, SecurityDiscOp, PriceDiscOp, PriceMatOp, DurationOp, BondPriceOp, OddCouponOp,
} from "./financeOps";
export type {
  CouponOp, SecurityDiscOp, PriceDiscOp, PriceMatOp, DurationOp, BondPriceOp, OddCouponOp,
} from "./financeOps";

export type PaymentTiming = "end" | "beg";
export const PAYMENT_TIMING_META: Record<PaymentTiming, string> = {
  end: "End of period (0)",
  beg: "Beginning of period (1)",
};

// ─── Coupon / accrual date helpers ────────────────────────────────────────────

// ─── Bitwise ──────────────────────────────────────────────────────────────────
export type BitwiseOp = "bitand" | "bitor" | "bitxor" | "bitlshift" | "bitrshift";

export const BITWISE_OP_META = {
  bitand:    { label: "BITAND",    description: "Bitwise AND: keeps only the bits set in both numbers (mask out the rest). Non-negative integers. Excel: BITAND." },
  bitor:     { label: "BITOR",     description: "Bitwise OR: sets a bit if it's on in either number (combine flags). Excel: BITOR." },
  bitxor:    { label: "BITXOR",    description: "Bitwise XOR: sets a bit where the two numbers differ (toggle flags). Excel: BITXOR." },
  bitlshift: { label: "BITLSHIFT", description: "Shifts A's bits left by B places. Each place doubles the value (A × 2ᴮ). Excel: BITLSHIFT." },
  bitrshift: { label: "BITRSHIFT", description: "Shifts A's bits right by B places. Each place halves it, dropping low bits (⌊A ÷ 2ᴮ⌋). Excel: BITRSHIFT." },
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
    const aRaw = readInput(inputs.a, this.literals.a ?? 0);
    const bRaw = readInput(inputs.b, this.literals.b ?? 0);
    if (aRaw === null || bRaw === null) { this.cachedResult = null; return { result: null }; }
    const a = Math.trunc(aRaw);
    const b = Math.trunc(bRaw);
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

// ─── Depreciation ─────────────────────────────────────────────────────────────
export type DepreciationOp = "sln" | "syd" | "ddb" | "db" | "vdb";

export const DEPRECIATION_OP_META = {
  sln: { label: "SLN", description: "Straight-line depreciation: the asset loses the same amount every period. Excel: SLN(cost, salvage, life)." },
  syd: { label: "SYD", description: "Sum-of-years'-digits depreciation, accelerated: writes off more in the early periods, tapering each year. Excel: SYD(cost, salvage, life, per)." },
  ddb: { label: "DDB", description: "Double-declining-balance depreciation, accelerated: takes twice the straight-line rate off the remaining value each period. Excel: DDB(cost, salvage, life, period, [factor])." },
  db:  { label: "DB",  description: "Fixed-declining-balance depreciation, accelerated: a constant rate applied to the remaining value each period. Month sets the number of months in the first year (default 12). Excel: DB(cost, salvage, life, period, [month])." },
  vdb: { label: "VDB", description: "Variable declining balance depreciation over a period range. Uses DDB and switches to straight-line when SL gives a higher deduction. Excel: VDB." },
} satisfies Record<DepreciationOp, { label: string; description: string }>;

// Per-op input rows: the shared cost/salvage/life trunk, then each method's own
// period/factor tail (VDB depreciates a period RANGE).
const DEPRECIATION_INPUTS: Record<DepreciationOp, ReadonlyArray<{ key: string; label: string; def: number }>> = (() => {
  const cost    = { key: "cost",    label: "Cost",           def: 10000 };
  const salvage = { key: "salvage", label: "Salvage",        def: 1000 };
  const life    = { key: "life",    label: "Life (periods)", def: 5 };
  const per     = { key: "per",     label: "Period",         def: 1 };
  const factor  = { key: "factor",  label: "Factor",         def: 2 };
  const month   = { key: "month",   label: "Month (1st yr)", def: 12 };
  const start   = { key: "start",   label: "Start period",   def: 0 };
  const end     = { key: "end",     label: "End period",     def: 1 };
  return {
    sln: [cost, salvage, life],
    syd: [cost, salvage, life, per],
    ddb: [cost, salvage, life, per, factor],
    db:  [cost, salvage, life, per, month],
    vdb: [cost, salvage, life, start, end, factor],
  };
})();

export class DepreciationNode extends ClassicPreset.Node {
  label: string;
  op: DepreciationOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = {};
  width = 180; height = 310;

  constructor(init?: { label?: string; op?: DepreciationOp }) {
    super("Depreciation");
    this.op = init?.op ?? "sln";
    this.label = init?.label ?? DEPRECIATION_OP_META[this.op].label;
    for (const i of DEPRECIATION_INPUTS[this.op]) this.addInput(i.key, numIn(i.label));
    this.addOutput("result", numOut("Result"));
    this.seedLiterals();
    this.height = this.heightFor();
  }

  private heightFor(): number {
    return 170 + 28 * DEPRECIATION_INPUTS[this.op].length;
  }

  private seedLiterals(): void {
    for (const i of DEPRECIATION_INPUTS[this.op]) this.literals[i.key] ??= i.def;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (onePrunePath). */
  keysDroppedBySwitch(next: DepreciationOp): string[] {
    const keep = new Set(DEPRECIATION_INPUTS[next].map((i) => i.key));
    return DEPRECIATION_INPUTS[this.op].filter((i) => !keep.has(i.key)).map((i) => i.key);
  }

  setOp(next: DepreciationOp): void {
    if (next === this.op) return;
    const before = DEPRECIATION_INPUTS[this.op];
    this.op = next;
    const after = DEPRECIATION_INPUTS[next];
    for (const i of before) if (!after.some((j) => j.key === i.key)) this.removeInput(i.key);
    for (const i of after) if (!this.inputs[i.key]) this.addInput(i.key, numIn(i.label));
    // Factor moves between tail positions across ops; re-seat it so the row order
    // matches the spec.
    const inputs = this.inputs as Record<string, unknown>;
    for (const i of after) {
      const v = inputs[i.key];
      delete inputs[i.key];
      inputs[i.key] = v;
    }
    this.seedLiterals();
    this.height = this.heightFor();
  }

  data(inputs: { cost?: number[]; salvage?: number[]; life?: number[]; per?: number[]; factor?: number[]; month?: number[]; start?: number[]; end?: number[] }) {
    const cost    = readInput(inputs.cost, this.literals.cost ?? null);
    const salvage = readInput(inputs.salvage, this.literals.salvage ?? null);
    const life    = readInput(inputs.life, this.literals.life ?? null);
    let result: number | null = null;
    if (this.op === "vdb") {
      const start  = readInput(inputs.start, this.literals.start ?? 0);
      const end    = readInput(inputs.end, this.literals.end ?? 0);
      const factor = readInput(inputs.factor, this.literals.factor ?? 2);
      result = (cost === null || salvage === null || life === null || start === null || end === null || factor === null)
        ? null
        : vdb(cost, salvage, life, start, end, factor);
    } else {
      const per    = readInput(inputs.per, this.literals.per ?? null);
      const factor = readInput(inputs.factor, this.literals.factor ?? 2);
      // The domain GUARDS below stay hand-rolled (they gate which op even runs); only
      // the depreciation formula itself routes through the seam.
      if (cost !== null && salvage !== null && life !== null && life > 0) {
        if (this.op === "sln") {
          result = resolveExcelFunction("SLN")!(cost, salvage, life) as number;
        } else if (per !== null && per >= 1) {
          if (this.op === "syd" && per <= life) {
            result = resolveExcelFunction("SYD")!(cost, salvage, life, per) as number;
          } else if (this.op === "ddb" && per <= life) {
            result = factor === null ? null : resolveExcelFunction("DDB")!(cost, salvage, life, per, factor) as number;
          } else if (this.op === "db") {
            const month = readInput(inputs.month, this.literals.month ?? 12);
            // Excel needs cost > 0 and salvage > 0. Period runs 1..life on this surface —
            // Formula.js's DB #DOMAIN!s the life+1 partial-year period, so we don't offer
            // it either (an equal Excel divergence, not a node↔formula gap).
            if (month !== null && cost > 0 && salvage > 0 && per <= life) {
              result = resolveExcelFunction("DB")!(cost, salvage, life, per, month) as number;
            }
          }
        }
      }
    }
    if (result !== null && !Number.isFinite(result)) result = null;
    this.cachedResult = result;
    return { result };
  }
}

// ─── TVM (Time Value of Money) ────────────────────────────────────────────────
// ONE acausal node for the PMT/PV/FV/NPER/RATE family: wire any four, the fifth solves
// (nper/rate numerically — the smallest-magnitude root avoids the spurious 1+r < 0
// crossing). Payment timing is a CONFIG dropdown, not a variable.

export const TVM_TIMING_EXPRS: Record<PaymentTiming, string> = {
  end: "pv*(1+rate)^nper + pmt*((1+rate)^nper - 1)/rate + fv = 0",
  beg: "pv*(1+rate)^nper + pmt*(1+rate)*((1+rate)^nper - 1)/rate + fv = 0",
};

// The exact limit at the annuity factor's removable singularity (rate = 0), identical
// for both timings, so a zero-interest loan still solves exactly.
const TVM_ZERO_RATE_EXPR = "pv + pmt*nper + fv = 0";

export class TvmNode extends EquationNode {
  static socketDocs: Record<string, string> = {
    ...EquationNode.socketDocs,
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
    pmt: "The payment per period. Money paid out is negative, money received is positive.",
  };

  paymentTiming: PaymentTiming;
  private _zeroRate: EquationNode | null = null;

  constructor(init?: { label?: string; paymentTiming?: PaymentTiming; locked?: boolean }) {
    const timing = init?.paymentTiming ?? "end";
    super({
      label: init?.label ?? "Time Value of Money",
      expr: TVM_TIMING_EXPRS[timing],
      // Locked by default (the relation IS the node); honored from init so the
      // persistence fixed-point sweep round-trips.
      locked: init?.locked ?? true,
    });
    this.paymentTiming = timing;
    // Hero row per variable + the Check row, plus the timing dropdown row.
    this.height = 110 + (this.varNames.length + 1) * 46 + 30;
  }

  setPaymentTiming(t: PaymentTiming) {
    this.paymentTiming = t;
    this.expr = TVM_TIMING_EXPRS[t];
    this._rebuild(); // both forms share one variable set — no socket change
  }

  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    if (inputs.rate?.[0] === 0) {
      // Delegate to the zero-rate limit relation (rate isn't a variable there),
      // then stitch the fixed rate back into this card's caches and outputs.
      const zr = (this._zeroRate ??= new EquationNode({ expr: TVM_ZERO_RATE_EXPR }));
      const out = zr.data(inputs);
      this.cachedError = zr.cachedError;
      this.cachedHolds = zr.cachedHolds;
      this.solvedFor = zr.solvedFor;
      this.cachedValues = { ...zr.cachedValues, rate: 0 };
      out.rate = 0;
      return out;
    }
    return super.data(inputs);
  }
}

// ─── IPMT / PPMT ──────────────────────────────────────────────────────────────
export type IpmtPpmtOp = "ipmt" | "ppmt";

export const IPMT_PPMT_OP_META = {
  ipmt: { label: "IPMT", description: "Interest portion of a periodic payment. Excel: IPMT(rate, per, nper, pv, [fv], [type])." },
  ppmt: { label: "PPMT", description: "Principal portion of a periodic payment. Excel: PPMT(rate, per, nper, pv, [fv], [type])." },
} satisfies Record<IpmtPpmtOp, { label: string; description: string }>;

export class IpmtPpmtNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
    per: "The single period to report, counted from 1.",
  };

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
    const rate = readInput(inputs.rate, this.literals.rate ?? 0);
    const per  = readInput(inputs.per, this.literals.per ?? 1);
    const nper = readInput(inputs.nper, this.literals.nper ?? 0);
    const pv   = readInput(inputs.pv, this.literals.pv ?? 0);
    const fv   = readInput(inputs.fv, this.literals.fv ?? 0);
    if (rate === null || per === null || nper === null || pv === null || fv === null) { this.cachedResult = null; return { result: null }; }
    const type = this.paymentTiming === "beg" ? 1 : 0;

    let result: number | null = null;

    let pmt: number;
    if (Math.abs(rate) < 1e-12) {
      pmt = nper !== 0 ? -(pv + fv) / nper : 0;
    } else {
      const rN = Math.pow(1 + rate, nper);
      pmt = -(pv * rN + fv) * rate / ((1 + rate * type) * (rN - 1));
    }

    if (Number.isFinite(pmt)) {
      // The rate≈0 case stays hand-rolled (trivially 0 interest either way).
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

// ─── NPV ──────────────────────────────────────────────────────────────────────
export const NPV_META = {
  label: "NPV",
  description: "Net present value of cash flows at a given discount rate (first value = period 1). Excel: NPV(rate, values).",
};

// ─── Cash-flow schedule mode (NPV/IRR × periodic/dated) ───────────────────────
// The X-functions are the same calculations with an explicit date per flow: a
// SegToggle reveals the Dates input instead of a second node (Running's window
// pattern).

export type CashflowMode = "periods" | "dates";

export const CASHFLOW_MODE_OPTIONS: { value: CashflowMode; label: string }[] = [
  { value: "periods", label: "Periodic" },
  { value: "dates", label: "Dated" },
];

export class NpvNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "A blank cell counts as zero. Dropping it would shift every later flow.",
    dates: "Values discount back to the first date. A blank date makes the whole result blank.",
  };

  label: string;
  mode: CashflowMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.1 };
  // `dates` is a typeable datelist: the CSV the user types is parsed and injected by
  // coerceInputs, and persistence restores it only onto a class that DECLARES the map.
  stringLiterals: Record<string, string> = {};
  width = 180; height = 203;

  constructor(init?: { label?: string; mode?: CashflowMode }) {
    super("Npv");
    this.label = init?.label ?? "NPV";
    this.mode = init?.mode ?? "periods";
    this.addInput("rate", numIn("Rate"));
    this.addInput("list", listIn("Cash flows"));
    if (this.mode === "dates") this.addInput("dates", dateListIn("Dates"));
    this.addOutput("result", numOut("Result"));
    this.height = this.mode === "dates" ? 231 : 203;
  }

  /** The mode owns the Dates socket. Callers on a live graph prune its cables
   *  BEFORE switching to Periodic (onePrunePath). */
  setMode(next: CashflowMode): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "dates") { if (!this.inputs.dates) this.addInput("dates", dateListIn("Dates")); }
    else if (this.inputs.dates) this.removeInput("dates");
    this.height = next === "dates" ? 231 : 203;
  }

  data(inputs: { rate?: number[]; list?: (number | null | SolError)[][]; dates?: number[][] }) {
    const rate = readInput(inputs.rate, this.literals.rate ?? 0.1);
    if (this.mode === "dates") {
      if (rate === null) { this.cachedResult = null; return { result: null }; }
      const prep = datedPrep(inputs.list?.[0] ?? null, (inputs.dates?.[0] ?? []) as (number | null | SolError)[]);
      if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
      if (prep.blank || prep.values.length === 0 || prep.dates.length === 0) { this.cachedResult = null; return { result: null }; }
      // Truncate to equal length BEFORE handing off: Formula.js's XNPV takes our date
      // serials directly, but its ragged-array behavior is untested.
      const n      = Math.min(prep.values.length, prep.dates.length);
      const raw    = resolveExcelFunction("XNPV")!(rate, prep.values.slice(0, n), prep.dates.slice(0, n)) as number;
      // A non-finite result is not a number the graph can carry (no-NaN rule).
      const result = Number.isFinite(raw) ? raw : null;
      this.cachedResult = result;
      return { result };
    }
    const { error, nums: cashflows } = cashPrep(inputs.list?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    if (rate === null) { this.cachedResult = null; return { result: null }; }
    let result: number | null = null;
    if (cashflows.length > 0) {
      const npv = resolveExcelFunction("NPV")!(rate, ...cashflows) as number;
      result = Number.isFinite(npv) ? npv : null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── IRR ──────────────────────────────────────────────────────────────────────

export class IrrNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "A blank cell counts as zero. Dropping it would shift every later flow.",
  };

  label: string;
  mode: CashflowMode;
  cachedResult: number | SolError | null = null;
  // `dates` is a typeable datelist: the CSV the user types is parsed and injected by
  // coerceInputs, and persistence restores it only onto a class that DECLARES the map.
  stringLiterals: Record<string, string> = {};
  width = 180; height = 163;

  constructor(init?: { label?: string; mode?: CashflowMode }) {
    super("Irr");
    this.label = init?.label ?? "IRR";
    this.mode = init?.mode ?? "periods";
    this.addInput("list", listIn("Cash flows"));
    if (this.mode === "dates") this.addInput("dates", dateListIn("Dates"));
    this.addOutput("result", numOut("Result"));
    this.height = this.mode === "dates" ? 191 : 163;
  }

  /** The mode owns the Dates socket. Callers on a live graph prune its cables
   *  BEFORE switching to Periodic (onePrunePath). */
  setMode(next: CashflowMode): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "dates") { if (!this.inputs.dates) this.addInput("dates", dateListIn("Dates")); }
    else if (this.inputs.dates) this.removeInput("dates");
    this.height = next === "dates" ? 191 : 163;
  }

  data(inputs: { list?: (number | null | SolError)[][]; dates?: number[][] }): { result: number | SolError | null } {
    if (this.mode === "dates") return this.dataDated(inputs);
    const { error, nums: cashflows } = cashPrep(inputs.list?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    if (cashflows.length <= 1) {
      this.cachedResult = null;
      return { result: null }; // not wired / too few points — a blank, not an error
    }
    // Periodic flows discount by their position in the series.
    const rate = solveDiscountRate(cashflows, cashflows.map((_, t) => t));
    // Newton ran out of iterations (or hit a flat derivative) without settling —
    // typically an all-same-sign cashflow series with no internal rate at all.
    if (rate === null) {
      const err = solError("#CONV!", "IRR couldn't converge. The cash flows may have no internal rate of return, for example they never change sign.");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = rate;
    return { result: rate };
  }

  private dataDated(inputs: { list?: (number | null | SolError)[][]; dates?: number[][] }): { result: number | SolError | null } {
    // An error outranks an unknown: scan BOTH lists before any arithmetic, or an
    // upstream #DIV/0! masquerades as a #CONV! Newton stall. A null DATE has no
    // reading, so the schedule is unknown and the result propagates blank.
    const prep = datedPrep(inputs.list?.[0] ?? null, (inputs.dates?.[0] ?? []) as (number | null | SolError)[]);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    if (prep.blank) { this.cachedResult = null; return { result: null }; }
    const { values, dates } = prep;
    const n = Math.min(values.length, dates.length);
    if (n < 2) { this.cachedResult = null; return { result: null }; }
    // Dated flows discount by their year fraction from the first date.
    const d0 = dates[0];
    const r = solveDiscountRate(values.slice(0, n), dates.slice(0, n).map((d) => (d - d0) / 365));
    // Like RATE/IRR, the Newton solve can stall on cash flows with no real
    // rate of return — Excel returns #NUM!, we split that into #CONV!.
    if (r === null) {
      const err = solError("#CONV!", "XIRR couldn't converge. The dated cash flows may have no internal rate of return, for example they never change sign.");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = r;
    return { result: r };
  }
}

// ─── MIRR ─────────────────────────────────────────────────────────────────────
export const MIRR_META = {
  label: "MIRR",
  description: "Modified IRR: accounts for cost of capital and reinvestment rate. Excel: MIRR(values, finance_rate, reinvest_rate).",
};

export class MirrNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "A blank cell counts as zero. Dropping it would shift every later flow.",
  };

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
    const finrate    = readInput(inputs.finrate, this.literals.finrate ?? 0.1);
    const reinrate   = readInput(inputs.reinrate, this.literals.reinrate ?? 0.12);
    if (error) { this.cachedResult = error; return { result: error }; }
    if (finrate === null || reinrate === null) { this.cachedResult = null; return { result: null }; }
    if (cashflows.length <= 1) {
      this.cachedResult = null;
      return { result: null }; // not wired / too few points — a blank, not an error
    }
    const result = mirr(cashflows, finrate, reinrate); // shared with the MIRR formula
    this.cachedResult = result;
    return { result };
  }
}

// ─── FVSCHEDULE ───────────────────────────────────────────────────────────────
export const FVSCHEDULE_META = {
  label: "FVSCHEDULE",
  description: "Future value of principal after a schedule of compound interest rates. Excel: FVSCHEDULE(principal, schedule).",
};

export class FvScheduleNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    schedule: "Each rate compounds in order. A blank cell counts as zero interest for that period.",
  };

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
    const pv    = readInput(inputs.pv, this.literals.pv ?? 1000);
    const { error, nums: rates } = cashPrep(inputs.schedule?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    if (pv === null) { this.cachedResult = null; return { result: null }; }
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

// ─── ISPMT ────────────────────────────────────────────────────────────────────
export const ISPMT_META = {
  label: "ISPMT",
  description: "Interest paid in a given period of a straight-line-principal loan. Excel: ISPMT(rate, per, nper, pv).",
};

export class IspmtNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
  };

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
    const rate = readInput(inputs.rate, this.literals.rate ?? 0);
    const per  = readInput(inputs.per, this.literals.per ?? 1);
    const nper = readInput(inputs.nper, this.literals.nper ?? 0);
    const pv   = readInput(inputs.pv, this.literals.pv ?? 0);
    if (rate === null || per === null || nper === null || pv === null) { this.cachedResult = null; return { result: null }; }
    let result: number | null = null;
    if (nper > 0) {
      // Excel returns the interest as a signed cash flow: ISPMT(0.1,1,3,8000000) = -533,333.33,
      // i.e. pv·rate·(per/nper − 1), an outflow for a positive pv (matches Formula.js).
      result = pv * rate * (per / nper - 1);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── DOLLARDE / DOLLARFR ──────────────────────────────────────────────────────
export type DollarOp = "dollarde" | "dollarfr";

export const DOLLAR_OP_META = {
  dollarde: { label: "DOLLARDE", description: "Fractional-notation dollar to decimal (for example, 1.02 in 32nds → 1.0625). Excel: DOLLARDE." },
  dollarfr: { label: "DOLLARFR", description: "Decimal dollar to fractional notation (for example, 1.0625 → 1.02 in 32nds). Excel: DOLLARFR." },
} satisfies Record<DollarOp, { label: string; description: string }>;

export class DollarNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    fraction: "The denominator of the fraction, such as 32 for prices in 32nds.",
  };

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
    const dollar      = readInput(inputs.dollar, this.literals.dollar ?? 0);
    const fractionRaw = readInput(inputs.fraction, this.literals.fraction ?? 32);
    if (dollar === null || fractionRaw === null) { this.cachedResult = null; return { result: null }; }
    const fraction = Math.floor(fractionRaw);
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




// ─── CUMIPMT / CUMPRINC ───────────────────────────────────────────────────────
export type CumPmtOp = "cumipmt" | "cumprinc";

export const CUM_PMT_OP_META = {
  cumipmt:  { label: "CUMIPMT",  description: "Cumulative interest paid between two periods. Excel: CUMIPMT(rate, nper, pv, start_period, end_period, type)." },
  cumprinc: { label: "CUMPRINC", description: "Cumulative principal paid between two periods. Excel: CUMPRINC(rate, nper, pv, start_period, end_period, type)." },
} satisfies Record<CumPmtOp, { label: string; description: string }>;

export class CumPmtNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
    end: "The sum includes both the start and end periods.",
  };

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
    const rate  = readInput(inputs.rate, this.literals.rate ?? 0);
    const nper  = readInput(inputs.nper, this.literals.nper ?? 0);
    const pv    = readInput(inputs.pv, this.literals.pv ?? 0);
    const startRaw = readInput(inputs.start, this.literals.start ?? 1);
    const endRaw   = readInput(inputs.end, this.literals.end ?? 1);
    if (rate === null || nper === null || pv === null || startRaw === null || endRaw === null) {
      this.cachedResult = null; return { result: null };
    }
    const start = Math.round(startRaw);
    const end   = Math.round(endRaw);
    const type  = this.paymentTiming === "beg" ? 1 : 0;

    let result: number | null = null;

    if (start >= 1 && end >= start && nper > 0) {
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
  tbilleq:    { label: "TBILLEQ",    description: "T-bill bond-equivalent yield from settle, maturity, and discount rate. Excel: TBILLEQ." },
  tbillprice: { label: "TBILLPRICE", description: "T-bill price per $100 face value from settle, maturity, and discount rate. Excel: TBILLPRICE." },
  tbillyield: { label: "TBILLYIELD", description: "T-bill yield from settle, maturity, and price. Excel: TBILLYIELD." },
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
        const d = readInput(inputs.discount, this.literals.discount ?? 0.05);
        if (d === null) { this.cachedResult = null; return { result: null }; }
        if (dsm <= 182) {
          result = (365 * d) / (360 - d * dsm);
        } else {
          // Over 182 days Excel switches to the bond-equivalent (coupon-equivalent)
          // yield, solving the semiannual-compounding price equation in closed form
          // (SIA). Verified against real Excel: =TBILLEQ(DATE(2024,1,15),
          // DATE(2024,12,15),0.05) = 0.052539935.
          const t = dsm / 365;
          const price = 1 - d * dsm / 360; // TBILLPRICE per $1
          result = (-t + Math.sqrt(t * t - (2 * t - 1) * (1 - 1 / price))) / (t - 0.5);
        }
        break;
      }
      case "tbillprice": {
        const d = readInput(inputs.discount, this.literals.discount ?? 0.05);
        if (d === null) { this.cachedResult = null; return { result: null }; }
        result = 100 * (1 - d * dsm / 360);
        break;
      }
      case "tbillyield": {
        const pr = readInput(inputs.price, this.literals.price ?? 97.5);
        if (pr === null) { this.cachedResult = null; return { result: null }; }
        // Excel's TBILLYIELD is a money-market yield on a 360-day basis (verified against
        // real Excel: =TBILLYIELD(DATE(2024,1,15),DATE(2024,7,15),97.5) = 0.050718512).
        // The 365 that was here is TBILLEQ's bond-equivalent basis, not this one.
        result = ((100 - pr) / pr) * (360 / dsm);
        break;
      }
    }
    this.cachedResult = result!;
    return { result: result! };
  }
}

// ─── DISC / INTRATE / RECEIVED ────────────────────────────────────────────────

export const SECURITY_DISC_OP_META = {
  disc:     { label: "DISC",     description: "Discount rate for a fully-invested security (redemption>price). Excel: DISC." },
  intrate:  { label: "INTRATE",  description: "Interest rate for a fully-invested security. Excel: INTRATE." },
  received: { label: "RECEIVED", description: "Amount received at maturity for a fully-invested security. Excel: RECEIVED." },
} satisfies Record<SecurityDiscOp, { label: string; description: string }>;

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
    if (s == null || m == null) { this.cachedResult = null; return { result: null }; }
    const basis = readInput(inputs.basis, this.literals.basis ?? 0);
    if (basis === null) { this.cachedResult = null; return { result: null }; }
    // `a` is the price (DISC) or the investment (INTRATE/RECEIVED); `b` the
    // redemption (DISC/INTRATE) or the discount rate (RECEIVED).
    const a = this.op === "disc"
      ? (readInput(inputs.pr, this.literals.pr ?? 95))
      : (readInput(inputs.investment, this.literals.investment ?? 1000));
    const b = this.op === "received"
      ? (readInput(inputs.discount, this.literals.discount ?? 0.05))
      : (readInput(inputs.redemption, this.literals.redemption ?? 100));
    if (a === null || b === null) { this.cachedResult = null; return { result: null }; }
    const result = securityDisc(this.op, s, m, a, b, basis);
    this.cachedResult = result;
    return { result };
  }
}

// ─── COUPON functions (COUPDAYBS / COUPDAYS / COUPDAYSNC / COUPNCD / COUPPCD / COUPNUM) ─

export const COUPON_OP_META = {
  coupdaybs:  { label: "COUPDAYBS",  description: "Days from beginning of coupon period to settlement. Excel: COUPDAYBS." },
  coupdays:   { label: "COUPDAYS",   description: "Days in the coupon period containing settlement. Excel: COUPDAYS." },
  coupdaysnc: { label: "COUPDAYSNC", description: "Days from settlement to next coupon date. Excel: COUPDAYSNC." },
  coupncd:    { label: "COUPNCD",    description: "Next coupon date after settlement (as a date serial). Excel: COUPNCD." },
  couppcd:    { label: "COUPPCD",    description: "Previous coupon date before settlement (as a date serial). Excel: COUPPCD." },
  coupnum:    { label: "COUPNUM",    description: "Number of coupon periods between settlement and maturity. Excel: COUPNUM." },
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
    const freq  = readInput(inputs.frequency, this.literals.frequency ?? 2);
    const basis = readInput(inputs.basis, this.literals.basis ?? 0);
    if (freq === null || basis === null) { this.cachedResult = null; return { result: null }; }
    const result = couponValue(this.op, s, m, freq, basis);
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
    const rate  = readInput(inputs.rate, this.literals.rate ?? 0.06);
    const par   = readInput(inputs.par, this.literals.par ?? 1000);
    const freqRaw = readInput(inputs.frequency, this.literals.frequency ?? 2);
    const basisRaw = readInput(inputs.basis, this.literals.basis ?? 0);
    if (rate === null || par === null || freqRaw === null || basisRaw === null) { this.cachedResult = null; return { result: null }; }
    const freq = Math.round(freqRaw);
    const basis = Math.round(basisRaw);
    if (![1, 2, 4].includes(freq)) { this.cachedResult = null; return { result: null }; }
    const issue  = serialToJsDate(is);
    const settle = serialToJsDate(ss);
    const use30  = basis === 0 || basis === 4;
    const a = use30 ? days30_360(issue, settle) : actualDays(issue, settle);
    const e = use30 ? 360 / freq : basis === 3 ? 365 / freq : actualDays(issue, coupAddMonths(issue, 12 / freq));
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
    const rate  = readInput(inputs.rate, this.literals.rate ?? 0.06);
    const par   = readInput(inputs.par, this.literals.par ?? 1000);
    const basis = readInput(inputs.basis, this.literals.basis ?? 0);
    if (rate === null || par === null || basis === null) { this.cachedResult = null; return { result: null }; }
    const result = accrintM(is, ss, rate, par, basis);
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICEDISC / YIELDDISC ────────────────────────────────────────────────────

export const PRICE_DISC_OP_META = {
  pricedisc: { label: "PRICEDISC", description: "Price per $100 of a discounted security (such as a T-bill). Excel: PRICEDISC." },
  yielddisc: { label: "YIELDDISC", description: "Annual yield of a discounted security. Excel: YIELDDISC." },
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
    const basis      = readInput(inputs.basis, this.literals.basis ?? 0);
    const redemption = readInput(inputs.redemption, this.literals.redemption ?? 100);
    if (basis === null || redemption === null) { this.cachedResult = null; return { result: null }; }
    // The discount rate for PRICEDISC, the market price for YIELDDISC.
    const rateOrPrice = this.op === "pricedisc"
      ? (readInput(inputs.discount, this.literals.discount ?? 0.05))
      : (readInput(inputs.pr, this.literals.pr ?? 97));
    if (rateOrPrice === null) { this.cachedResult = null; return { result: null }; }
    const result = priceDisc(this.op, s, m, rateOrPrice, redemption, basis);
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICEMAT / YIELDMAT ──────────────────────────────────────────────────────

export const PRICE_MAT_OP_META = {
  pricemat: { label: "PRICEMAT", description: "Price per $100 of a security that pays interest at maturity. Excel: PRICEMAT." },
  yieldmat: { label: "YIELDMAT", description: "Annual yield of a security that pays interest at maturity. Excel: YIELDMAT." },
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
    const rate  = readInput(inputs.rate, this.literals.rate ?? 0.06);
    const basis = readInput(inputs.basis, this.literals.basis ?? 0);
    if (rate === null || basis === null) { this.cachedResult = null; return { result: null }; }
    // The yield for PRICEMAT, the market price for YIELDMAT.
    const yldOrPrice = this.op === "pricemat"
      ? (readInput(inputs.yld, this.literals.yld ?? 0.065))
      : (readInput(inputs.pr, this.literals.pr ?? 99));
    if (yldOrPrice === null) { this.cachedResult = null; return { result: null }; }
    const result = priceMat(this.op, s, m, is, rate, yldOrPrice, basis);
    this.cachedResult = result;
    return { result };
  }
}

// ─── DURATION / MDURATION ─────────────────────────────────────────────────────

export const DURATION_OP_META = {
  duration:  { label: "DURATION",  description: "Macaulay duration: the weighted average time to receive cash flows. Excel: DURATION." },
  mduration: { label: "MDURATION", description: "Modified duration: price sensitivity to yield changes. Excel: MDURATION." },
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
    const coupon = readInput(inputs.coupon, this.literals.coupon ?? 0.08);
    const yld    = readInput(inputs.yld, this.literals.yld ?? 0.09);
    const freq   = readInput(inputs.frequency, this.literals.frequency ?? 2);
    const basis  = readInput(inputs.basis, this.literals.basis ?? 0);
    if (coupon === null || yld === null || freq === null || basis === null) { this.cachedResult = null; return { result: null }; }
    const result = durationValue(this.op, s, m, coupon, yld, freq, basis);
    this.cachedResult = result;
    return { result };
  }
}

// ─── PRICE / YIELD ────────────────────────────────────────────────────────────

export const BOND_PRICE_OP_META = {
  price: { label: "PRICE", description: "Clean price per $100 face for a coupon bond (30/360 basis). Excel: PRICE." },
  yield: { label: "YIELD", description: "Annual yield of a coupon bond given its market price (30/360 basis). Excel: YIELD." },
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
    const rate       = readInput(inputs.rate, this.literals.rate ?? 0.065);
    const redemption = readInput(inputs.redemption, this.literals.redemption ?? 100);
    const freq       = readInput(inputs.frequency, this.literals.frequency ?? 2);
    if (rate === null || redemption === null || freq === null) { this.cachedResult = null; return { result: null }; }
    // The yield for PRICE, the market price for YIELD.
    const yldOrPrice = this.op === "price"
      ? (readInput(inputs.yld, this.literals.yld ?? 0.07))
      : (readInput(inputs.pr, this.literals.pr ?? 97.5));
    if (yldOrPrice === null) { this.cachedResult = null; return { result: null }; }
    const result = bondPriceYield(this.op, s, m, rate, yldOrPrice, redemption, freq);
    this.cachedResult = result;
    return { result };
  }
}


// ─── ODD COUPON — ODDFPRICE / ODDFYIELD / ODDLPRICE / ODDLYIELD ───────────────

export const ODD_COUPON_OP_META = {
  oddfprice: { label: "ODDFPRICE", description: "Price of a bond with an irregular first coupon period. Excel: ODDFPRICE." },
  oddfyield: { label: "ODDFYIELD", description: "Yield of a bond with an irregular first coupon period. Excel: ODDFYIELD." },
  oddlprice: { label: "ODDLPRICE", description: "Price of a bond with an irregular last coupon period. Excel: ODDLPRICE." },
  oddlyield: { label: "ODDLYIELD", description: "Yield of a bond with an irregular last coupon period. Excel: ODDLYIELD." },
} satisfies Record<OddCouponOp, { label: string; description: string }>;

export class OddCouponNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    issue: "Left unwired, the issue date falls back to the settlement date.",
  };

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
    const rate       = readInput(inputs.rate, this.literals.rate ?? 0.0775);
    const redemption = readInput(inputs.redemption, this.literals.redemption ?? 100);
    const freq       = readInput(inputs.frequency, this.literals.frequency ?? 2);
    if (rate === null || redemption === null || freq === null) { this.cachedResult = null; return { result: null }; }
    // The yield for the *PRICE ops, the market price for the *YIELD ops (which
    // Newton-solve for the yield that reproduces it).
    const isPrice = this.op === "oddfprice" || this.op === "oddlprice";
    const yldOrPrice = isPrice
      ? (readInput(inputs.yld, this.literals.yld ?? 0.085))
      : (readInput(inputs.pr, this.literals.pr ?? 99.5));
    if (yldOrPrice === null) { this.cachedResult = null; return { result: null }; }
    // UNWIRED `issue` keeps the settlement-date fallback; a WIRED blank is unknown,
    // since pricing as if issued at settlement would fabricate an answer.
    const isFirst = this.op === "oddfprice" || this.op === "oddfyield";
    const issue = isFirst ? readInput(inputs.issue, s) : s;
    if (issue === null) { this.cachedResult = null; return { result: null }; }
    const result = oddCoupon(this.op, s, m, issue, fl, rate, yldOrPrice, redemption, freq);
    this.cachedResult = result;
    return { result: this.cachedResult };
  }
}

// ─── AMORTIZATION SCHEDULE ───────────────────────────────────────────────────
export class AmortizationNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rate: "The rate PER PERIOD — a 6% annual loan paid monthly is 0.005 here, with nper in months.",
    frame: "Period · Payment · Interest · Principal · Balance. Payment, interest and principal carry Excel's sign (negative for a loan received).",
  };
  label: string;
  paymentTiming: PaymentTiming = "end";
  literals: Record<string, number> = { rate: 0.005, nper: 12, pv: 10000, fv: 0 };
  cachedResult: FrameValue | null = null;
  width = 200; height = 230;

  constructor(init?: { label?: string; paymentTiming?: PaymentTiming }) {
    super("Amortization");
    this.label = init?.label ?? "Amortization Schedule";
    if (init?.paymentTiming) this.paymentTiming = init.paymentTiming;
    this.addInput("rate", numIn("Rate per period"));
    this.addInput("nper", numIn("Periods"));
    this.addInput("pv",   numIn("Present value"));
    this.addInput("fv",   numIn("Future value"));
    this.addOutput("frame", frameOut("Schedule"));
  }

  data(inputs: { rate?: number[]; nper?: number[]; pv?: number[]; fv?: number[] }): { frame: FrameValue | null } {
    const rate = readInput(inputs.rate, this.literals.rate ?? 0);
    const nper = readInput(inputs.nper, this.literals.nper ?? 0);
    const pv   = readInput(inputs.pv, this.literals.pv ?? 0);
    const fv   = readInput(inputs.fv, this.literals.fv ?? 0);
    if (rate === null || nper === null || pv === null || fv === null) { this.cachedResult = null; return { frame: null }; }
    const rows = amortizationSchedule(rate, nper, pv, fv, this.paymentTiming === "beg" ? 1 : 0);
    const frame: FrameValue | null = rows.length === 0 ? null : { __frame: true, columns: [
      { name: "Period",    type: "number", values: rows.map((r) => r.period) },
      { name: "Payment",   type: "number", values: rows.map((r) => r.payment) },
      { name: "Interest",  type: "number", values: rows.map((r) => r.interest) },
      { name: "Principal", type: "number", values: rows.map((r) => r.principal) },
      { name: "Balance",   type: "number", values: rows.map((r) => r.balance) },
    ] };
    this.cachedResult = frame;
    return { frame };
  }
}

// ─── RETURNS (return-series quant one-liners) ────────────────────────────────
export class ReturnsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Prices for the price-based ops (log / simple returns, drawdown, CAGR); per-period returns for the rest.",
    rf: "Risk-free rate PER PERIOD (an annual 4% on daily data is 0.04 / 252); 0 when unwired.",
    periods: "Periods per year for annualizing — 252 trading days, 12 months, 1 for none.",
  };
  label: string;
  op: ReturnsOp;
  literals: Record<string, number> = { rf: 0, periods: 1 };
  cachedResult: (number | null | SolError)[] | number | SolError | null = null;
  width = 190; height = 200;

  constructor(init?: { label?: string; op?: ReturnsOp }) {
    super("Returns");
    this.op = init?.op ?? "log";
    this.label = init?.label ?? RETURNS_OP_META[this.op].label;
    this.addInput("list", listIn(ReturnsNode.inputLabel(this.op)));
    for (const k of RETURNS_OP_META[this.op].needs) this.addInput(k, ReturnsNode.extraInput(k));
    this.addOutput("result", ReturnsNode.outputFor(this.op));
  }

  static inputLabel(op: ReturnsOp) { return RETURNS_OP_META[op].takes === "prices" ? "Prices" : "Returns"; }
  static extraInput(k: "rf" | "periods") { return k === "rf" ? numIn("Risk-free / period") : numIn("Periods / year"); }
  static outputFor(op: ReturnsOp) { return RETURNS_OP_META[op].scalar ? numOut(RETURNS_OP_META[op].label) : listOut(RETURNS_OP_META[op].label); }

  /** The op owns the extra sockets (rf / periods) and the output rank. In-place: callers on a
   *  live graph prune the departing extras' cables BEFORE (onePrunePath) and
   *  retypeOutputCables AFTER when `outputChanged`. */
  setOp(next: ReturnsOp): { removed: string[]; outputChanged: boolean } {
    if (next === this.op) return { removed: [], outputChanged: false };
    const before = RETURNS_OP_META[this.op], after = RETURNS_OP_META[next];
    const removed = before.needs.filter((k) => !after.needs.includes(k));
    this.op = next;
    for (const k of removed) if (this.inputs[k]) this.removeInput(k);
    for (const k of after.needs) if (!this.inputs[k]) this.addInput(k, ReturnsNode.extraInput(k));
    const list = this.inputs.list; if (list) list.label = ReturnsNode.inputLabel(next);
    const outputChanged = before.scalar !== after.scalar;
    if (outputChanged) { const spec = ReturnsNode.outputFor(next); this.outputs.result!.socket = spec.socket; }
    this.outputs.result!.label = after.label;
    return { removed, outputChanged };
  }

  data(inputs: { list?: (number | null | SolError)[][]; rf?: number[]; periods?: number[] }) {
    const arr = inputs.list?.[0] ?? null;
    const rf = readInput(inputs.rf, this.literals.rf ?? 0);
    const periods = readInput(inputs.periods, this.literals.periods ?? 1);
    if (arr === null || rf === null || periods === null) { this.cachedResult = null; return { result: null }; }
    const result = returnsOp(this.op, arr, rf, periods);
    this.cachedResult = result;
    return { result };
  }
}
