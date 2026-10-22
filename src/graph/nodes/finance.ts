// [[B11]]
import { ClassicPreset } from "rete";
import { numIn, numOut, listIn, listOut, dateIn, dateListIn, frameOut, BASIS_DOC } from "./shared";
import { setting } from "../inputRoles";
import type { FrameValue } from "../frame";
import type { Shape } from "../frameShape";
import { type SolError } from "../errorValue";
import { nodeOnCore } from "../nodeOnCore";
import { EquationNode } from "./equation";
import { amortizationSchedule, RETURNS_OP_META, type ReturnsOp } from "./financeOps";
export { RETURNS_OP_META } from "./financeOps";
export type { ReturnsOp } from "./financeOps";
import type {
  CouponOp, TBillOp, SecurityDiscOp, PriceDiscOp, PriceMatOp, DurationOp, BondPriceOp, OddCouponOp,
} from "./financeOps";

export type {
  CouponOp, TBillOp, SecurityDiscOp, PriceDiscOp, PriceMatOp, DurationOp, BondPriceOp, OddCouponOp,
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
  bitand:    { label: "BITAND",    description: "Bitwise AND: keeps only the bits set in both numbers (mask out the rest). Non-negative integers. Excel: `BITAND`." },
  bitor:     { label: "BITOR",     description: "Bitwise OR: sets a bit if it's on in either number (combine flags). Excel: `BITOR`." },
  bitxor:    { label: "BITXOR",    description: "Bitwise XOR: sets a bit where the two numbers differ (toggle flags). Excel: `BITXOR`." },
  bitlshift: { label: "BITLSHIFT", description: "Shifts `A`'s bits left by `B` places. Each place doubles the value (`A × 2ᴮ`). Excel: `BITLSHIFT`." },
  bitrshift: { label: "BITRSHIFT", description: "Shifts `A`'s bits right by `B` places. Each place halves it, dropping low bits (`⌊A ÷ 2ᴮ⌋`). Excel: `BITRSHIFT`." },
} satisfies Record<BitwiseOp, { label: string; description: string }>;

export class BitwiseNode extends ClassicPreset.Node {
  label: string;
  op: BitwiseOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: BitwiseOp }) {
    super("Bitwise");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "bitand";
    this.addInput("a", numIn("A"));
    this.addInput("b", numIn("B"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | null } {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}

// ─── Depreciation ─────────────────────────────────────────────────────────────
export type DepreciationOp = "sln" | "syd" | "ddb" | "db" | "vdb";

export const DEPRECIATION_OP_META = {
  sln: { label: "SLN", description: "Straight-line depreciation: the asset loses the same amount every period. Excel: `SLN`." },
  syd: { label: "SYD", description: "Sum-of-years'-digits depreciation, accelerated: writes off more in the early periods, tapering each year. Excel: `SYD`." },
  ddb: { label: "DDB", description: "Double-declining-balance depreciation, accelerated: takes twice the straight-line rate off the remaining value each period. Excel: `DDB`." },
  db:  { label: "DB",  description: "Fixed-declining-balance depreciation, a constant rate on the remaining value. `Month`: months in the first year (default `12`). Excel: `DB`." },
  vdb: { label: "VDB", description: "Variable declining balance depreciation over a period range. Uses `DDB` and switches to straight-line when `SL` gives a higher deduction. Excel: `VDB`." },
} satisfies Record<DepreciationOp, { label: string; description: string }>;

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
  unitAware = true;
  label: string;
  op: DepreciationOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = {};
  width = 180; height = 310;

  constructor(init?: { label?: string; op?: DepreciationOp }) {
    super("Depreciation");
    this.op = init?.op ?? "sln";
    this.label = init?.label ?? "";
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
    // Re-insert every key in table order, because Factor sits at a different row in each op.
    const inputs = this.inputs as Record<string, unknown>;
    for (const i of after) {
      const v = inputs[i.key];
      delete inputs[i.key];
      inputs[i.key] = v;
    }
    this.seedLiterals();
    this.height = this.heightFor();
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── TVM (Time Value of Money) ────────────────────────────────────────────────

export const TVM_TIMING_EXPRS: Record<PaymentTiming, string> = {
  end: "pv*(1+rate)^nper + pmt*((1+rate)^nper - 1)/rate + fv = 0",
  beg: "pv*(1+rate)^nper + pmt*(1+rate)*((1+rate)^nper - 1)/rate + fv = 0",
};

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
      // Honored from init so the persistence round-trip sweep holds.
      locked: init?.locked ?? true,
    });
    this.paymentTiming = timing;
    this.height = 110 + (this.varNames.length + 1) * 46 + 30;
  }

  setPaymentTiming(t: PaymentTiming) {
    this.paymentTiming = t;
    this.expr = TVM_TIMING_EXPRS[t];
    this._rebuild();
  }

  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    if (inputs.rate?.[0] === 0) {
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

// ─── NPV ──────────────────────────────────────────────────────────────────────
export const NPV_META = {
  label: "NPV",
  description: "Net present value of cash flows at a given discount rate (first value = period `1`). Excel: `NPV`.",
};

// ─── Cash-flow schedule mode (NPV/IRR × periodic/dated) ───────────────────────

export type CashflowOp = "periods" | "dates";
export const NPV_OP_META: Record<CashflowOp, { label: string }> = { periods: { label: "NPV" }, dates: { label: "XNPV" } };
export const IRR_OP_META: Record<CashflowOp, { label: string }> = { periods: { label: "IRR" }, dates: { label: "XIRR" } };

export const CASHFLOW_OP_OPTIONS: { value: CashflowOp; label: string }[] = [
  { value: "periods", label: "Periodic" },
  { value: "dates", label: "Dated" },
];

export class NPVNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    list: "A blank cell counts as zero. Dropping it would shift every later flow.",
    dates: "Values discount back to the first date. A blank date makes the whole result blank.",
  };

  label: string;
  op: CashflowOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.1 };
  // Keep this map declared: persistence restores the typed Dates text only onto a class that has it.
  stringLiterals: Record<string, string> = {};
  width = 180; height = 203;

  constructor(init?: { label?: string; op?: CashflowOp }) {
    super("Npv");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "periods";
    this.addInput("rate", numIn("Rate"));
    this.addInput("list", listIn("Cash flows"));
    if (this.op === "dates") this.addInput("dates", dateListIn("Dates"));
    this.addOutput("result", numOut("Result"));
    this.height = this.op === "dates" ? 231 : 203;
  }

  setOp(next: CashflowOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "dates") { if (!this.inputs.dates) this.addInput("dates", dateListIn("Dates")); }
    else if (this.inputs.dates) this.removeInput("dates");
    this.height = next === "dates" ? 231 : 203;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── IRR ──────────────────────────────────────────────────────────────────────

export class IRRNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    list: "A blank cell counts as zero. Dropping it would shift every later flow.",
  };

  label: string;
  op: CashflowOp;
  cachedResult: number | SolError | null = null;
  // Keep this map declared: persistence restores the typed Dates text only onto a class that has it.
  stringLiterals: Record<string, string> = {};
  width = 180; height = 163;

  constructor(init?: { label?: string; op?: CashflowOp }) {
    super("Irr");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "periods";
    this.addInput("list", listIn("Cash flows"));
    if (this.op === "dates") this.addInput("dates", dateListIn("Dates"));
    this.addOutput("result", numOut("Result"));
    this.height = this.op === "dates" ? 191 : 163;
  }

  setOp(next: CashflowOp): void {
    if (next === this.op) return;
    this.op = next;
    if (next === "dates") { if (!this.inputs.dates) this.addInput("dates", dateListIn("Dates")); }
    else if (this.inputs.dates) this.removeInput("dates");
    this.height = next === "dates" ? 191 : 163;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── MIRR ─────────────────────────────────────────────────────────────────────
export const MIRR_META = {
  label: "MIRR",
  description: "Modified `IRR`: accounts for cost of capital and reinvestment rate. Excel: `MIRR`.",
};

export class MirrNode extends ClassicPreset.Node {
  unitAware = true;
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

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── FVSCHEDULE ───────────────────────────────────────────────────────────────
export const FVSCHEDULE_META = {
  label: "FVSCHEDULE",
  description: "Future value of principal after a schedule of compound interest rates. Excel: `FVSCHEDULE`.",
};

export class FvScheduleNode extends ClassicPreset.Node {
  unitAware = true;
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

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── ISPMT ────────────────────────────────────────────────────────────────────
export const ISPMT_META = {
  label: "ISPMT",
  description: "Interest paid in a given period of a straight-line-principal loan. Excel: `ISPMT`.",
};

export class IspmtNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
  };

  label: string;
  cachedResult: number | SolError | null = null;
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

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── DOLLARDE / DOLLARFR ──────────────────────────────────────────────────────
export type DollarOp = "dollarde" | "dollarfr";

export const DOLLAR_OP_META = {
  dollarde: { label: "DOLLARDE", description: "Fractional-notation dollar to decimal (for example, `1.02` in 32nds → `1.0625`). Excel: `DOLLARDE`." },
  dollarfr: { label: "DOLLARFR", description: "Decimal dollar to fractional notation (for example, `1.0625` → `1.02` in 32nds). Excel: `DOLLARFR`." },
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
    this.label = init?.label ?? "";
    this.op    = init?.op    ?? "dollarde";
    this.addInput("dollar",   numIn("Dollar"));
    this.addInput("fraction", numIn("Fraction"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | null } {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}




// ─── Spec-table op cards ──────────────────────────────────────────────────────

function keysDroppedBy(before: string[], after: string[]): string[] {
  const keep = new Set(after);
  return before.filter((k) => !keep.has(k));
}

function reshapeInputs(node: ClassicPreset.Node, after: string[], make: (key: string) => ClassicPreset.Input<ClassicPreset.Socket>): void {
  for (const k of Object.keys(node.inputs)) if (!after.includes(k)) node.removeInput(k);
  const ordered: typeof node.inputs = {};
  for (const k of after) ordered[k] = node.inputs[k] ?? make(k);
  node.inputs = ordered;
}

// ─── Discount securities: ONE card ───────────────────────────────────────────

export type DiscountSecurityOp = TBillOp | SecurityDiscOp | PriceDiscOp | PriceMatOp;

export const DISCOUNT_SECURITY_META: Record<DiscountSecurityOp, { label: string; description: string; group: string; keys: readonly string[] }> = {
  tbilleq:    { group: "Treasury bill", label: "TBILLEQ",    keys: ["discount"], description: "T-bill bond-equivalent yield from settle, maturity, and discount rate. Excel: `TBILLEQ`." },
  tbillprice: { group: "Treasury bill", label: "TBILLPRICE", keys: ["discount"], description: "T-bill price per $100 face value from settle, maturity, and discount rate. Excel: `TBILLPRICE`." },
  tbillyield: { group: "Treasury bill", label: "TBILLYIELD", keys: ["pr"], description: "T-bill yield from settle, maturity, and price. Excel: `TBILLYIELD`." },
  disc:       { group: "Discounted",    label: "DISC",       keys: ["pr", "redemption", "basis"], description: "Discount rate for a fully-invested security (`redemption>price`). Excel: `DISC`." },
  pricedisc:  { group: "Discounted",    label: "PRICEDISC",  keys: ["discount", "redemption", "basis"], description: "Price per $100 of a discounted security (such as a T-bill). Excel: `PRICEDISC`." },
  yielddisc:  { group: "Discounted",    label: "YIELDDISC",  keys: ["pr", "redemption", "basis"], description: "Annual yield of a discounted security. Excel: `YIELDDISC`." },
  intrate:    { group: "Discounted",    label: "INTRATE",    keys: ["investment", "redemption", "basis"], description: "Interest rate for a fully-invested security. Excel: `INTRATE`." },
  received:   { group: "Discounted",    label: "RECEIVED",   keys: ["investment", "discount", "basis"], description: "Amount received at maturity for a fully-invested security. Excel: `RECEIVED`." },
  pricemat:   { group: "Interest at maturity", label: "PRICEMAT", keys: ["issue", "rate", "yld", "basis"], description: "Price per $100 of a security that pays interest at maturity. Excel: `PRICEMAT`." },
  yieldmat:   { group: "Interest at maturity", label: "YIELDMAT", keys: ["issue", "rate", "pr", "basis"], description: "Annual yield of a security that pays interest at maturity. Excel: `YIELDMAT`." },
};

const DISCOUNT_SECURITY_INPUTS: Record<string, () => ClassicPreset.Input<ClassicPreset.Socket>> = {
  settle:     () => dateIn("Settlement date"),
  maturity:   () => dateIn("Maturity date"),
  issue:      () => dateIn("Issue date"),
  discount:   () => numIn("Discount rate"),
  pr:         () => numIn("Price"),
  redemption: () => numIn("Redemption"),
  investment: () => numIn("Investment"),
  rate:       () => numIn("Coupon rate"),
  yld:        () => numIn("Yield"),
  basis:      () => numIn("Basis"),
};

function discountSecurityKeys(op: DiscountSecurityOp): string[] {
  return ["settle", "maturity", ...DISCOUNT_SECURITY_META[op].keys];
}

export class DiscountSecurityNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    pr: "Per $100 of face value.",
    discount: "As a decimal, e.g. 0.05 for 5%.",
    redemption: "Face value redeemed at maturity. Defaults to 100, the par value.",
    basis: BASIS_DOC,
  };
  label: string;
  op: DiscountSecurityOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { discount: 0.05, pr: 97.5, redemption: 100, investment: 1000, rate: 0.06, yld: 0.065, basis: 0 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: DiscountSecurityOp }) {
    super("DiscountSecurity");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "tbillprice";
    for (const k of discountSecurityKeys(this.op)) this.addInput(k, DISCOUNT_SECURITY_INPUTS[k]());
    this.addOutput("result", numOut("Result"));
    this.height = 149 + 27 * discountSecurityKeys(this.op).length;
  }

  keysDroppedBySwitch(next: DiscountSecurityOp): string[] {
    return keysDroppedBy(discountSecurityKeys(this.op), discountSecurityKeys(next));
  }

  setOp(next: DiscountSecurityOp): void {
    if (next === this.op) return;
    const after = discountSecurityKeys(next);
    reshapeInputs(this, after, (k) => DISCOUNT_SECURITY_INPUTS[k]());
    this.op = next;
    this.height = 149 + 27 * after.length;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}


// ─── COUPON functions (COUPDAYBS / COUPDAYS / COUPDAYSNC / COUPNCD / COUPPCD / COUPNUM) ─

export const COUPON_OP_META = {
  coupdaybs:  { label: "COUPDAYBS",  description: "Days from beginning of coupon period to settlement. Excel: `COUPDAYBS`." },
  coupdays:   { label: "COUPDAYS",   description: "Days in the coupon period containing settlement. Excel: `COUPDAYS`." },
  coupdaysnc: { label: "COUPDAYSNC", description: "Days from settlement to next coupon date. Excel: `COUPDAYSNC`." },
  coupncd:    { label: "COUPNCD",    description: "Next coupon date after settlement (as a date serial). Excel: `COUPNCD`." },
  couppcd:    { label: "COUPPCD",    description: "Previous coupon date before settlement (as a date serial). Excel: `COUPPCD`." },
  coupnum:    { label: "COUPNUM",    description: "Number of coupon periods between settlement and maturity. Excel: `COUPNUM`." },
} satisfies Record<CouponOp, { label: string; description: string }>;

export class CouponNode extends ClassicPreset.Node {
  static inputRoles = { frequency: setting(2), basis: setting(0) };
  static socketDocs: Record<string, string> = {
    frequency: "1 = annual, 2 = semi-annual, 4 = quarterly.",
    basis: BASIS_DOC,
  };
  label: string;
  op: CouponOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { frequency: 2, basis: 0 };
  width = 180; height = 235;

  constructor(init?: { label?: string; op?: CouponOp }) {
    super("Coupon");
    this.op    = init?.op    ?? "coupdaybs";
    this.label = init?.label ?? "";
    this.addInput("settle",    dateIn("Settlement date"));
    this.addInput("maturity",  dateIn("Maturity date"));
    this.addInput("frequency", numIn("Frequency"));
    this.addInput("basis",     numIn("Basis"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Accrued interest: ONE card ──────────────────────────────────────────────

export type AccruedInterestOp = "periodic" | "maturity";

export const ACCRUED_INTEREST_OP_META: Record<AccruedInterestOp, { label: string; description: string }> = {
  periodic: { label: "ACCRINT",  description: "Accrued interest for a security that pays periodic interest. Excel: `ACCRINT`." },
  maturity: { label: "ACCRINTM", description: "Accrued interest for a security that pays interest at maturity. Excel: `ACCRINTM`." },
};

export const ACCRUED_INTEREST_OP_OPTIONS: { value: AccruedInterestOp; label: string }[] = [
  { value: "periodic", label: "Periodic" },
  { value: "maturity", label: "At maturity" },
];

const ACCRUED_INTEREST_KEYS = ["issue", "settle", "rate", "par", "frequency", "basis"] as const;
function accruedInterestKeys(op: AccruedInterestOp): string[] {
  return ACCRUED_INTEREST_KEYS.filter((k) => k !== "frequency" || op === "periodic");
}

export class AccruedInterestNode extends ClassicPreset.Node {
  unitAware = true;
  static inputRoles = { basis: setting(0), frequency: setting(2) };
  static socketDocs: Record<string, string> = {
    frequency: "1 = annual, 2 = semi-annual, 4 = quarterly.",
    basis: BASIS_DOC,
  };
  label: string;
  op: AccruedInterestOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.06, par: 1000, frequency: 2, basis: 0 };
  width = 180; height = 280;

  constructor(init?: { label?: string; op?: AccruedInterestOp }) {
    super("AccruedInterest");
    this.label = init?.label ?? "";
    this.op = init?.op === "maturity" ? "maturity" : "periodic";
    for (const k of accruedInterestKeys(this.op)) this.addInput(k, this.makeInput(k));
    this.addOutput("result", numOut("Accrued interest"));
    this.height = this.op === "periodic" ? 280 : 245;
  }

  private makeInput(key: string) {
    switch (key) {
      case "issue":     return dateIn("Issue date");
      case "settle":    return dateIn("Settlement date");
      case "rate":      return numIn("Annual coupon rate");
      case "par":       return numIn("Par value");
      case "frequency": return numIn("Frequency");
      default:          return numIn("Basis");
    }
  }

  keysDroppedBySwitch(next: AccruedInterestOp): string[] {
    return keysDroppedBy(accruedInterestKeys(this.op), accruedInterestKeys(next));
  }

  setOp(next: AccruedInterestOp): void {
    if (next === this.op) return;
    const after = accruedInterestKeys(next);
    reshapeInputs(this, after, (k) => this.makeInput(k));
    this.op = next;
    this.height = next === "periodic" ? 280 : 245;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── Payment breakdown: ONE card ─────────────────────────────────────────────

export type PaymentBreakdownOp = "ipmt" | "ppmt" | "cumipmt" | "cumprinc";

export const PAYMENT_BREAKDOWN_OP_META: Record<PaymentBreakdownOp, { label: string; description: string }> = {
  ipmt:     { label: "IPMT",     description: "Interest portion of a periodic payment. Excel: `IPMT`." },
  ppmt:     { label: "PPMT",     description: "Principal portion of a periodic payment. Excel: `PPMT`." },
  cumipmt:  { label: "CUMIPMT",  description: "Cumulative interest paid between two periods. Excel: `CUMIPMT`." },
  cumprinc: { label: "CUMPRINC", description: "Cumulative principal paid between two periods. Excel: `CUMPRINC`." },
};

const PAYMENT_BREAKDOWN_SINGLE_KEYS = ["rate", "per", "nper", "pv", "fv"];
const PAYMENT_BREAKDOWN_RANGE_KEYS  = ["rate", "nper", "pv", "start", "end"];
function paymentBreakdownKeys(op: PaymentBreakdownOp): string[] {
  return op === "ipmt" || op === "ppmt" ? [...PAYMENT_BREAKDOWN_SINGLE_KEYS] : [...PAYMENT_BREAKDOWN_RANGE_KEYS];
}
const PAYMENT_BREAKDOWN_INPUTS: Record<string, () => ClassicPreset.Input<ClassicPreset.Socket>> = {
  rate:  () => numIn("Rate"),
  per:   () => numIn("Period"),
  nper:  () => numIn("Nper"),
  pv:    () => numIn("PV"),
  fv:    () => numIn("FV"),
  start: () => numIn("Start period"),
  end:   () => numIn("End period"),
};

export class PaymentBreakdownNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    rate: "The rate for a single period. Divide an annual rate by the number of periods per year.",
    per: "The single period to report, counted from 1.",
    end: "The sum includes both the start and end periods.",
  };

  label: string;
  op: PaymentBreakdownOp;
  paymentTiming: PaymentTiming;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.05, per: 1, nper: 12, pv: 1000, fv: 0, start: 1, end: 12 };
  width = 180; height = 367;

  constructor(init?: { label?: string; op?: PaymentBreakdownOp; paymentTiming?: PaymentTiming }) {
    super("PaymentBreakdown");
    this.label         = init?.label         ?? "";
    this.op            = init?.op ?? "ipmt";
    this.paymentTiming = init?.paymentTiming ?? "end";
    for (const k of paymentBreakdownKeys(this.op)) this.addInput(k, PAYMENT_BREAKDOWN_INPUTS[k]());
    this.addOutput("result", numOut("Result"));
  }

  keysDroppedBySwitch(next: PaymentBreakdownOp): string[] {
    return keysDroppedBy(paymentBreakdownKeys(this.op), paymentBreakdownKeys(next));
  }

  setOp(next: PaymentBreakdownOp): void {
    if (next === this.op) return;
    reshapeInputs(this, paymentBreakdownKeys(next), (k) => PAYMENT_BREAKDOWN_INPUTS[k]());
    this.op = next;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}


// ─── DURATION / MDURATION ─────────────────────────────────────────────────────

export const DURATION_OP_META = {
  duration:  { label: "DURATION",  description: "Macaulay duration: the weighted average time to receive cash flows. Excel: `DURATION`." },
  mduration: { label: "MDURATION", description: "Modified duration: price sensitivity to yield changes. Excel: `MDURATION`." },
} satisfies Record<DurationOp, { label: string; description: string }>;

export class DurationNode extends ClassicPreset.Node {
  static inputRoles = { frequency: setting(2), basis: setting(0) };
  static socketDocs: Record<string, string> = {
    frequency: "1 = annual, 2 = semi-annual, 4 = quarterly.",
    basis: BASIS_DOC,
  };
  label: string;
  op: DurationOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { coupon: 0.08, yld: 0.09, frequency: 2, basis: 0 };
  width = 180; height = 265;

  constructor(init?: { label?: string; op?: DurationOp }) {
    super("Duration");
    this.op    = init?.op    ?? "duration";
    this.label = init?.label ?? "";
    this.addInput("settle",    dateIn("Settlement date"));
    this.addInput("maturity",  dateIn("Maturity date"));
    this.addInput("coupon",    numIn("Annual coupon rate"));
    this.addInput("yld",       numIn("Annual yield"));
    this.addInput("frequency", numIn("Frequency"));
    this.addInput("basis",     numIn("Basis"));
    this.addOutput("result", numOut("Years"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Bond pricing: ONE card ──────────────────────────────────────────────────

export type BondPricingOp = BondPriceOp | OddCouponOp;

export const BOND_PRICING_META: Record<BondPricingOp, { label: string; description: string; group: string; keys: readonly string[] }> = {
  price:     { group: "Regular coupons",  label: "PRICE",     keys: ["rate", "yld", "redemption", "frequency"], description: "Clean price per $100 face for a coupon bond (`30/360` basis). Excel: `PRICE`." },
  yield:     { group: "Regular coupons",  label: "YIELD",     keys: ["rate", "pr", "redemption", "frequency"], description: "Annual yield of a coupon bond given its market price (`30/360` basis). Excel: `YIELD`." },
  oddfprice: { group: "Odd first coupon", label: "ODDFPRICE", keys: ["issue", "firstcoupon", "rate", "yld", "redemption", "frequency"], description: "Price of a bond with an irregular first coupon period. Excel: `ODDFPRICE`." },
  oddfyield: { group: "Odd first coupon", label: "ODDFYIELD", keys: ["issue", "firstcoupon", "rate", "pr", "redemption", "frequency"], description: "Yield of a bond with an irregular first coupon period. Excel: `ODDFYIELD`." },
  oddlprice: { group: "Odd last coupon",  label: "ODDLPRICE", keys: ["lastinterest", "rate", "yld", "redemption", "frequency"], description: "Price of a bond with an irregular last coupon period. Excel: `ODDLPRICE`." },
  oddlyield: { group: "Odd last coupon",  label: "ODDLYIELD", keys: ["lastinterest", "rate", "pr", "redemption", "frequency"], description: "Yield of a bond with an irregular last coupon period. Excel: `ODDLYIELD`." },
};

const BOND_PRICING_INPUTS: Record<string, () => ClassicPreset.Input<ClassicPreset.Socket>> = {
  settle:       () => dateIn("Settlement date"),
  maturity:     () => dateIn("Maturity date"),
  issue:        () => dateIn("Issue date"),
  firstcoupon:  () => dateIn("First coupon date"),
  lastinterest: () => dateIn("Last interest date"),
  rate:         () => numIn("Coupon rate"),
  yld:          () => numIn("Yield"),
  pr:           () => numIn("Price"),
  redemption:   () => numIn("Redemption"),
  frequency:    () => numIn("Frequency"),
};

function bondPricingKeys(op: BondPricingOp): string[] {
  return ["settle", "maturity", ...BOND_PRICING_META[op].keys];
}

export class BondPricingNode extends ClassicPreset.Node {
  static inputRoles = { frequency: setting(2) };
  static socketDocs: Record<string, string> = {
    issue: "Left unwired, the issue date falls back to the settlement date.",
    frequency: "1 = annual, 2 = semi-annual, 4 = quarterly.",
    redemption: "Face value redeemed at maturity. Defaults to 100, the par value.",
  };
  label: string;
  op: BondPricingOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { rate: 0.065, yld: 0.07, pr: 97.5, redemption: 100, frequency: 2 };
  width = 180; height = 280;

  constructor(init?: { label?: string; op?: BondPricingOp }) {
    super("BondPricing");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "price";
    for (const k of bondPricingKeys(this.op)) this.addInput(k, BOND_PRICING_INPUTS[k]());
    this.addOutput("result", numOut("Result"));
    this.height = 149 + 27 * bondPricingKeys(this.op).length;
  }

  keysDroppedBySwitch(next: BondPricingOp): string[] {
    return keysDroppedBy(bondPricingKeys(this.op), bondPricingKeys(next));
  }

  setOp(next: BondPricingOp): void {
    if (next === this.op) return;
    const after = bondPricingKeys(next);
    reshapeInputs(this, after, (k) => BOND_PRICING_INPUTS[k]());
    this.op = next;
    this.height = 149 + 27 * after.length;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}


// ─── AMORTIZATION SCHEDULE ───────────────────────────────────────────────────
export class AmortizationNode extends ClassicPreset.Node {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    rate: "The rate PER PERIOD: a 6% annual loan paid monthly is 0.005 here, with nper in months.",
    frame: "Period · Payment · Interest · Principal · Balance. Payment, interest and principal carry Excel's sign, negative for a loan received.",
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
    this.addInput("nper", numIn("Nper"));
    this.addInput("pv",   numIn("PV"));
    this.addInput("fv",   numIn("FV"));
    this.addOutput("frame", frameOut("Schedule"));
  }

  frameShape(): Shape {
    return { columns: [
      { name: "Period", type: "number" }, { name: "Payment", type: "number" }, { name: "Interest", type: "number" },
      { name: "Principal", type: "number" }, { name: "Balance", type: "number" },
    ] };
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

export function amortizationFrame(rate: number, nper: number, pv: number, fv: number, type: 0 | 1): FrameValue | null {
  const rows = amortizationSchedule(rate, nper, pv, fv, type);
  return rows.length === 0 ? null : { __frame: true, columns: [
    { name: "Period",    type: "number", values: rows.map((r) => r.period) },
    { name: "Payment",   type: "number", values: rows.map((r) => r.payment) },
    { name: "Interest",  type: "number", values: rows.map((r) => r.interest) },
    { name: "Principal", type: "number", values: rows.map((r) => r.principal) },
    { name: "Balance",   type: "number", values: rows.map((r) => r.balance) },
  ] };
}

// ─── RETURNS (return-series quant one-liners) ────────────────────────────────
export class ReturnsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Prices for the price-based ops (log / simple returns, drawdown, CAGR); per-period returns for the rest.",
    rf: "Risk-free rate PER PERIOD (an annual 4% on daily data is 0.04 / 252); 0 when unwired.",
    periods: "Periods per year for annualizing: 252 trading days, 12 months, 1 for none.",
  };
  label: string;
  op: ReturnsOp;
  literals: Record<string, number> = { rf: 0, periods: 1 };
  cachedResult: (number | null | SolError)[] | number | SolError | null = null;
  width = 190; height = 200;

  constructor(init?: { label?: string; op?: ReturnsOp }) {
    super("Returns");
    this.op = init?.op ?? "log";
    this.label = init?.label ?? "";
    this.addInput("list", listIn(ReturnsNode.inputLabel(this.op)));
    for (const k of RETURNS_OP_META[this.op].needs) this.addInput(k, ReturnsNode.extraInput(k));
    this.addOutput("result", ReturnsNode.outputFor(this.op));
  }

  static inputLabel(op: ReturnsOp) { return RETURNS_OP_META[op].takes === "prices" ? "Prices" : "Returns"; }
  static extraInput(k: "rf" | "periods") { return k === "rf" ? numIn("Risk-free / period") : numIn("Periods / year"); }
  static outputFor(op: ReturnsOp) { return RETURNS_OP_META[op].scalar ? numOut(RETURNS_OP_META[op].label) : listOut(RETURNS_OP_META[op].label); }

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

  data(inputs: Record<string, unknown[] | undefined>): { result: (number | null | SolError)[] | number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: (number | null | SolError)[] | number | SolError | null };
  }
}
