import { ClassicPreset } from "rete";
import { broadcast, broadcastErr, broadcastUnit, anyDimensioned, readInput, numListIn, numListOut, numIn, numOut, listIn, type BroadcastResult, type UnitOperand } from "./shared";
import { lnGamma } from "./mathUtils";
import { solError, type SolError } from "../errorValue";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { type UnitCell, dimOf, magnitudeOf, tagDim, unitError } from "../unitValue";
import { dimEqual, dimMul, dimDiv, dimPow, isDimensionless } from "../dimension";

// ─── Bessel helper functions ──────────────────────────────────────────────────

const EULER_GAMMA = 0.5772156649015329;

function _besselJ(x: number, n: number): number {
  let sum = 0;
  const h = x / 2;
  for (let m = 0; m < 60; m++) {
    const term = Math.pow(-1, m) * Math.pow(h, 2 * m + n) / Math.exp(lnGamma(m + 1) + lnGamma(m + n + 1));
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum;
}

function _besselI(x: number, n: number): number {
  let sum = 0;
  const h = x / 2;
  for (let m = 0; m < 60; m++) {
    const term = Math.pow(h, 2 * m + n) / Math.exp(lnGamma(m + 1) + lnGamma(m + n + 1));
    sum += term;
    if (term < Math.abs(sum) * 1e-15) break;
  }
  return sum;
}

function _besselY0(x: number): number {
  const j0 = _besselJ(x, 0);
  let sum = 0;
  let H = 0;
  for (let m = 1; m < 60; m++) {
    H += 1 / m;
    const term = Math.pow(-1, m + 1) * H * Math.pow(x / 2, 2 * m) / Math.exp(2 * lnGamma(m + 1));
    sum += term;
  }
  return (2 / Math.PI) * ((Math.log(x / 2) + EULER_GAMMA) * j0 + sum);
}

function _besselY(x: number, n: number): number {
  if (x <= 0) return NaN;
  if (n === 0) return _besselY0(x);
  // Upward recurrence from Y_0, Y_1
  const y0 = _besselY0(x);
  // Y_1 via direct series — uses known formula
  const j1 = _besselJ(x, 1);
  let sum1 = 0; let H = 1;
  for (let m = 1; m < 60; m++) {
    H += 1 / (m + 1);
    const h = x / 2;
    const term = Math.pow(-1, m) * (H + 1 / (m + 1)) * Math.pow(h, 2 * m + 1) / Math.exp(lnGamma(m + 1) + lnGamma(m + 2));
    sum1 += term;
  }
  const y1 = (2 / Math.PI) * ((Math.log(x / 2) + EULER_GAMMA) * j1 - 1 / x - sum1);
  let yPrev = y0, yCur = y1;
  for (let k = 1; k < n; k++) {
    const yNext = (2 * k / x) * yCur - yPrev;
    yPrev = yCur; yCur = yNext;
  }
  return yCur;
}

function _besselK0(x: number): number {
  const i0 = _besselI(x, 0);
  let sum = 0;
  let H = 0;
  for (let m = 0; m < 60; m++) {
    if (m > 0) H += 1 / m;
    const term = H * Math.pow(x / 2, 2 * m) / Math.exp(2 * lnGamma(m + 1));
    sum += term;
  }
  return -(Math.log(x / 2) + EULER_GAMMA) * i0 + sum;
}

function _besselK(x: number, n: number): number {
  if (x <= 0) return NaN;
  if (n === 0) return _besselK0(x);
  const k0 = _besselK0(x);
  const k1 = (Math.PI / 2) * (_besselI(x, -1) - _besselI(x, 1));  // K_1 = π/2*(I_{-1}-I_1)
  let kPrev = k0, kCur = k1;
  for (let k = 1; k < n; k++) {
    const kNext = (2 * k / x) * kCur + kPrev;
    kPrev = kCur; kCur = kNext;
  }
  return kCur;
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export type ArithmeticOp = "add" | "sub" | "mul" | "div" | "mod" | "pow" | "quotient";

export const ARITHMETIC_OP_META = {
  add:      { label: "+ Add",      description: "A + B" },
  sub:      { label: "− Subtract", description: "A − B" },
  mul:      { label: "× Multiply", description: "A × B" },
  div:      { label: "÷ Divide",   description: "A ÷ B. #DIV/0! when B = 0." },
  mod:      { label: "MOD",        description: "Remainder of A ÷ B. Excel: MOD." },
  quotient: { label: "QUOTIENT",   description: "Integer part of A ÷ B, truncated toward zero. Excel: QUOTIENT." },
  pow:      { label: "xⁿ Power",   description: "A raised to the power B. 0^0 = 1 (JS/Python/Polars convention; Excel gives #NUM!). A finite result too large to represent → #OVERFLOW!. Excel: POWER / A^B." },
} satisfies Record<ArithmeticOp, { label: string; description: string }>;

// Per-cell arithmetic WITH dimensional algebra (Bundle 05: FC A4, step 2). Runs
// only when an operand carries a unit; every op does the numeric math on the
// base-SI magnitudes and combines the dimension vectors per its rule:
//   × adds exponents · ÷ subtracts · +/− require commensurability (else #UNIT!) ·
//   pow scales by the (dimensionless) exponent · cancellation collapses to a bare
//   number via tagDim. QUOTIENT divides dimensionally; MOD keeps the dividend's
//   unit (commensurable divisor required, like subtraction).
export function arithmeticCell(
  op: ArithmeticOp,
  a: UnitOperand,
  b: UnitOperand,
): number | UnitCell | SolError {
  const da = dimOf(a), db = dimOf(b);
  const x = magnitudeOf(a), y = magnitudeOf(b);
  const divZero = () => solError("#DIV/0!", "Division by zero");
  switch (op) {
    case "add":
      if (!dimEqual(da, db)) return unitError();
      return tagDim(x + y, da);
    case "sub":
      if (!dimEqual(da, db)) return unitError();
      return tagDim(x - y, da);
    case "mul":
      return tagDim(x * y, dimMul(da, db));
    case "div":
      return y === 0 ? divZero() : tagDim(x / y, dimDiv(da, db));
    case "mod":
      if (!dimEqual(da, db)) return unitError();
      return y === 0 ? divZero() : tagDim(x - y * Math.floor(x / y), da);
    case "quotient":
      return y === 0 ? divZero() : tagDim(Math.trunc(x / y), dimDiv(da, db));
    case "pow":
      if (!isDimensionless(db)) return unitError("An exponent must be a plain number, not a dimensioned quantity.");
      return tagDim(Math.pow(x, y), dimPow(da, y));
  }
}

export class ArithmeticNode extends ClassicPreset.Node {
  label: string;
  op: ArithmeticOp;
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
  // Inline literals — used for any input without an incoming cable.
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: ArithmeticOp }) {
    super("Arithmetic");
    const op = init?.op ?? "mul";
    this.label = init?.label ?? "Arithmetic";
    this.op = op;
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    // ÷ 0 is a real error, not a blank — Excel #DIV/0! — at EVERY dimensionality:
    // a scalar result is a tagged SolError, and an element divided by zero inside
    // a list carries a per-cell #DIV/0! (array-semantics: lists hold per-cell
    // errors, like the Expression / Map path). `broadcastErr` routes both. Same
    // for MOD / QUOTIENT, which also divide. (Was: list ÷0 collapsed to NaN →
    // surfaced as #N/A, inconsistent with the scalar and table+Map cases.)
    const divZero = () => solError("#DIV/0!", "Division by zero");
    let result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
    if (a !== null && b !== null) {
      // Unit-aware path only when a dimension is actually present (base-SI algebra:
      // × adds exponents, ÷ subtracts, +/− demand commensurability → #UNIT!). Plain
      // number data takes the original broadcastErr fast path unchanged.
      if (anyDimensioned(a as UnitOperand | UnitOperand[], b as UnitOperand | UnitOperand[])) {
        result = broadcastUnit((x, y) => arithmeticCell(this.op, x, y),
          a as UnitOperand | UnitOperand[], b as UnitOperand | UnitOperand[]);
      } else {
        result = broadcastErr((x, y) => {
          switch (this.op) {
            case "add": return x + y;
            case "sub": return x - y;
            case "mul": return x * y;
            case "div": return y === 0 ? divZero() : x / y;
            // Excel MOD's sign follows the divisor: MOD(-3,2)=1. JS % follows the
            // dividend (-3 % 2 = -1), so use the floored definition instead.
            case "mod": return y === 0 ? divZero() : x - y * Math.floor(x / y);
            case "pow":      return Math.pow(x, y);
            case "quotient": return y === 0 ? divZero() : Math.trunc(x / y);
          }
          return null;
        }, a, b);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Math Function ────────────────────────────────────────────────────────────

export type MathFnOp =
  | "abs" | "round" | "sqrt" | "log" | "sin" | "cos"
  | "tan" | "tanh" | "sinh" | "cosh" | "asin" | "acos" | "atan"
  | "exp" | "log10" | "log2" | "sign" | "trunc"
  | "int" | "even" | "odd" | "sqrtpi"
  | "acosh" | "asinh" | "atanh"
  | "cot" | "csc" | "sec" | "acot"
  | "coth" | "csch" | "sech" | "acoth"
  | "phi" | "gauss"
  | "erf" | "erfc"
  | "gamma" | "gammaln";

export const MATH_FN_OP_META = {
  abs:     { label: "ABS",     group: "Functions",    description: "Absolute value. Excel: ABS(x)." },
  sign:    { label: "SIGN",    group: "Functions",    description: "−1, 0, or 1 depending on sign. Excel: SIGN(x)." },
  sqrt:    { label: "SQRT",    group: "Functions",    description: "Square root. Excel: SQRT(x)." },
  sqrtpi:  { label: "SQRTPI",  group: "Functions",    description: "√(x × π). Excel: SQRTPI(x)." },
  exp:     { label: "EXP",     group: "Functions",    description: "e raised to the power x. Excel: EXP(x)." },
  round:   { label: "ROUND",   group: "Rounding",     description: "Round to nearest integer. Excel: ROUND(x,0)." },
  trunc:   { label: "TRUNC",   group: "Rounding",     description: "Truncate toward zero: TRUNC(−3.7) = −3. Excel: TRUNC(x)." },
  int:     { label: "INT",     group: "Rounding",     description: "Round DOWN toward −∞: INT(−3.7) = −4. Excel: INT(x)." },
  even:    { label: "EVEN",    group: "Rounding",     description: "Round away from zero to nearest even integer. Excel: EVEN(x)." },
  odd:     { label: "ODD",     group: "Rounding",     description: "Round away from zero to nearest odd integer. Excel: ODD(x)." },
  log:     { label: "LN",      group: "Logarithms",   description: "Natural log (base e). Excel: LN(x)." },
  log10:   { label: "LOG10",   group: "Logarithms",   description: "Log base 10. Excel: LOG10(x)." },
  log2:    { label: "LOG2",    group: "Logarithms",   description: "Log base 2: log₂(x), e.g. how many bits represent x. Excel: LOG(x, 2)." },
  sin:     { label: "SIN",     group: "Trigonometry", description: "Sine. Excel: SIN(x)." },
  cos:     { label: "COS",     group: "Trigonometry", description: "Cosine. Excel: COS(x)." },
  tan:     { label: "TAN",     group: "Trigonometry", description: "Tangent. Excel: TAN(x)." },
  cot:     { label: "COT",     group: "Trigonometry", description: "Cotangent (1/tan). Excel: COT(x)." },
  csc:     { label: "CSC",     group: "Trigonometry", description: "Cosecant (1/sin). Excel: CSC(x)." },
  sec:     { label: "SEC",     group: "Trigonometry", description: "Secant (1/cos). Excel: SEC(x)." },
  asin:    { label: "ASIN",    group: "Trigonometry", description: "Arc sine → [−π/2, π/2]. Excel: ASIN(x)." },
  acos:    { label: "ACOS",    group: "Trigonometry", description: "Arc cosine → [0, π]. Excel: ACOS(x)." },
  atan:    { label: "ATAN",    group: "Trigonometry", description: "Arc tangent → (−π/2, π/2). Excel: ATAN(x)." },
  acot:    { label: "ACOT",    group: "Trigonometry", description: "Arc cotangent → (0, π). Excel: ACOT(x)." },
  sinh:    { label: "SINH",    group: "Hyperbolic",   description: "Hyperbolic sine. Excel: SINH(x)." },
  cosh:    { label: "COSH",    group: "Hyperbolic",   description: "Hyperbolic cosine. Excel: COSH(x)." },
  tanh:    { label: "TANH",    group: "Hyperbolic",   description: "Hyperbolic tangent. Excel: TANH(x)." },
  asinh:   { label: "ASINH",   group: "Hyperbolic",   description: "Inverse hyperbolic sine. Excel: ASINH(x)." },
  acosh:   { label: "ACOSH",   group: "Hyperbolic",   description: "Inverse hyperbolic cosine. Excel: ACOSH(x)." },
  atanh:   { label: "ATANH",   group: "Hyperbolic",   description: "Inverse hyperbolic tangent. Excel: ATANH(x)." },
  coth:    { label: "COTH",    group: "Hyperbolic",   description: "Hyperbolic cotangent (cosh/sinh). Excel: COTH(x)." },
  csch:    { label: "CSCH",    group: "Hyperbolic",   description: "Hyperbolic cosecant (1/sinh). Excel: CSCH(x)." },
  sech:    { label: "SECH",    group: "Hyperbolic",   description: "Hyperbolic secant (1/cosh). Excel: SECH(x)." },
  acoth:   { label: "ACOTH",   group: "Hyperbolic",   description: "Inverse hyperbolic cotangent; domain |x| > 1. Excel: ACOTH(x)." },
  phi:     { label: "PHI",     group: "Probability",  description: "Standard normal PDF φ(x). Excel: PHI(x)." },
  gauss:   { label: "GAUSS",   group: "Probability",  description: "Φ(x) − 0.5: the area from 0 to x under the standard normal curve. Excel: GAUSS(x)." },
  erf:     { label: "ERF",     group: "Special",      description: "Error function erf(x) = (2/√π)∫₀ˣ e^(−t²) dt. Excel: ERF(x)." },
  erfc:    { label: "ERFC",    group: "Special",      description: "Complementary error function: 1 − erf(x). Excel: ERFC(x)." },
  gamma:   { label: "GAMMA",   group: "Special",      description: "Gamma function Γ(x): generalizes factorial, Γ(n) = (n−1)! Excel: GAMMA(x)." },
  gammaln: { label: "GAMMALN", group: "Special",      description: "Natural log of the Gamma function ln(Γ(x)). Excel: GAMMALN(x)." },
} satisfies Record<MathFnOp, { label: string; description: string; group: string }>;

// Abramowitz & Stegun approximation, max error ~1.5e-7.
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return (x < 0 ? -1 : 1) * (1 - p * Math.exp(-x * x));
}

// Trig ops split by which side is the ANGLE: forward ops take an angle in,
// inverse ops emit an angle out. Only these show the deg/rad/auto toggle;
// hyperbolic ops take/return plain reals, not angles, so they're excluded.
export const FORWARD_TRIG_OPS = new Set<MathFnOp>(["sin", "cos", "tan", "cot", "csc", "sec"]);
export const INVERSE_TRIG_OPS = new Set<MathFnOp>(["asin", "acos", "atan", "acot"]);
export function isTrigOp(op: MathFnOp): boolean {
  return FORWARD_TRIG_OPS.has(op) || INVERSE_TRIG_OPS.has(op);
}

// deg/rad/auto: `rad` is Excel parity (SIN takes radians); `deg` converts;
// `auto` (default) reads the incoming unit — a `deg`-tagged value computes in
// degrees, anything else in radians. Auto's effective mode is resolved at
// recompute time (trigMode.ts) into `_resolvedAngleMode`.
export type AngleMode = "auto" | "rad" | "deg";
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export class MathFnNode extends ClassicPreset.Node {
  label: string;
  op: MathFnOp;
  /** Angle interpretation for trig ops (ignored by every other op). */
  angleMode: AngleMode;
  /** Auto mode's resolved effective mode, stamped by the recompute-time unit
   *  read (trigMode.ts `resolveTrigModes`); default rad until a pass runs, so a
   *  node computed before any reconcile still matches Excel. Not persisted. */
  _resolvedAngleMode: "rad" | "deg" = "rad";
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: MathFnOp; angleMode?: AngleMode }) {
    super("MathFn");
    const op = init?.op ?? "abs";
    this.label = init?.label ?? "Math";
    this.op = op;
    this.angleMode = init?.angleMode ?? "auto";
    this.addInput("in", numListIn("In"));
    this.addOutput("result", numListOut("Result"));
  }

  /** The effective mode for THIS pass: an explicit pin wins; `auto` uses the
   *  unit-resolved mode (default rad). */
  effectiveAngleMode(): "rad" | "deg" {
    return this.angleMode === "auto" ? this._resolvedAngleMode : this.angleMode;
  }

  /** An INVERSE trig op in degree mode emits an angle in degrees — carry the
   *  real `deg` unit on the output (per-output, unitFlow `annotationFor`), so it
   *  reads as 30° and chains into another trig node's Auto mode. */
  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "result" && INVERSE_TRIG_OPS.has(this.op) && this.effectiveAngleMode() === "deg"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  data(inputs: { in?: (number | number[])[] }) {
    const input = readInput(inputs.in, this.literals.in);
    const mode = this.effectiveAngleMode();
    // A forward trig op takes an angle: in deg mode, convert the input to radians
    // before the math. An inverse trig op emits an angle: convert the radian
    // result to degrees after.
    const fwdDeg = mode === "deg" && FORWARD_TRIG_OPS.has(this.op);
    const invDeg = mode === "deg" && INVERSE_TRIG_OPS.has(this.op);
    // A valid input element with no defined result (√ of a negative, log of 0, an
    // arc-fn outside [−1,1], …) is OUT OF DOMAIN — #DOMAIN!, the specific half of
    // Excel's #NUM!. It tags identically at every dimensionality: a scalar → a
    // #DOMAIN! scalar, a per-element domain miss in a LIST → a per-cell #DOMAIN!
    // (array-semantics: lists carry per-cell errors, like the scalar / Map paths).
    // `compute` returns null for the domain miss; broadcastErr maps it via `??`.
    const domainErr = () => solError("#DOMAIN!", "Input is outside this function's domain");
    const computeRaw = (x: number): number | null => {
        switch (this.op) {
          case "abs":   return Math.abs(x);
          // Excel ROUND rounds halves away from zero; JS Math.round rounds them
          // toward +inf (Math.round(-2.5) = -2), so round the magnitude.
          case "round": return Math.sign(x) * Math.round(Math.abs(x));
          case "sqrt":  return x < 0 ? null : Math.sqrt(x);
          case "log":   return x <= 0 ? null : Math.log(x);
          case "sin":   return Math.sin(x);
          case "cos":   return Math.cos(x);
          case "tan":   return Math.tan(x);
          case "tanh":  return Math.tanh(x);
          case "sinh":  return Math.sinh(x);
          case "cosh":  return Math.cosh(x);
          case "asin":  return (x < -1 || x > 1) ? null : Math.asin(x);
          case "acos":  return (x < -1 || x > 1) ? null : Math.acos(x);
          case "atan":  return Math.atan(x);
          case "exp":   return Math.exp(x);
          case "log10": return x <= 0 ? null : Math.log10(x);
          case "log2":  return x <= 0 ? null : Math.log2(x);
          case "sign":  return Math.sign(x);
          case "trunc": return Math.trunc(x);
          case "int":     return Math.floor(x);
          case "even":    return (x >= 0 ? 1 : -1) * 2 * Math.ceil(Math.abs(x) / 2);
          case "odd": {
            const c = Math.ceil(Math.abs(x));
            return (x < 0 ? -1 : 1) * (c % 2 === 0 ? c + 1 : c);
          }
          case "sqrtpi":  return x < 0 ? null : Math.sqrt(x * Math.PI);
          case "acosh":   return x < 1 ? null : Math.acosh(x);
          case "asinh":   return Math.asinh(x);
          case "atanh":   return (x <= -1 || x >= 1) ? null : Math.atanh(x);
          case "cot":     return Math.tan(x) === 0 ? null : 1 / Math.tan(x);
          case "csc":     return Math.sin(x) === 0 ? null : 1 / Math.sin(x);
          case "sec":     return Math.cos(x) === 0 ? null : 1 / Math.cos(x);
          case "acot":    return Math.PI / 2 - Math.atan(x);
          case "coth":    return Math.sinh(x) === 0 ? null : Math.cosh(x) / Math.sinh(x);
          case "csch":    return Math.sinh(x) === 0 ? null : 1 / Math.sinh(x);
          case "sech":    return 1 / Math.cosh(x);
          case "acoth":   return (x <= -1 || x >= 1) ? (Math.abs(x) === 1 ? null : Math.atanh(1 / x)) : null;
          case "phi":     return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
          case "gauss":   return erf(x / Math.SQRT2) / 2;
          case "erf": {
            const t = 1 / (1 + 0.3275911 * Math.abs(x));
            const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
            return (x < 0 ? -1 : 1) * (1 - p * Math.exp(-x * x));
          }
          case "erfc": {
            const t = 1 / (1 + 0.3275911 * Math.abs(x));
            const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
            const e = (x < 0 ? -1 : 1) * (1 - p * Math.exp(-x * x));
            return 1 - e;
          }
          case "gamma":   return x > 0 ? Math.exp(lnGamma(x)) : null;
          case "gammaln": return x > 0 ? lnGamma(x) : null;
        }
        return null;
    };
    // Degree conversion wraps the raw radian math at the boundary: a forward trig
    // op's input deg→rad, an inverse trig op's result rad→deg. Every other op is
    // untouched (fwdDeg/invDeg are false unless the op is trig AND mode is deg).
    const compute = (x: number): number | null => {
      const r = computeRaw(fwdDeg ? x * DEG2RAD : x);
      return r !== null && invDeg ? r * RAD2DEG : r;
    };
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (input !== null) {
      result = broadcastErr((x) => compute(x) ?? domainErr(), input);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Base Convert ─────────────────────────────────────────────────────────────
// Covers BIN2DEC, DEC2BIN, OCT2DEC, DEC2OCT, BIN2OCT, OCT2BIN, BASE, DECIMAL,
// and the hex variants (HEX2DEC, DEC2HEX etc.) where digits don't exceed 9.
// Bases > 10 whose output requires digits A-F return null (no string type).

export const BASE_CONVERT_META = {
  label: "Base Convert",
  description: "Convert an integer from one base to another (2–36). Input and output digits are limited to 0–9; bases needing A–F return null. Excel: DEC2BIN / BIN2DEC / BASE / DECIMAL.",
};

export class BaseConvertNode extends ClassicPreset.Node {
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

  data(inputs: { value?: number[]; from?: number[]; to?: number[] }): { result: number | null } {
    const rawVal = inputs.value?.[0] ?? this.literals.value ?? 0;
    const from   = Math.round(inputs.from?.[0] ?? this.literals.from ?? 2);
    const to     = Math.round(inputs.to?.[0]   ?? this.literals.to   ?? 10);

    if (from < 2 || from > 36 || to < 2 || to > 36) {
      this.cachedResult = null; return { result: null };
    }

    const intVal = Math.trunc(rawVal);
    const sign   = intVal < 0 ? -1 : 1;
    const absVal = Math.abs(intVal);

    // Step 1: parse decimal digit-string as a base-`from` number
    let decimal: number;
    if (from === 10) {
      decimal = absVal;
    } else {
      const str = absVal.toString();
      let d = 0;
      for (const ch of str) {
        const digit = parseInt(ch, 10);
        if (digit >= from) { this.cachedResult = null; return { result: null }; }
        d = d * from + digit;
      }
      decimal = d;
    }

    // Step 2: encode decimal as base-`to` digit-string number
    let result: number;
    if (to === 10) {
      result = sign * decimal;
    } else if (decimal === 0) {
      result = 0;
    } else {
      let n = decimal;
      const digitArr: number[] = [];
      while (n > 0) { digitArr.unshift(n % to); n = Math.floor(n / to); }
      if (digitArr.some(d => d > 9)) { this.cachedResult = null; return { result: null }; }
      let r = 0;
      for (const d of digitArr) r = r * 10 + d;
      result = sign * r;
    }

    this.cachedResult = Number.isFinite(result) ? result : null;
    return { result: this.cachedResult };
  }
}

// ─── Clamp ────────────────────────────────────────────────────────────────────

export class ClampNode extends ClassicPreset.Node {
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

  data(inputs: { value?: (number | number[])[]; min?: (number | number[])[]; max?: (number | number[])[] }) {
    const value = readInput(inputs.value, this.literals.value);
    const min   = inputs.min?.[0]   ?? this.literals.min   ?? null;
    const max   = inputs.max?.[0]   ?? this.literals.max   ?? null;
    if (value === null) { this.cachedResult = null; return { result: null }; }
    // Apply floor and ceiling independently — each is optional.
    let result: number | number[] = value;
    if (min !== null) result = broadcast((v, mn) => Math.max(v, mn), result, min) as number | number[];
    if (max !== null) result = broadcast((v, mx) => Math.min(v, mx), result, max) as number | number[];
    this.cachedResult = result;
    return { result };
  }
}

// ─── MROUND ───────────────────────────────────────────────────────────────────

// Round-to-a-multiple. Direction is an OP (nearest / up / down); the SHAPE is the
// node — the RoundN precedent (round/roundup/rounddown over (value, digits); these
// are over (value, multiple)). CEILING / FLOOR are this node pre-set to up / down
// with `multiple` defaulting to 1, so they behave unary out of the box — Excel's
// own shape (CEILING.MATH's significance is optional, default 1). Rounding is toward
// ±∞ (like the .MATH variants), matching the old MathFn ceil/floor those replaced.
export type MRoundOp = "nearest" | "up" | "down";

export const MROUND_OP_META = {
  nearest: { label: "MROUND",  description: "Round to the nearest multiple. Excel: MROUND(x, multiple)." },
  up:      { label: "CEILING", description: "Round UP to a multiple (toward +∞). Excel: CEILING.MATH(x, sig)." },
  down:    { label: "FLOOR",   description: "Round DOWN to a multiple (toward −∞). Excel: FLOOR.MATH(x, sig)." },
} satisfies Record<MRoundOp, { label: string; description: string }>;

export class MRoundNode extends ClassicPreset.Node {
  label: string;
  op: MRoundOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { value: 0, multiple: 1 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: MRoundOp }) {
    super("MRound");
    this.op = init?.op ?? "nearest";
    this.label = init?.label ?? MROUND_OP_META[this.op].label;
    this.addInput("value",    numListIn("Value"));
    this.addInput("multiple", numListIn("Multiple"));
    this.addOutput("result",  numListOut("Result"));
  }

  data(inputs: { value?: (number | number[])[]; multiple?: (number | number[])[] }) {
    const value    = readInput(inputs.value,    this.literals.value);
    const multiple = readInput(inputs.multiple, this.literals.multiple);
    const snap = this.op === "up" ? Math.ceil : this.op === "down" ? Math.floor : Math.round;
    let result: BroadcastResult = null;
    if (value !== null && multiple !== null) {
      result = broadcastErr((v, m) => {
        if (m === 0) return 0;
        // MROUND requires the value and multiple to share a sign — opposite signs
        // are #NUM! in Excel (#DOMAIN! here). CEILING/FLOOR (up/down) impose no such
        // restriction, so the guard is scoped to nearest.
        if (this.op === "nearest" && v !== 0 && Math.sign(v) !== Math.sign(m)) {
          return solError("#DOMAIN!", "MROUND needs the value and multiple to share a sign");
        }
        return snap(v / m) * m;
      }, value, multiple);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── ROUND / ROUNDUP / ROUNDDOWN ─────────────────────────────────────────────

export type RoundNOp = "round" | "roundup" | "rounddown";

export class RoundNNode extends ClassicPreset.Node {
  label: string;
  op: RoundNOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { value: 0, digits: 0 };
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: RoundNOp }) {
    super("RoundN");
    this.op = init?.op ?? "round";
    this.label = init?.label ?? "Rounding";
    this.addInput("value",  numListIn("Value"));
    this.addInput("digits", numListIn("Digits"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { value?: (number | number[])[]; digits?: (number | number[])[] }) {
    const value  = readInput(inputs.value, this.literals.value);
    const digits = inputs.digits?.[0] ?? this.literals.digits ?? 0; // config: unwired/blank → 0 places
    let result: BroadcastResult = null;
    if (value !== null) {
      result = broadcast((v, d) => {
        const factor = Math.pow(10, Math.round(d));
        switch (this.op) {
          // Halves away from zero (Excel), not toward +inf (JS Math.round).
          case "round":     return Math.sign(v) * Math.round(Math.abs(v) * factor) / factor;
          case "roundup":   return (v >= 0 ? Math.ceil(v * factor) : Math.floor(v * factor)) / factor;
          case "rounddown": return (v >= 0 ? Math.floor(v * factor) : Math.ceil(v * factor)) / factor;
        }
        return null;
      }, value, digits);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── GCD ───────────────────────────────────────────────────────────────────────

export type GcdOp = "gcd" | "lcm";

// Greatest common divisor / least common multiple of two integers.
// Inputs are rounded to integers; gcd(0,0)=0. List-aware via broadcast.
// Excel: =GCD(a,b) / =LCM(a,b).
export class GcdNode extends ClassicPreset.Node {
  label: string;
  op: GcdOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: GcdOp }) {
    super("Gcd");
    this.label = init?.label ?? "GCD";
    this.op = init?.op ?? "gcd";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    const result = broadcast((x, y) => {
      let p = Math.abs(Math.round(x));
      let q = Math.abs(Math.round(y));
      while (q) { [p, q] = [q, p % q]; }
      const gcd = p;
      if (this.op === "lcm") {
        const product = Math.abs(Math.round(x) * Math.round(y));
        return gcd === 0 ? 0 : product / gcd;
      }
      return gcd;
    }, a, b);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Combinatorics ─────────────────────────────────────────────────────────────

export type CombinatoricsOp = "combin" | "combina" | "permut" | "permutationa" | "fact" | "factdouble";

export const COMBINATORICS_OP_META = {
  fact:       { label: "FACT",       description: "n!, the factorial. Excel: FACT(n)." },
  factdouble: { label: "FACTDOUBLE", description: "n!!, the double factorial. Excel: FACTDOUBLE(n)." },
  combin:     { label: "COMBIN",     description: "C(n,k): combinations without repetition. Excel: COMBIN(n,k)." },
  combina:    { label: "COMBINA",    description: "C(n+k−1,k): combinations with repetition. Excel: COMBINA(n,k)." },
  permut:       { label: "PERMUT",       description: "P(n,k): ordered arrangements without repetition. Excel: PERMUT(n,k)." },
  permutationa: { label: "PERMUTATIONA", description: "nᵏ: ordered arrangements with repetition. Excel: PERMUTATIONA(n,k)." },
} satisfies Record<CombinatoricsOp, { label: string; description: string }>;

function factorial(n: number): number {
  if (n < 0) return NaN;
  if (n === 0) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export class CombinatoricsNode extends ClassicPreset.Node {
  label: string;
  op: CombinatoricsOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { n: 5, k: 2 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: CombinatoricsOp }) {
    super("Combinatorics");
    this.label = init?.label ?? "Combinatorics";
    this.op = init?.op ?? "combin";
    this.addInput("n", numIn("N"));
    this.addInput("k", numIn("K"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { n?: number[]; k?: number[] }): { result: number | SolError | null } {
    // Excel TRUNCATES a non-integer argument (FACT(2.9) = FACT(2) = 2), and the
    // formula path (Formula.js) floors — rounding here made the node disagree with
    // `=FACT(2.9)`. Floor matches both for the non-negative domain these ops live in
    // (negatives are caught by the per-op domain guards below).
    const n = Math.floor(inputs.n?.[0] ?? this.literals.n ?? 0);
    const k = Math.floor(inputs.k?.[0] ?? this.literals.k ?? 0);
    let result: number | null = null;
    let domainOk = true;
    switch (this.op) {
      case "combin":
        if (n >= 0 && k >= 0 && k <= n) result = factorial(n) / (factorial(k) * factorial(n - k));
        else domainOk = false;
        break;
      case "combina":
        if (n >= 0 && k >= 0) result = factorial(n + k - 1) / (factorial(k) * factorial(n - 1));
        else domainOk = false;
        break;
      case "permut":
        if (n >= 0 && k >= 0 && k <= n) result = factorial(n) / factorial(n - k);
        else domainOk = false;
        break;
      case "permutationa":
        if (n >= 0 && k >= 0) result = Math.pow(n, k);
        else domainOk = false;
        break;
      case "fact":
        if (n >= 0) result = factorial(n);
        else domainOk = false;
        break;
      case "factdouble": {
        if (n < -1) { domainOk = false; break; }
        if (n === -1 || n === 0) { result = 1; break; }
        let r = 1;
        for (let i = n; i > 0; i -= 2) r *= i;
        result = r;
        break;
      }
    }
    // Negative / out-of-order arguments are a domain error; a finite formula that
    // overflowed to ±∞ (FACT(171), a huge COMBIN) is too large to represent.
    if (!domainOk) {
      const err = solError("#DOMAIN!", "Combinatorics needs non-negative whole numbers with k ≤ n");
      this.cachedResult = err;
      return { result: err };
    }
    if (result !== null && !Number.isFinite(result)) {
      const err = solError("#OVERFLOW!", "The result is too large to represent; reduce N");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 2-Input Math ──────────────────────────────────────────────────────────────

export type TwoInputMathOp = "atan2" | "hypot" | "log" | "delta" | "gestep";

export const TWO_INPUT_MATH_OP_META = {
  atan2: { label: "ATAN2", description: "Angle from x,y coordinates: atan2(y, x). Excel: ATAN2(x_num, y_num)." },
  hypot: { label: "HYPOT", description: "Hypotenuse √(A² + B²)" },
  log:     { label: "LOG",     description: "Log of x in any base. Excel: LOG(x, base)." },
  delta:   { label: "DELTA",   description: "1 if A = B (within rounding), else 0. Excel: DELTA(a, b)." },
  gestep:  { label: "GESTEP",  description: "1 if A ≥ B, else 0. Excel: GESTEP(a, step)." },
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
    this.label = init?.label ?? "ATAN2";
    this.op = init?.op ?? "atan2";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    // LOG(x, base) is out of domain for x ≤ 0 or a degenerate base — #DOMAIN!,
    // tagged per-cell in a list exactly as the scalar tags (matches LN/LOG10 in
    // the Math node; was a silent null before).
    const domainErr = () => solError("#DOMAIN!", "LOG needs x > 0 and a base > 0, ≠ 1");
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (a !== null && b !== null) {
      result = broadcastErr((x, y) => {
        switch (this.op) {
          case "atan2":  return Math.atan2(y, x); // Excel ATAN2(x_num, y_num)
          case "hypot":  return Math.sqrt(x * x + y * y);
          case "log":    return (x <= 0 || y <= 0 || y === 1) ? domainErr() : Math.log(x) / Math.log(y);
          case "delta":  return Math.abs(x - y) < 1e-12 ? 1 : 0;
          case "gestep": return x >= y ? 1 : 0;
        }
        return null;
      }, a, b);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── SumProduct ─────────────────────────────────────────────────────────────────

export type SumProductOp = "sumx2my2" | "sumx2py2" | "sumxmy2" | "sumproduct";

export const SUM_PRODUCT_OP_META = {
  sumx2my2: { label: "SUMX2MY2", description: "Σ(xi² − yi²) across two lists. Excel: SUMX2MY2." },
  sumx2py2: { label: "SUMX2PY2", description: "Σ(xi² + yi²). Excel: SUMX2PY2." },
  sumxmy2:    { label: "SUMXMY2",    description: "Σ(xi − yi)². Excel: SUMXMY2." },
  sumproduct: { label: "SUMPRODUCT", description: "Dot product Σ(xi × yi). Excel: SUMPRODUCT(array1, array2)." },
} satisfies Record<SumProductOp, { label: string; description: string }>;

export class SumProductNode extends ClassicPreset.Node {
  label: string;
  op: SumProductOp;
  cachedResult: number | null = null;
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: SumProductOp }) {
    super("SumProduct");
    this.label = init?.label ?? "SUMX2MY2";
    this.op = init?.op ?? "sumx2my2";
    this.addInput("x", listIn("X list"));
    this.addInput("y", listIn("Y list"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[][]; y?: number[][] }) {
    const xs = inputs.x?.[0] ?? null;
    const ys = inputs.y?.[0] ?? null;
    let result: number | null = null;
    if (xs && ys && xs.length > 0 && ys.length > 0) {
      const n = Math.min(xs.length, ys.length);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        switch (this.op) {
          case "sumx2my2":  acc += xs[i] * xs[i] - ys[i] * ys[i]; break;
          case "sumx2py2":  acc += xs[i] * xs[i] + ys[i] * ys[i]; break;
          case "sumxmy2":   acc += (xs[i] - ys[i]) ** 2; break;
          case "sumproduct": acc += xs[i] * ys[i]; break;
        }
      }
      result = acc;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── SERIESSUM ────────────────────────────────────────────────────────────────

// SERIESSUM(x, n, m, coef) = Σᵢ coef[i] × x^(n + i×m)
// Excel: =SERIESSUM(x, n, m, coefficients)
export class SeriesSumNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, n: 0, m: 1 };
  width = 180;
  height = 215;

  constructor(init?: { label?: string }) {
    super("SeriesSum");
    this.label = init?.label ?? "SERIESSUM";
    this.addInput("x",    numIn("x"));
    this.addInput("n",    numIn("n (start power)"));
    this.addInput("m",    numIn("m (power step)"));
    this.addInput("coef", listIn("Coefficients"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; n?: number[]; m?: number[]; coef?: number[][] }) {
    const x    = inputs.x?.[0]    ?? this.literals.x ?? 1;
    const n    = inputs.n?.[0]    ?? this.literals.n ?? 0;
    const m    = inputs.m?.[0]    ?? this.literals.m ?? 1;
    const coef = inputs.coef?.[0] ?? null;
    if (!coef || coef.length === 0) { this.cachedResult = null; return { result: null }; }
    let result = 0;
    for (let i = 0; i < coef.length; i++) {
      result += coef[i] * Math.pow(x, n + i * m);
    }
    this.cachedResult = Number.isFinite(result) ? result : null;
    return { result: this.cachedResult };
  }
}

// ─── MULTINOMIAL ──────────────────────────────────────────────────────────────

// MULTINOMIAL(n1, n2, …, nk) = (n1+n2+…+nk)! / (n1! × n2! × … × nk!)
// Excel: =MULTINOMIAL(n1, n2, ...)
export class MultinomialNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  width = 180;
  height = 135;

  constructor(init?: { label?: string }) {
    super("Multinomial");
    this.label = init?.label ?? "MULTINOMIAL";
    this.addInput("values", listIn("Values (n₁, n₂, …)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { values?: number[][] }) {
    const vals = inputs.values?.[0] ?? null;
    if (!vals || vals.length === 0) { this.cachedResult = null; return { result: null }; }
    const ns = vals.map(Math.round);
    if (ns.some(v => v < 0)) { this.cachedResult = null; return { result: null }; }
    const total = ns.reduce((s, v) => s + v, 0);
    const lnResult = lnGamma(total + 1) - ns.reduce((s, v) => s + lnGamma(v + 1), 0);
    const result = Math.round(Math.exp(lnResult));
    this.cachedResult = Number.isFinite(result) ? result : null;
    return { result: this.cachedResult };
  }
}

// ─── Bessel functions (BESSELI / BESSELJ / BESSELY / BESSELK) ─────────────────

export type BesselOp = "besselj" | "bessely" | "besseli" | "besselk";

export const BESSEL_OP_META = {
  besselj: { label: "BESSELJ", description: "Bessel function of the first kind, order n. Excel: BESSELJ." },
  bessely: { label: "BESSELY", description: "Bessel function of the second kind, order n; x must be > 0. Excel: BESSELY." },
  besseli: { label: "BESSELI", description: "Modified Bessel function of the first kind, order n. Excel: BESSELI." },
  besselk: { label: "BESSELK", description: "Modified Bessel function of the second kind, order n; x must be > 0. Excel: BESSELK." },
} satisfies Record<BesselOp, { label: string; description: string }>;

export class BesselNode extends ClassicPreset.Node {
  label: string;
  op: BesselOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, n: 0 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: BesselOp }) {
    super("Bessel");
    this.op    = init?.op    ?? "besselj";
    this.label = init?.label ?? BESSEL_OP_META[this.op].label;
    this.addInput("x", numIn("x"));
    this.addInput("n", numIn("Order n (integer ≥ 0)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; n?: number[] }): { result: number | null } {
    const x = inputs.x?.[0] ?? this.literals.x ?? 1;
    const n = Math.max(0, Math.round(inputs.n?.[0] ?? this.literals.n ?? 0));
    let result: number;
    switch (this.op) {
      case "besselj": result = _besselJ(x, n); break;
      case "bessely": result = _besselY(x, n); break;
      case "besseli": result = _besselI(x, n); break;
      case "besselk": result = _besselK(x, n); break;
    }
    if (!Number.isFinite(result)) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = result;
    return { result };
  }
}

// ─── HYPOTENUSE (example pack node) ─────────────────────────────────────────────
// Leg lengths → hypotenuse √(x²+y²). Shipped in the "Geometry" built-in pack
// (see packs.ts) to exercise the pack activate/deactivate flow end-to-end; it's
// element-wise like the other math nodes, so it lives here.
export class HypotenuseNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 168;

  constructor(init?: { label?: string }) {
    super("Hypotenuse");
    this.label = init?.label ?? "HYPOTENUSE";
    this.addInput("x", numListIn("X"));
    this.addInput("y", numListIn("Y"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { x?: (number | number[])[]; y?: (number | number[])[] }) {
    const x = readInput(inputs.x, this.literals.x);
    const y = readInput(inputs.y, this.literals.y);
    const result = broadcast((a, b) => Math.hypot(a, b), x, y);
    this.cachedResult = result;
    return { result };
  }
}
