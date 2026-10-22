// [[B16]]
import { ClassicPreset } from "rete";
import { numListIn, numListOut, numIn, numOut, listIn, type BroadcastResult } from "./shared";
import { rolesFrom, required } from "../inputRoles";
import { nodeOnCore } from "../nodeOnCore";
import { type SolError } from "../errorValue";
import type { FormatAnnotation } from "../formatAnnotationStore";
import type { FormatCarrySpec } from "./formatCarry";
import { type UnitCell, type ArithmeticOp } from "../unitValue";

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export { arithmeticCell, type ArithmeticOp } from "../unitValue";

export const ARITHMETIC_OP_META = {
  add:      { label: "Add",        carry: true,  description: "`A + B`" },
  sub:      { label: "Subtract"  , carry: true,  description: "`A − B`" },
  mul:      { label: "Multiply"  , carry: false, description: "`A × B`" },
  div:      { label: "Divide",     carry: false, description: "`A ÷ B`. `#DIV/0!` when `B = 0`." },
  mod:      { label: "MOD",        carry: false, description: "Remainder of `A ÷ B`. Excel: `MOD`." },
  quotient: { label: "QUOTIENT",   carry: false, description: "Integer part of `A ÷ B`, truncated toward zero. Excel: `QUOTIENT`." },
  pow:      { label: "POWER",      carry: false, description: "A raised to the power B. `0^0 = 1` (JS/Python/Polars; Excel gives `#NUM!`). 0 to a negative power is `#DIV/0!`, and a result too large to represent is `#OVERFLOW!`. Excel: `POWER` / `A^B`." },
} satisfies Record<ArithmeticOp, { label: string; description: string; carry: boolean }>;

export class ArithmeticNode extends ClassicPreset.Node {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  op: ArithmeticOp;
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: ArithmeticOp }) {
    super("Arithmetic");
    const op = init?.op ?? "mul";
    this.label = init?.label ?? "";
    this.op = op;
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  formatCarry(): FormatCarrySpec[] {
    return ARITHMETIC_OP_META[this.op].carry ? [{ output: "result", inputs: ["a", "b"] }] : [];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null };
  }
}

// ─── Math Function ────────────────────────────────────────────────────────────

export type MathFnOp =
  | "abs" | "sqrt" | "log" | "sin" | "cos"
  | "tan" | "tanh" | "sinh" | "cosh" | "asin" | "acos" | "atan"
  | "exp" | "log10" | "log2" | "sign" | "trunc"
  | "int" | "even" | "odd" | "sqrtpi"
  | "acosh" | "asinh" | "atanh"
  | "cot" | "csc" | "sec" | "acot"
  | "coth" | "csch" | "sech" | "acoth"
  | "erf" | "erfc"
  | "gamma" | "gammaln";

export const MATH_FN_OP_META = {
  abs:     { label: "ABS",     group: "Functions",    description: "Absolute value. Excel: `ABS`." },
  sign:    { label: "SIGN",    group: "Functions",    description: "`−1`, `0`, or `1` depending on sign. Excel: `SIGN`." },
  sqrt:    { label: "SQRT",    group: "Functions",    description: "Square root. Excel: `SQRT`." },
  sqrtpi:  { label: "SQRTPI",  group: "Functions",    description: "`√(x × π)`. Excel: `SQRTPI`." },
  exp:     { label: "EXP",     group: "Functions",    description: "e raised to the power x. Excel: `EXP`." },
  trunc:   { label: "TRUNC",   group: "Rounding",     description: "Truncate toward zero: `TRUNC(−3.7) = −3`. Excel: `TRUNC`." },
  int:     { label: "INT",     group: "Rounding",     description: "Rounds down toward −∞: `INT(−3.7) = −4`. Excel: `INT`." },
  even:    { label: "EVEN",    group: "Rounding",     description: "Rounds away from zero to nearest even integer. Excel: `EVEN`." },
  odd:     { label: "ODD",     group: "Rounding",     description: "Rounds away from zero to nearest odd integer. Excel: `ODD`." },
  log:     { label: "LN",      group: "Logarithms",   description: "Natural log (base e). Excel: `LN`." },
  log10:   { label: "LOG10",   group: "Logarithms",   description: "Log base 10. Excel: `LOG10`." },
  log2:    { label: "LOG2",    group: "Logarithms",   description: "Log base 2: `log₂(x)`, for example how many bits represent x. Like Excel's `LOG` with base 2." },
  sin:     { label: "SIN",     group: "Trigonometry", description: "Sine. Excel: `SIN`." },
  cos:     { label: "COS",     group: "Trigonometry", description: "Cosine. Excel: `COS`." },
  tan:     { label: "TAN",     group: "Trigonometry", description: "Tangent. Excel: `TAN`." },
  cot:     { label: "COT",     group: "Trigonometry", description: "Cotangent (`1/tan`). Excel: `COT`." },
  csc:     { label: "CSC",     group: "Trigonometry", description: "Cosecant (`1/sin`). Excel: `CSC`." },
  sec:     { label: "SEC",     group: "Trigonometry", description: "Secant (`1/cos`). Excel: `SEC`." },
  asin:    { label: "ASIN",    group: "Trigonometry", description: "Arc sine → `[−π/2, π/2]`. Excel: `ASIN`." },
  acos:    { label: "ACOS",    group: "Trigonometry", description: "Arc cosine → `[0, π]`. Excel: `ACOS`." },
  atan:    { label: "ATAN",    group: "Trigonometry", description: "Arc tangent → `(−π/2, π/2)`. Excel: `ATAN`." },
  acot:    { label: "ACOT",    group: "Trigonometry", description: "Arc cotangent → `(0, π)`. Excel: `ACOT`." },
  sinh:    { label: "SINH",    group: "Hyperbolic",   description: "Hyperbolic sine. Excel: `SINH`." },
  cosh:    { label: "COSH",    group: "Hyperbolic",   description: "Hyperbolic cosine. Excel: `COSH`." },
  tanh:    { label: "TANH",    group: "Hyperbolic",   description: "Hyperbolic tangent. Excel: `TANH`." },
  asinh:   { label: "ASINH",   group: "Hyperbolic",   description: "Inverse hyperbolic sine. Excel: `ASINH`." },
  acosh:   { label: "ACOSH",   group: "Hyperbolic",   description: "Inverse hyperbolic cosine. Excel: `ACOSH`." },
  atanh:   { label: "ATANH",   group: "Hyperbolic",   description: "Inverse hyperbolic tangent. Excel: `ATANH`." },
  coth:    { label: "COTH",    group: "Hyperbolic",   description: "Hyperbolic cotangent (`cosh/sinh`). Excel: `COTH`." },
  csch:    { label: "CSCH",    group: "Hyperbolic",   description: "Hyperbolic cosecant (`1/sinh`). Excel: `CSCH`." },
  sech:    { label: "SECH",    group: "Hyperbolic",   description: "Hyperbolic secant (`1/cosh`). Excel: `SECH`." },
  acoth:   { label: "ACOTH",   group: "Hyperbolic",   description: "Inverse hyperbolic cotangent. Domain `|x| > 1`. Excel: `ACOTH`." },
  erf:     { label: "ERF",     group: "Special",      description: "Error function `erf(x) = (2/√π)∫₀ˣ e^(−t²) dt`. Excel: `ERF`." },
  erfc:    { label: "ERFC",    group: "Special",      description: "Complementary error function: `1 − erf(x)`. Excel: `ERFC`." },
  gamma:   { label: "GAMMA",   group: "Special",      description: "Gamma function `Γ(x)`: generalizes factorial, `Γ(n) = (n−1)!` Excel: `GAMMA`." },
  gammaln: { label: "GAMMALN", group: "Special",      description: "Natural log of the Gamma function `ln(Γ(x))`. Excel: `GAMMALN`." },
} satisfies Record<MathFnOp, { label: string; description: string; group: string }>;

// Only these show the angle-mode toggle; hyperbolic ops take and return plain reals.
export const FORWARD_TRIG_OPS = new Set<MathFnOp>(["sin", "cos", "tan", "cot", "csc", "sec"]);
export const INVERSE_TRIG_OPS = new Set<MathFnOp>(["asin", "acos", "atan", "acot"]);
export function isTrigOp(op: MathFnOp): boolean {
  return FORWARD_TRIG_OPS.has(op) || INVERSE_TRIG_OPS.has(op);
}

export type AngleMode = "auto" | "rad" | "deg";

const MATHFN_PRESERVE = new Set<MathFnOp>(["abs", "trunc", "int", "even", "odd"]);

export class MathFXNode extends ClassicPreset.Node {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  op: MathFnOp;
  angleMode: AngleMode;
  /** Stamped by resolveTrigModes each recompute; rad until then, matching Excel. */
  _resolvedAngleMode: "rad" | "deg" = "rad";
  static coreFields = ["_resolvedAngleMode"];
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: MathFnOp; angleMode?: AngleMode }) {
    super("MathFn");
    const op = init?.op ?? "abs";
    this.label = init?.label ?? "";
    this.op = op;
    this.angleMode = init?.angleMode ?? "auto";
    this.addInput("in", numListIn("In"));
    this.addOutput("result", numListOut("Result"));
  }

  effectiveAngleMode(): "rad" | "deg" {
    return this.angleMode === "auto" ? this._resolvedAngleMode : this.angleMode;
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "result" && INVERSE_TRIG_OPS.has(this.op) && this.effectiveAngleMode() === "deg"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  formatCarry(): FormatCarrySpec[] {
    return MATHFN_PRESERVE.has(this.op) ? [{ output: "result", inputs: ["in"] }] : [];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null };
  }
}

// ─── Base Convert ─────────────────────────────────────────────────────────────

export const BASE_CONVERT_META = {
  label: "Base Convert",
  description: "Bases 2–36, digits 0–9 only: a digit outside the source base or a result needing letters is `null`. Excel: `DEC2BIN`, `BIN2DEC`, `BASE`, `DECIMAL`.",
};

export class BaseConvertNode extends ClassicPreset.Node {
  static inputRoles = { from: required, to: required };
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { value: 1010, from: 2, to: 10 };
  width = 180; height = 235;

  constructor(init?: { label?: string }) {
    super("BaseConvert");
    this.label = init?.label ?? "Base Convert";
    this.addInput("value", numIn("Value"));
    this.addInput("from",  numIn("From base"));
    this.addInput("to",    numIn("To base"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Clamp ────────────────────────────────────────────────────────────────────

export class ClampNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("CLAMP", { min: 1, max: 2 });
  static socketDocs: Record<string, string> = {
    min: "Empty, there is no floor; a blank item in a list of bounds is no floor for that item.",
    max: "Empty, there is no ceiling; a blank item in a list of bounds is no ceiling for that item.",
  };

  label: string;
  cachedResult: number | number[] | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Clamp");
    this.label = init?.label ?? "Clamp";
    this.addInput("value", numListIn("Value"));
    this.addInput("min",   numListIn("Min"));
    this.addInput("max",   numListIn("Max"));
    this.addOutput("result", numListOut("Result"));
  }

  formatCarry(): FormatCarrySpec[] {
    return [{ output: "result", inputs: ["value"] }];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | number[] | null };
  }
}

// ─── MROUND ───────────────────────────────────────────────────────────────────

export type MRoundOp = "nearest" | "up" | "down";

export const MROUND_OP_META = {
  nearest: { label: "MROUND",  description: "Round to the nearest multiple. Excel: `MROUND`." },
  up:      { label: "CEILING", description: "Round up to a multiple (toward +∞). Excel: `CEILING.MATH`." },
  down:    { label: "FLOOR",   description: "Round down to a multiple (toward −∞). Excel: `FLOOR.MATH`." },
} satisfies Record<MRoundOp, { label: string; description: string }>;

export class MRoundNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("MROUND", { multiple: 1 });
  static socketDocs: Record<string, string> = {
    multiple: "A multiple of zero gives zero rather than an error.",
  };

  label: string;
  op: MRoundOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { value: 0, multiple: 1 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: MRoundOp }) {
    super("MRound");
    this.op = init?.op ?? "nearest";
    this.label = init?.label ?? "";
    this.addInput("value",    numListIn("Value"));
    this.addInput("multiple", numListIn("Multiple"));
    this.addOutput("result",  numListOut("Result"));
  }

  formatCarry(): FormatCarrySpec[] {
    return [{ output: "result", inputs: ["value"] }];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: BroadcastResult };
  }
}

// ─── ROUND / ROUNDUP / ROUNDDOWN ─────────────────────────────────────────────

export type RoundNOp = "round" | "roundup" | "rounddown";

export const ROUNDN_OP_META = {
  round:     { label: "ROUND",     description: "Rounds to N decimal places, half away from zero. Excel: `ROUND`." },
  roundup:   { label: "ROUNDUP",   description: "Rounds away from zero to N decimal places. Excel: `ROUNDUP`." },
  rounddown: { label: "ROUNDDOWN", description: "Rounds toward zero to N decimal places. Excel: `ROUNDDOWN`." },
} satisfies Record<RoundNOp, { label: string; description: string }>;

export class RoundNNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("ROUND", { digits: 1 });
  label: string;
  op: RoundNOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { value: 0, digits: 0 };
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: RoundNOp }) {
    super("RoundN");
    this.op = init?.op ?? "round";
    this.label = init?.label ?? "";
    this.addInput("value",  numListIn("Value"));
    this.addInput("digits", numListIn("Digits"));
    this.addOutput("result", numListOut("Result"));
  }

  formatCarry(): FormatCarrySpec[] {
    return [{ output: "result", inputs: ["value"] }];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: BroadcastResult };
  }
}

// ─── GCD ───────────────────────────────────────────────────────────────────────

export type GcdOp = "gcd" | "lcm";

export const GCD_OP_META = {
  gcd: { label: "GCD", description: "Greatest common divisor of two integers. Excel: `GCD`." },
  lcm: { label: "LCM", description: "Least common multiple of two integers. Excel: `LCM`." },
} satisfies Record<GcdOp, { label: string; description: string }>;

export class GCDNode extends ClassicPreset.Node {
  label: string;
  op: GcdOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: GcdOp }) {
    super("Gcd");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "gcd";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: BroadcastResult };
  }
}

// ─── Combinatorics ─────────────────────────────────────────────────────────────

export type CombinatoricsOp = "combin" | "combina" | "permut" | "permutationa" | "fact" | "factdouble";

export const COMBINATORICS_OP_META = {
  fact:       { label: "FACT",       description: "`n!`, the factorial. Excel: `FACT`." },
  factdouble: { label: "FACTDOUBLE", description: "`n!!`, the double factorial. Excel: `FACTDOUBLE`." },
  combin:     { label: "COMBIN",     description: "`C(n,k)`: combinations without repetition. Excel: `COMBIN`." },
  combina:    { label: "COMBINA",    description: "`C(n+k−1,k)`: combinations with repetition. Excel: `COMBINA`." },
  permut:       { label: "PERMUT",       description: "`P(n,k)`: ordered arrangements without repetition. Excel: `PERMUT`." },
  permutationa: { label: "PERMUTATIONA", description: "`nᵏ`: ordered arrangements with repetition. Excel: `PERMUTATIONA`." },
} satisfies Record<CombinatoricsOp, { label: string; description: string }>;

export class CombinatoricsNode extends ClassicPreset.Node {
  label: string;
  op: CombinatoricsOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { n: 5, k: 2 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: CombinatoricsOp }) {
    super("Combinatorics");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "combin";
    this.addInput("n", numIn("N"));
    this.addInput("k", numIn("K"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── 2-Input Math ──────────────────────────────────────────────────────────────

export type TwoInputMathOp = "atan2" | "hypot" | "log" | "delta" | "gestep";

export const TWO_INPUT_MATH_OP_META = {
  atan2: { label: "ATAN2", description: "Angle from x,y coordinates: `atan2(y, x)`. Excel: `ATAN2`." },
  hypot: { label: "HYPOTENUSE", description: "Hypotenuse `√(A² + B²)` of the two legs" },
  log:     { label: "LOG",     description: "Log of x in any base. Excel: `LOG`." },
  delta:   { label: "DELTA",   description: "`1` if `A = B` (within rounding), else `0`. Excel: `DELTA`." },
  gestep:  { label: "GESTEP",  description: "`1` if `A ≥ B`, else `0`. Excel: `GESTEP`." },
} satisfies Record<TwoInputMathOp, { label: string; description: string }>;

export class TwoInputMathNode extends ClassicPreset.Node {
  label: string;
  op: TwoInputMathOp;
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: TwoInputMathOp }) {
    super("TwoInputMath");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "atan2";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | (number | SolError | null)[] | SolError | null };
  }
}

// ─── SumProduct ─────────────────────────────────────────────────────────────────

export type SumProductOp = "sumx2my2" | "sumx2py2" | "sumxmy2" | "sumproduct";

export const SUM_PRODUCT_OP_META = {
  sumx2my2: { label: "SUMX2MY2", description: "`Σ(xi² − yi²)` across two lists. Excel: `SUMX2MY2`." },
  sumx2py2: { label: "SUMX2PY2", description: "`Σ(xi² + yi²)`. Excel: `SUMX2PY2`." },
  sumxmy2:    { label: "SUMXMY2",    description: "`Σ(xi − yi)²`. Excel: `SUMXMY2`." },
  sumproduct: { label: "SUMPRODUCT", description: "Dot product `Σ(xi × yi)`. Excel: `SUMPRODUCT`." },
} satisfies Record<SumProductOp, { label: string; description: string }>;

export class SumProductNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Lists of unequal length pair to the shorter one, and the extra values are ignored.",
  };

  label: string;
  op: SumProductOp;
  cachedResult: number | null = null;
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: SumProductOp }) {
    super("SumProduct");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "sumx2my2";
    this.addInput("x", listIn("X"));
    this.addInput("y", listIn("Y"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}

// ─── SERIESSUM ────────────────────────────────────────────────────────────────

export class SeriesSumNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { x: 1, n: 0, m: 1 };
  width = 180;
  height = 215;

  constructor(init?: { label?: string }) {
    super("SeriesSum");
    this.label = init?.label ?? "SERIESSUM";
    this.addInput("x",    numIn("x"));
    this.addInput("n",    numIn("Start power"));
    this.addInput("m",    numIn("Power step"));
    this.addInput("coef", listIn("Coefficients"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── MULTINOMIAL ──────────────────────────────────────────────────────────────

export class MultinomialNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "The category counts n₁, n₂, …: the multinomial coefficient of their sum.",
  };
  label: string;
  cachedResult: number | SolError | null = null;
  width = 180;
  height = 135;

  constructor(init?: { label?: string }) {
    super("Multinomial");
    this.label = init?.label ?? "MULTINOMIAL";
    this.addInput("values", listIn("Values"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Bessel functions (BESSELI / BESSELJ / BESSELY / BESSELK) ─────────────────

export type BesselOp = "besselj" | "bessely" | "besseli" | "besselk";

export const BESSEL_OP_META = {
  besselj: { label: "BESSELJ", description: "Bessel function of the first kind, order n. Excel: `BESSELJ`." },
  bessely: { label: "BESSELY", description: "Bessel function of the second kind, order n. x must be `> 0`. Excel: `BESSELY`." },
  besseli: { label: "BESSELI", description: "Modified Bessel function of the first kind, order n. Excel: `BESSELI`." },
  besselk: { label: "BESSELK", description: "Modified Bessel function of the second kind, order n. x must be `> 0`. Excel: `BESSELK`." },
} satisfies Record<BesselOp, { label: string; description: string }>;

export class BesselNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("BESSELJ", { n: 1 });
  static socketDocs: Record<string, string> = {
    n: "Order, 0 or greater; a fraction is truncated.",
  };
  label: string;
  op: BesselOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, n: 0 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: BesselOp }) {
    super("Bessel");
    this.op    = init?.op    ?? "besselj";
    this.label = init?.label ?? "";
    this.addInput("x", numIn("x"));
    this.addInput("n", numIn("Order"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}

