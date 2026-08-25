import { ClassicPreset } from "rete";
import { broadcast, broadcastErr, broadcastUnit, anyDimensioned, readInput, numListIn, numListOut, numIn, numOut, listIn, type BroadcastResult, type UnitOperand } from "./shared";
import { lnGamma } from "./mathUtils";
import { solError, type SolError } from "../errorValue";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { type UnitCell, dimOf, magnitudeOf, tagDim, unitError, arithmeticCell, type ArithmeticOp } from "../unitValue";
import { type Dim, DIMENSIONLESS, dimEqual, dimPow, isDimensionless } from "../dimension";

// ─── Bessel helpers ───────────────────────────────────────────────────────────

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
  const y0 = _besselY0(x);
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

// The op union + per-cell dimensional algebra live in ../unitValue (rete-free);
// re-exported here as the family's home module.
export { arithmeticCell, type ArithmeticOp } from "../unitValue";

export const ARITHMETIC_OP_META = {
  add:      { label: "Add",        description: "A + B" },
  sub:      { label: "Subtract"  , description: "A − B" },
  mul:      { label: "Multiply"  , description: "A × B" },
  div:      { label: "Divide",     description: "A ÷ B. #DIV/0! when B = 0." },
  mod:      { label: "MOD",        description: "Remainder of A ÷ B. Excel: MOD." },
  quotient: { label: "QUOTIENT",   description: "Integer part of A ÷ B, truncated toward zero. Excel: QUOTIENT." },
  pow:      { label: "POWER",      description: "A raised to the power B. 0^0 = 1 (JS/Python/Polars convention. Excel gives #NUM!). A finite result too large to represent → #OVERFLOW!. Excel: POWER / A^B." },
} satisfies Record<ArithmeticOp, { label: string; description: string }>;

export class ArithmeticNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
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

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    // ÷ 0 is #DIV/0! at EVERY dimensionality: a tagged SolError for a scalar, a
    // per-cell error inside a list. Same for MOD / QUOTIENT.
    const divZero = () => solError("#DIV/0!", "Division by zero");
    let result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
    if (a !== null && b !== null) {
      // The unit-aware path runs only when a dimension is present; plain numbers keep
      // the broadcastErr fast path.
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
            // Excel MOD's sign follows the DIVISOR (MOD(-3,2)=1); JS % follows the
            // dividend, so use the floored definition.
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
  abs:     { label: "ABS",     group: "Functions",    description: "Absolute value. Excel: ABS." },
  sign:    { label: "SIGN",    group: "Functions",    description: "−1, 0, or 1 depending on sign. Excel: SIGN." },
  sqrt:    { label: "SQRT",    group: "Functions",    description: "Square root. Excel: SQRT." },
  sqrtpi:  { label: "SQRTPI",  group: "Functions",    description: "√(x × π). Excel: SQRTPI." },
  exp:     { label: "EXP",     group: "Functions",    description: "e raised to the power x. Excel: EXP." },
  trunc:   { label: "TRUNC",   group: "Rounding",     description: "Truncate toward zero: TRUNC(−3.7) = −3. Excel: TRUNC." },
  int:     { label: "INT",     group: "Rounding",     description: "Rounds down toward −∞: INT(−3.7) = −4. Excel: INT." },
  even:    { label: "EVEN",    group: "Rounding",     description: "Rounds away from zero to nearest even integer. Excel: EVEN." },
  odd:     { label: "ODD",     group: "Rounding",     description: "Rounds away from zero to nearest odd integer. Excel: ODD." },
  log:     { label: "LN",      group: "Logarithms",   description: "Natural log (base e). Excel: LN." },
  log10:   { label: "LOG10",   group: "Logarithms",   description: "Log base 10. Excel: LOG10." },
  log2:    { label: "LOG2",    group: "Logarithms",   description: "Log base 2: log₂(x), for example how many bits represent x. Excel: LOG." },
  sin:     { label: "SIN",     group: "Trigonometry", description: "Sine. Excel: SIN." },
  cos:     { label: "COS",     group: "Trigonometry", description: "Cosine. Excel: COS." },
  tan:     { label: "TAN",     group: "Trigonometry", description: "Tangent. Excel: TAN." },
  cot:     { label: "COT",     group: "Trigonometry", description: "Cotangent (1/tan). Excel: COT." },
  csc:     { label: "CSC",     group: "Trigonometry", description: "Cosecant (1/sin). Excel: CSC." },
  sec:     { label: "SEC",     group: "Trigonometry", description: "Secant (1/cos). Excel: SEC." },
  asin:    { label: "ASIN",    group: "Trigonometry", description: "Arc sine → [−π/2, π/2]. Excel: ASIN." },
  acos:    { label: "ACOS",    group: "Trigonometry", description: "Arc cosine → [0, π]. Excel: ACOS." },
  atan:    { label: "ATAN",    group: "Trigonometry", description: "Arc tangent → (−π/2, π/2). Excel: ATAN." },
  acot:    { label: "ACOT",    group: "Trigonometry", description: "Arc cotangent → (0, π). Excel: ACOT." },
  sinh:    { label: "SINH",    group: "Hyperbolic",   description: "Hyperbolic sine. Excel: SINH." },
  cosh:    { label: "COSH",    group: "Hyperbolic",   description: "Hyperbolic cosine. Excel: COSH." },
  tanh:    { label: "TANH",    group: "Hyperbolic",   description: "Hyperbolic tangent. Excel: TANH." },
  asinh:   { label: "ASINH",   group: "Hyperbolic",   description: "Inverse hyperbolic sine. Excel: ASINH." },
  acosh:   { label: "ACOSH",   group: "Hyperbolic",   description: "Inverse hyperbolic cosine. Excel: ACOSH." },
  atanh:   { label: "ATANH",   group: "Hyperbolic",   description: "Inverse hyperbolic tangent. Excel: ATANH." },
  coth:    { label: "COTH",    group: "Hyperbolic",   description: "Hyperbolic cotangent (cosh/sinh). Excel: COTH." },
  csch:    { label: "CSCH",    group: "Hyperbolic",   description: "Hyperbolic cosecant (1/sinh). Excel: CSCH." },
  sech:    { label: "SECH",    group: "Hyperbolic",   description: "Hyperbolic secant (1/cosh). Excel: SECH." },
  acoth:   { label: "ACOTH",   group: "Hyperbolic",   description: "Inverse hyperbolic cotangent. Domain |x| > 1. Excel: ACOTH." },
  erf:     { label: "ERF",     group: "Special",      description: "Error function erf(x) = (2/√π)∫₀ˣ e^(−t²) dt. Excel: ERF." },
  erfc:    { label: "ERFC",    group: "Special",      description: "Complementary error function: 1 − erf(x). Excel: ERFC." },
  gamma:   { label: "GAMMA",   group: "Special",      description: "Gamma function Γ(x): generalizes factorial, Γ(n) = (n−1)! Excel: GAMMA." },
  gammaln: { label: "GAMMALN", group: "Special",      description: "Natural log of the Gamma function ln(Γ(x)). Excel: GAMMALN." },
} satisfies Record<MathFnOp, { label: string; description: string; group: string }>;

// Split by which side is the ANGLE; only these show the deg/rad/auto toggle, since
// hyperbolic ops take and return plain reals.
export const FORWARD_TRIG_OPS = new Set<MathFnOp>(["sin", "cos", "tan", "cot", "csc", "sec"]);
export const INVERSE_TRIG_OPS = new Set<MathFnOp>(["asin", "acos", "atan", "acot"]);
export function isTrigOp(op: MathFnOp): boolean {
  return FORWARD_TRIG_OPS.has(op) || INVERSE_TRIG_OPS.has(op);
}

// `rad` is Excel parity, `deg` converts, `auto` reads the incoming unit — auto's
// effective mode is resolved at recompute time into `_resolvedAngleMode`.
export type AngleMode = "auto" | "rad" | "deg";
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Ops that PRESERVE their argument's dimension — a rounded length is still a length.
const MATHFN_PRESERVE = new Set<MathFnOp>(["abs", "trunc", "int", "even", "odd"]);
const MATHFN_FORWARD_TRIG = FORWARD_TRIG_OPS;   // accept angle/dimensionless → number
const MATHFN_INVERSE_TRIG = INVERSE_TRIG_OPS;   // dimensionless → angle

/** The dimensional signature of a Math-fn op applied to an input of dimension `dim`.
 *  Returns the result dim, a `#UNIT!` when the op needs a dimensionless argument it
 *  didn't get, or `"strip"` when the input is dimensionless (compute plainly). */
export function mathFnResultDim(op: MathFnOp, dim: Dim): Dim | SolError | "strip" {
  if (isDimensionless(dim)) return "strip";
  if (MATHFN_PRESERVE.has(op)) return dim;
  if (op === "sqrt") return dimPow(dim, 0.5);
  if (op === "sqrtpi") return dimPow(dim, 0.5); // √(x·π) — π is dimensionless
  if (op === "sign") return DIMENSIONLESS;
  if (MATHFN_FORWARD_TRIG.has(op)) {
    return dimEqual(dim, { angle: 1 }) ? DIMENSIONLESS
      : unitError(`${op.toUpperCase()} needs an angle or a plain number.`);
  }
  if (MATHFN_INVERSE_TRIG.has(op)) return { angle: 1 }; // result is an angle (radians)
  // Transcendentals / special functions: a dimensioned argument is meaningless.
  return unitError(`${op.toUpperCase()} needs a dimensionless argument.`);
}

export class MathFnNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  op: MathFnOp;
  /** Angle interpretation for trig ops (ignored by every other op). */
  angleMode: AngleMode;
  /** Stamped by the recompute-time unit read; defaults to rad so a node computed
   *  before any reconcile still matches Excel. Not persisted. */
  _resolvedAngleMode: "rad" | "deg" = "rad";
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

  /** The effective mode for THIS pass: an explicit pin wins; `auto` uses the
   *  unit-resolved mode (default rad). */
  effectiveAngleMode(): "rad" | "deg" {
    return this.angleMode === "auto" ? this._resolvedAngleMode : this.angleMode;
  }

  /** An inverse trig op in degree mode carries a real `deg` unit out, so it reads as
   *  30° and chains into another trig node's Auto mode. */
  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "result" && INVERSE_TRIG_OPS.has(this.op) && this.effectiveAngleMode() === "deg"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  data(inputs: { in?: (number | number[])[] }) {
    const input = readInput(inputs.in, this.literals.in);
    const mode = this.effectiveAngleMode();
    // Deg mode converts a forward op's INPUT and an inverse op's RESULT.
    const fwdDeg = mode === "deg" && FORWARD_TRIG_OPS.has(this.op);
    const invDeg = mode === "deg" && INVERSE_TRIG_OPS.has(this.op);
    // A valid input with no defined result is #DOMAIN! (the specific half of Excel's
    // #NUM!) at every dimensionality; `compute` returns null and broadcastErr maps it.
    const domainErr = () => solError("#DOMAIN!", "Input is outside this function's domain");
    const computeRaw = (x: number): number | null => {
        switch (this.op) {
          case "abs":   return Math.abs(x);
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
    // Degree conversion wraps the raw radian math at the boundary only; every other
    // op is untouched.
    const compute = (x: number): number | null => {
      const r = computeRaw(fwdDeg ? x * DEG2RAD : x);
      return r !== null && invDeg ? r * RAD2DEG : r;
    };
    let result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
    if (input !== null) {
      if (anyDimensioned(input as UnitOperand | UnitOperand[])) {
        // mathFnResultDim gates a dimensioned argument. A UnitCell angle is already in
        // base radians, so trig computes on the magnitude with no deg conversion.
        result = broadcastUnit((cell) => {
          const rd = mathFnResultDim(this.op, dimOf(cell));
          if (typeof rd !== "string" && (rd as SolError).code) return rd as SolError;
          const raw = computeRaw(magnitudeOf(cell));
          if (raw === null) return domainErr();
          return rd === "strip" ? raw : tagDim(raw, rd as Dim);
        }, input as UnitOperand | UnitOperand[]);
      } else {
        result = broadcastErr((x) => compute(x) ?? domainErr(), input);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Base Convert ─────────────────────────────────────────────────────────────
// Bases > 10 whose output would need digits A-F return null (there is no string type).

export const BASE_CONVERT_META = {
  label: "Base Convert",
  description: "Convert an integer from one base to another (2–36), digits 0–9 only: a digit outside the source base, or a result needing letter digits, is null. Excel: DEC2BIN / BIN2DEC / BASE / DECIMAL.",
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
    const rawVal = readInput(inputs.value, this.literals.value ?? 0);
    const fromRaw = readInput(inputs.from, this.literals.from ?? 2);
    const toRaw   = readInput(inputs.to,   this.literals.to   ?? 10);
    if (rawVal === null || fromRaw === null || toRaw === null) { this.cachedResult = null; return { result: null }; }
    const from = Math.round(fromRaw);
    const to   = Math.round(toRaw);

    if (from < 2 || from > 36 || to < 2 || to > 36) {
      this.cachedResult = null; return { result: null };
    }

    const intVal = Math.trunc(rawVal);
    const sign   = intVal < 0 ? -1 : 1;
    const absVal = Math.abs(intVal);

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
  static socketDocs: Record<string, string> = {
    min: "Empty and unwired, there is no floor. A wired blank makes the whole result blank.",
    max: "Empty and unwired, there is no ceiling. A wired blank makes the whole result blank.",
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

  data(inputs: { value?: (number | number[])[]; min?: (number | number[])[]; max?: (number | number[])[] }) {
    const value = readInput(inputs.value, this.literals.value);
    // "Absent" is not "unknown": an UNWIRED bound means no floor/ceiling, but a WIRED
    // blank makes the result unknown — routing it to no-bound would stop clamping.
    const minWired = inputs.min !== undefined, maxWired = inputs.max !== undefined;
    const min = minWired ? (inputs.min?.[0] ?? null) : (this.literals.min ?? null);
    const max = maxWired ? (inputs.max?.[0] ?? null) : (this.literals.max ?? null);
    if (value === null) { this.cachedResult = null; return { result: null }; }
    if ((minWired && min === null) || (maxWired && max === null)) { this.cachedResult = null; return { result: null }; }
    let result: number | number[] = value;
    if (min !== null) result = broadcast((v, mn) => Math.max(v, mn), result, min) as number | number[];
    if (max !== null) result = broadcast((v, mx) => Math.min(v, mx), result, max) as number | number[];
    this.cachedResult = result;
    return { result };
  }
}

// ─── MROUND ───────────────────────────────────────────────────────────────────

// Round-to-a-multiple; direction is an OP, so CEILING / FLOOR are this node pre-set
// with `multiple` defaulting to 1. Rounding is toward ±∞ (the .MATH variants).
export type MRoundOp = "nearest" | "up" | "down";

export const MROUND_OP_META = {
  nearest: { label: "MROUND",  description: "Round to the nearest multiple. Excel: MROUND." },
  up:      { label: "CEILING", description: "Round up to a multiple (toward +∞). Excel: CEILING.MATH." },
  down:    { label: "FLOOR",   description: "Round down to a multiple (toward −∞). Excel: FLOOR.MATH." },
} satisfies Record<MRoundOp, { label: string; description: string }>;

export class MRoundNode extends ClassicPreset.Node {
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

  data(inputs: { value?: (number | number[])[]; multiple?: (number | number[])[] }) {
    const value    = readInput(inputs.value,    this.literals.value);
    const multiple = readInput(inputs.multiple, this.literals.multiple);
    const snap = this.op === "up" ? Math.ceil : this.op === "down" ? Math.floor : Math.round;
    let result: BroadcastResult = null;
    if (value !== null && multiple !== null) {
      result = broadcastErr((v, m) => {
        if (m === 0) return 0;
        // MROUND needs value and multiple to share a sign (#DOMAIN!); CEILING/FLOOR
        // impose no such restriction, so the guard is scoped to nearest.
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

export const ROUNDN_OP_META = {
  round:     { label: "ROUND",     description: "Rounds to N decimal places, half away from zero. Excel: ROUND." },
  roundup:   { label: "ROUNDUP",   description: "Rounds away from zero to N decimal places. Excel: ROUNDUP." },
  rounddown: { label: "ROUNDDOWN", description: "Rounds toward zero to N decimal places. Excel: ROUNDDOWN." },
} satisfies Record<RoundNOp, { label: string; description: string }>;

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
    this.label = init?.label ?? "";
    this.addInput("value",  numListIn("Value"));
    this.addInput("digits", numListIn("Digits"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { value?: (number | number[])[]; digits?: (number | number[])[] }) {
    const value  = readInput(inputs.value, this.literals.value);
    // UNWIRED → 0 places; a WIRED blank is an unknown precision and propagates.
    const digits = readInput(inputs.digits, this.literals.digits ?? 0);
    let result: BroadcastResult = null;
    if (value !== null) {
      result = broadcast((v, d) => {
        const factor = Math.pow(10, Math.round(d));
        switch (this.op) {
          // Halves away from zero (Excel), not toward +∞ (JS Math.round).
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

export const GCD_OP_META = {
  gcd: { label: "GCD", description: "Greatest common divisor of two integers. Excel: GCD." },
  lcm: { label: "LCM", description: "Least common multiple of two integers. Excel: LCM." },
} satisfies Record<GcdOp, { label: string; description: string }>;

// Inputs are rounded to integers; gcd(0,0)=0.
export class GcdNode extends ClassicPreset.Node {
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
  fact:       { label: "FACT",       description: "n!, the factorial. Excel: FACT." },
  factdouble: { label: "FACTDOUBLE", description: "n!!, the double factorial. Excel: FACTDOUBLE." },
  combin:     { label: "COMBIN",     description: "C(n,k): combinations without repetition. Excel: COMBIN." },
  combina:    { label: "COMBINA",    description: "C(n+k−1,k): combinations with repetition. Excel: COMBINA." },
  permut:       { label: "PERMUT",       description: "P(n,k): ordered arrangements without repetition. Excel: PERMUT." },
  permutationa: { label: "PERMUTATIONA", description: "nᵏ: ordered arrangements with repetition. Excel: PERMUTATIONA." },
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
    this.label = init?.label ?? "";
    this.op = init?.op ?? "combin";
    this.addInput("n", numIn("N"));
    this.addInput("k", numIn("K"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { n?: number[]; k?: number[] }): { result: number | SolError | null } {
    // Excel TRUNCATES a non-integer argument and Formula.js floors, so floor keeps the
    // node agreeing with `=FACT(2.9)` across the non-negative domain.
    // FACT/FACTDOUBLE are single-arg (Excel FACT(n)) — they never read k, so a wired-blank
    // k must not blank the result (value-semantics.md, "Reading an input").
    const usesK = this.op !== "fact" && this.op !== "factdouble";
    const nRaw = readInput(inputs.n, this.literals.n ?? 0);
    if (nRaw === null) { this.cachedResult = null; return { result: null }; }
    const n = Math.floor(nRaw);
    let k = 0;
    if (usesK) {
      const kRaw = readInput(inputs.k, this.literals.k ?? 0);
      if (kRaw === null) { this.cachedResult = null; return { result: null }; }
      k = Math.floor(kRaw);
    }
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
    // overflowed to ±∞ is too large to represent.
    if (!domainOk) {
      const err = solError("#DOMAIN!", "Combinatorics needs non-negative whole numbers with k ≤ n");
      this.cachedResult = err;
      return { result: err };
    }
    if (result !== null && !Number.isFinite(result)) {
      const err = solError("#OVERFLOW!", "The result is too large to represent. Reduce N");
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
  atan2: { label: "ATAN2", description: "Angle from x,y coordinates: atan2(y, x). Excel: ATAN2." },
  hypot: { label: "HYPOTENUSE", description: "Hypotenuse √(A² + B²) of the two legs" },
  log:     { label: "LOG",     description: "Log of x in any base. Excel: LOG." },
  delta:   { label: "DELTA",   description: "1 if A = B (within rounding), else 0. Excel: DELTA." },
  gestep:  { label: "GESTEP",  description: "1 if A ≥ B, else 0. Excel: GESTEP." },
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

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    // x ≤ 0 or a degenerate base is #DOMAIN!, tagged per-cell in a list.
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
  sumproduct: { label: "SUMPRODUCT", description: "Dot product Σ(xi × yi). Excel: SUMPRODUCT." },
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
    const x = readInput(inputs.x, this.literals.x ?? 1);
    const n = readInput(inputs.n, this.literals.n ?? 0);
    const m = readInput(inputs.m, this.literals.m ?? 1);
    if (x === null || n === null || m === null) { this.cachedResult = null; return { result: null }; }
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
  bessely: { label: "BESSELY", description: "Bessel function of the second kind, order n. x must be > 0. Excel: BESSELY." },
  besseli: { label: "BESSELI", description: "Modified Bessel function of the first kind, order n. Excel: BESSELI." },
  besselk: { label: "BESSELK", description: "Modified Bessel function of the second kind, order n. x must be > 0. Excel: BESSELK." },
} satisfies Record<BesselOp, { label: string; description: string }>;

export class BesselNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    n: "Integer order, 0 or greater.",
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

  data(inputs: { x?: number[]; n?: number[] }): { result: number | null } {
    const x = readInput(inputs.x, this.literals.x ?? 1);
    const nRaw = readInput(inputs.n, this.literals.n ?? 0);
    if (x === null || nRaw === null) { this.cachedResult = null; return { result: null }; }
    const n = Math.max(0, Math.round(nRaw));
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

