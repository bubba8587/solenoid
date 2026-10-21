// [[B16]]
import { ClassicPreset } from "rete";
import { broadcast, broadcastErr, broadcastUnit, anyDimensioned, readInput, readRole, numListIn, numListOut, numIn, numOut, listIn, readAsRole, leftOutAs, type BroadcastResult, type UnitOperand } from "./shared";
import { rolesFrom, required, argRole } from "../inputRoles";
import { lnGamma, combinatoric } from "./mathUtils";
import { callCore } from "../coreValues";
import { solError, type SolError, isSolError } from "../errorValue";
import { guardFinite } from "../valueKinds";
import type { FormatAnnotation } from "../formatAnnotationStore";
import type { FormatCarrySpec } from "./formatCarry";
import { type UnitCell, dimOf, magnitudeOf, tagDim, unitError, arithmeticCell, isUnitCell, fromUnit, type ArithmeticOp } from "../unitValue";
import { fcUnitToUnit, displayMagnitudeOf } from "../unitBridge";
import { type Dim, DIMENSIONLESS, dimEqual, dimPow, isDimensionless } from "../dimension";

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

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    const divZero = () => solError("#DIV/0!", "Division by zero");
    let result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
    if (a !== null && b !== null) {
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
            // Excel MOD's sign follows the divisor and JS % the dividend, so use the floored form.
            case "mod":      return callCore("MOD", [x, y]) as number | SolError;
            case "pow":      return callCore("POWER", [x, y]) as number | SolError;
            case "quotient": return callCore("QUOTIENT", [x, y]) as number | SolError;
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
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const MATHFN_PRESERVE = new Set<MathFnOp>(["abs", "trunc", "int", "even", "odd"]);
const MATHFN_FORWARD_TRIG = FORWARD_TRIG_OPS;

/** Returns the result dim, #UNIT! for a dimensioned argument the op cannot take, or "strip" for a dimensionless input. */
export function mathFnResultDim(op: MathFnOp, dim: Dim): Dim | SolError | "strip" {
  if (isDimensionless(dim)) return "strip";
  if (MATHFN_PRESERVE.has(op)) return dim;
  if (op === "sqrt") return dimPow(dim, 0.5);
  if (op === "sqrtpi") return dimPow(dim, 0.5);
  if (op === "sign") return DIMENSIONLESS;
  if (MATHFN_FORWARD_TRIG.has(op)) {
    return dimEqual(dim, { angle: 1 }) ? DIMENSIONLESS
      : unitError(`${op.toUpperCase()} needs an angle or a plain number.`);
  }
  return unitError(`${op.toUpperCase()} needs a dimensionless argument.`);
}

// Where the formula twin answers differently (last-digit noise, ACOT's range, the ERF approximation, GAMMA below 0,
// ACOTH at 1 and -1), the card keeps its own kernel; the rest run on the core.
const OWN_KERNEL_OPS = new Set<MathFnOp>(["tanh", "sinh", "asinh", "acot", "coth", "csch", "acoth", "erf", "erfc", "gamma", "gammaln"]);

function ownKernel(op: MathFnOp, x: number): number | null {
  switch (op) {
    case "tanh":    return Math.tanh(x);
    case "sinh":    return Math.sinh(x);
    case "asinh":   return Math.asinh(x);
    case "acot":    return Math.PI / 2 - Math.atan(x);
    case "coth":    return Math.sinh(x) === 0 ? null : Math.cosh(x) / Math.sinh(x);
    case "csch":    return Math.sinh(x) === 0 ? null : 1 / Math.sinh(x);
    case "acoth":   return (x <= -1 || x >= 1) ? (Math.abs(x) === 1 ? null : Math.atanh(1 / x)) : null;
    case "erf":
    case "erfc": {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
      const e = (x < 0 ? -1 : 1) * (1 - p * Math.exp(-x * x));
      return op === "erf" ? e : 1 - e;
    }
    case "gamma":   return x > 0 ? Math.exp(lnGamma(x)) : null;
    case "gammaln": return x > 0 ? lnGamma(x) : null;
    default:        return null;
  }
}

export class MathFXNode extends ClassicPreset.Node {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  op: MathFnOp;
  angleMode: AngleMode;
  /** Stamped by resolveTrigModes each recompute; rad until then, matching Excel. */
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

  data(inputs: { in?: (number | number[])[] }) {
    const input = readInput(inputs.in, this.literals.in);
    const mode = this.effectiveAngleMode();
    const fwdDeg = mode === "deg" && FORWARD_TRIG_OPS.has(this.op);
    const invDeg = mode === "deg" && INVERSE_TRIG_OPS.has(this.op);
    const domainErr = () => solError("#DOMAIN!", "Input is outside this function's domain");
    const op = this.op;
    const fn = op === "log" ? "LN" : op.toUpperCase();
    const computeRaw = (x: number): number | null => {
      if (OWN_KERNEL_OPS.has(op)) return ownKernel(op, x);
      const r = callCore(fn, [x]);
      return typeof r === "number" ? r : null;
    };
    const compute = (x: number): number | null => {
      const r = computeRaw(fwdDeg ? x * DEG2RAD : x);
      return r !== null && invDeg ? r * RAD2DEG : r;
    };
    let result: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
    if (input !== null) {
      if (anyDimensioned(input as UnitOperand | UnitOperand[])) {
        // A UnitCell angle is already base radians and carries its own unit; a plain or dimensionless cell follows the node's angle mode, so one list can mix both.
        result = broadcastUnit((cell) => {
          const rd = mathFnResultDim(this.op, dimOf(cell));
          if (typeof rd !== "string" && (rd as SolError).code) return rd as SolError;
          const bare = !isUnitCell(cell) || rd === "strip";
          // abs / int / even… act on the number the user reads (5 km, 20.5 °C), never
          // its base-SI magnitude, and the reading keeps its display unit.
          const shown = !bare && cell.display && MATHFN_PRESERVE.has(this.op) ? fcUnitToUnit(cell.display) : null;
          if (shown && !bare && dimEqual(shown.dim, cell.dim)) {
            const r = computeRaw(displayMagnitudeOf(cell));
            return r === null ? domainErr() : fromUnit(r, shown, cell.display);
          }
          const x = magnitudeOf(cell);
          const raw = computeRaw(bare && fwdDeg ? x * DEG2RAD : x);
          if (raw === null) return domainErr();
          const out = bare && invDeg ? raw * RAD2DEG : raw;
          return rd === "strip" ? out : tagDim(out, rd as Dim);
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

  data(inputs: { value?: number[]; from?: number[]; to?: number[] }): { result: number | SolError | null } {
    const rawVal = readInput(inputs.value, this.literals.value ?? 0);
    const fromRaw = readRole<number | SolError>(this, "from", inputs.from);
    const toRaw   = readRole<number | SolError>(this, "to", inputs.to);
    if (isSolError(fromRaw)) { this.cachedResult = null; return { result: fromRaw }; }
    if (isSolError(toRaw)) { this.cachedResult = null; return { result: toRaw }; }
    if (rawVal === null) { this.cachedResult = null; return { result: null }; }
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

  data(inputs: { value?: (number | number[])[]; min?: (number | number[])[]; max?: (number | number[])[] }) {
    const value = readInput(inputs.value, this.literals.value);
    // A blank bound, whole or one item of a list, is no bound there ([[D86]] blankRoles).
    const bound = (v: unknown, open: number): number | number[] | null =>
      v === undefined ? null : Array.isArray(v) ? v.map((x) => (x === undefined ? open : x)) : (v as number);
    const min = bound(readRole(this, "min", inputs.min), -Infinity);
    const max = bound(readRole(this, "max", inputs.max), Infinity);
    if (value === null) { this.cachedResult = null; return { result: null }; }
    const result = broadcast((v, mn, mx) => callCore("CLAMP", [v, mn, mx]) as number, value, min ?? -Infinity, max ?? Infinity) as number | number[];
    this.cachedResult = result;
    return { result };
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

  data(inputs: { value?: (number | number[])[]; multiple?: (number | number[])[] }) {
    const value    = readInput(inputs.value,    this.literals.value);
    const multiple = readRole<number | number[] | SolError>(this, "multiple", inputs.multiple);
    let result: BroadcastResult = null;
    if (isSolError(multiple)) result = multiple;
    else if (value !== null) {
      result = broadcastErr((v, m) => {
        if (m === 0) return 0;
        // Only MROUND requires value and multiple to share a sign; CEILING and FLOOR do not.
        if (this.op === "nearest" && v !== 0 && Math.sign(v) !== Math.sign(m)) {
          return solError("#DOMAIN!", "MROUND needs the value and multiple to share a sign");
        }
        // CEILING.MATH and FLOOR.MATH read the multiple's magnitude only; the card's up and down follow its sign.
        return this.op === "nearest" ? callCore("MROUND", [v, m]) as number | SolError : (this.op === "up" ? Math.ceil : Math.floor)(v / m) * m;
      }, value, multiple);
    }
    this.cachedResult = result;
    return { result };
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

  data(inputs: { value?: (number | number[])[]; digits?: (number | number[])[] }) {
    const value  = readInput(inputs.value, this.literals.value);
    const digits = readRole<number | number[]>(this, "digits", inputs.digits);
    let result: BroadcastResult = null;
    if (value !== null) {
      const fn = this.op.toUpperCase();
      result = broadcast((v, d) => callCore(fn, [v, d]) as number, value, digits);
    }
    this.cachedResult = result;
    return { result };
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

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    const b = readInput(inputs.b, this.literals.b);
    const fn = this.op.toUpperCase();
    const result = broadcastErr((x, y) => callCore(fn, [x, y]) as number | SolError, a, b);
    this.cachedResult = result;
    return { result };
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

  data(inputs: { n?: number[]; k?: number[] }): { result: number | SolError | null } {
    // FACT and FACTDOUBLE never read k, so a wired blank k must not blank them.
    const usesK = this.op !== "fact" && this.op !== "factdouble";
    const n = readInput(inputs.n, this.literals.n ?? 0);
    const k = usesK ? readInput(inputs.k, this.literals.k ?? 0) : 0;
    if (n === null || k === null) { this.cachedResult = null; return { result: null }; }
    // [[C17]] shareImpl: the formula's kernel; PERMUTATIONA is the card's own.
    let result: number | SolError = this.op === "permutationa"
      ? (Math.trunc(n) >= 0 && Math.trunc(k) >= 0 ? Math.pow(Math.trunc(n), Math.trunc(k)) : solError("#DOMAIN!", "Counts must be finite and 0 or more"))
      : combinatoric(this.op, usesK ? [n, k] : [n]);
    if (typeof result === "number" && !Number.isFinite(result)) {
      result = solError("#OVERFLOW!", "The result is too large to represent. Reduce N");
    }
    this.cachedResult = result;
    return { result };
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

  data(inputs: { a?: (number | number[])[]; b?: (number | number[])[] }) {
    const a = readInput(inputs.a, this.literals.a);
    // LOG's base and GESTEP's step are settings; B is data under every other op.
    const b = this.op === "log" ? leftOutAs(readAsRole<number | (number | undefined)[] | undefined>(this, "b", inputs.b, argRole("LOG", 1)!), 10)
      : this.op === "gestep" ? leftOutAs(readAsRole<number | (number | undefined)[] | undefined>(this, "b", inputs.b, argRole("GESTEP", 1)!), 0)
      : readInput(inputs.b, this.literals.b);
    const domainErr = () => solError("#DOMAIN!", "LOG needs x > 0 and a base > 0, ≠ 1");
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (a !== null && b !== null) {
      result = broadcastErr((x, y) => {
        switch (this.op) {
          case "atan2":  return callCore("ATAN2", [x, y]) as number | SolError;
          case "hypot":  return Math.sqrt(x * x + y * y);
          case "log":    return (x <= 0 || y <= 0 || y === 1) ? domainErr() : callCore("LOG", [x, y]) as number | SolError;
          case "delta":  return Math.abs(x - y) < 1e-12 ? 1 : 0;
          case "gestep": return callCore("GESTEP", [x, y]) as number | SolError;
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

  data(inputs: { x?: number[][]; y?: number[][] }) {
    const xs = inputs.x?.[0] ?? null;
    const ys = inputs.y?.[0] ?? null;
    let result: number | null = null;
    if (xs && ys && xs.length > 0 && ys.length > 0) {
      const n = Math.min(xs.length, ys.length);
      result = callCore(this.op.toUpperCase(), [xs.slice(0, n), ys.slice(0, n)]) as number;
    }
    this.cachedResult = result;
    return { result };
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

  data(inputs: { x?: number[]; n?: number[]; m?: number[]; coef?: number[][] }) {
    const x = readInput(inputs.x, this.literals.x ?? 1);
    const n = readInput(inputs.n, this.literals.n ?? 0);
    const m = readInput(inputs.m, this.literals.m ?? 1);
    if (x === null || n === null || m === null) { this.cachedResult = null; return { result: null }; }
    const coef = inputs.coef?.[0] ?? null;
    if (!coef || coef.length === 0) { this.cachedResult = null; return { result: null }; }
    const result = callCore("SERIESSUM", [x, n, m, coef]) as number;
    this.cachedResult = guardFinite(result, [x, n, m, ...coef]);
    return { result: this.cachedResult };
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

  data(inputs: { values?: number[][] }) {
    const vals = inputs.values?.[0] ?? null;
    if (!vals || vals.length === 0) { this.cachedResult = null; return { result: null }; }
    const ns = vals.map(Math.round);
    if (ns.some(v => v < 0)) { this.cachedResult = null; return { result: null }; }
    const total = ns.reduce((s, v) => s + v, 0);
    const lnResult = lnGamma(total + 1) - ns.reduce((s, v) => s + lnGamma(v + 1), 0);
    const result = Math.round(Math.exp(lnResult));
    this.cachedResult = guardFinite(result, vals);
    return { result: this.cachedResult };
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
    const nRaw = readRole<number>(this, "n", inputs.n);
    if (x === null) { this.cachedResult = null; return { result: null }; }
    const n = Math.max(0, Math.round(nRaw));
    const result = callCore(this.op.toUpperCase(), [x, n]);
    if (typeof result !== "number" || !Number.isFinite(result)) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = result;
    return { result };
  }
}

