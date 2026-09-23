// [[C47]]
import { parseFormula, compileEvaluator, type Ast, type ExprEvaluator } from "./excelFormula";
import { solError, type SolError } from "./errorValue";

export interface ParsedEquation {
  lhs: Ast;
  rhs: Ast;
  lhsText: string;
  rhsText: string;
}

function containsEquals(n: Ast): boolean {
  switch (n.t) {
    case "bin": return n.op === "=" || containsEquals(n.l) || containsEquals(n.r);
    case "call": return n.args.some(containsEquals);
    case "apply": return containsEquals(n.fn) || n.args.some(containsEquals);
    case "unary": case "percent": return containsEquals(n.arg);
    default: return false;
  }
}

/** Null on a syntax error; a string answer is a readable shape problem. */
export function parseEquation(expr: string): ParsedEquation | string | null {
  const root = parseFormula(expr);
  if (!root) return null;
  if (root.t !== "bin" || root.op !== "=") return "An equation needs one = sign, like V = I * R";
  if (containsEquals(root.l) || containsEquals(root.r)) return "Use exactly one = sign";
  return { lhs: root.l, rhs: root.r, lhsText: astToFormula(root.l), rhsText: astToFormula(root.r) };
}

export function countOccurrences(n: Ast, name: string): number {
  switch (n.t) {
    case "name": return n.name === name ? 1 : 0;
    case "bin": return countOccurrences(n.l, name) + countOccurrences(n.r, name);
    case "call": return n.args.reduce((s, a) => s + countOccurrences(a, name), 0);
    case "apply": return countOccurrences(n.fn, name) + n.args.reduce((s, a) => s + countOccurrences(a, name), 0);
    case "unary": case "percent": return countOccurrences(n.arg, name);
    default: return 0;
  }
}

export function astToFormula(n: Ast): string {
  switch (n.t) {
    case "num": return n.v;
    case "blank": return "";
    case "atcol": return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.name) ? `@${n.name}` : `@[${n.name}]`;
    case "wholecol": return `[${n.name}]`;
    case "str": return `"${n.v}"`;
    case "bool": return n.v ? "TRUE()" : "FALSE()";
    case "name": return n.name;
    case "call": return `${n.name}(${n.args.map(astToFormula).join(",")})`;
    case "apply": return `(${astToFormula(n.fn)})(${n.args.map(astToFormula).join(",")})`;
    case "unary": return `(${n.op}${astToFormula(n.arg)})`;
    case "percent": return `((${astToFormula(n.arg)})/100)`;
    case "bin": return `(${astToFormula(n.l)}${n.op}${astToFormula(n.r)})`;
  }
}

const bin = (op: string, l: Ast, r: Ast): Ast => ({ t: "bin", op, l, r });
const call = (name: string, ...args: Ast[]): Ast => ({ t: "call", name, args });
const num = (v: number): Ast => ({ t: "num", v: String(v) });

const CALL_INVERSE: Record<string, (o: Ast) => Ast> = {
  SQRT: (o) => bin("^", o, num(2)),
  EXP: (o) => call("LN", o),
  LN: (o) => call("EXP", o),
  LOG10: (o) => bin("^", num(10), o),
  SIN: (o) => call("ASIN", o),
  COS: (o) => call("ACOS", o),
  TAN: (o) => call("ATAN", o),
  ASIN: (o) => call("SIN", o),
  ACOS: (o) => call("COS", o),
  ATAN: (o) => call("TAN", o),
  SINH: (o) => call("ASINH", o),
  COSH: (o) => call("ACOSH", o),
  TANH: (o) => call("ATANH", o),
  ASINH: (o) => call("SINH", o),
  ACOSH: (o) => call("COSH", o),
  ATANH: (o) => call("TANH", o),
  DEGREES: (o) => call("RADIANS", o),
  RADIANS: (o) => call("DEGREES", o),
};

/** The unknown must appear exactly once in `side`; the caller checks that. */
export function isolate(side: Ast, other: Ast, unknown: string): Ast | null {
  let s = side;
  let o = other;
  for (;;) {
    switch (s.t) {
      case "name":
        return s.name === unknown ? o : null;
      case "unary":
        if (countOccurrences(s.arg, unknown) === 0) return null;
        if (s.op === "-") o = { t: "unary", op: "-", arg: o };
        s = s.arg;
        continue;
      case "percent":
        o = bin("*", o, num(100));
        s = s.arg;
        continue;
      case "bin": {
        const inL = countOccurrences(s.l, unknown) > 0;
        const sub = inL ? s.l : s.r;
        const oth = inL ? s.r : s.l;
        switch (s.op) {
          case "+": o = bin("-", o, oth); break;
          case "*": o = bin("/", o, oth); break;
          case "-": o = inL ? bin("+", o, oth) : bin("-", oth, o); break;
          case "/": o = inL ? bin("*", o, oth) : bin("/", oth, o); break;
          case "^":
            o = inL ? bin("^", o, bin("/", num(1), oth)) : bin("/", call("LN", o), call("LN", oth));
            break;
          default:
            return null;
        }
        s = sub;
        continue;
      }
      case "call": {
        if (s.name.toUpperCase() === "POWER" && s.args.length === 2) {
          const inBase = countOccurrences(s.args[0], unknown) > 0;
          o = inBase
            ? bin("^", o, bin("/", num(1), s.args[1]))
            : bin("/", call("LN", o), call("LN", s.args[0]));
          s = inBase ? s.args[0] : s.args[1];
          continue;
        }
        if (s.name.toUpperCase() === "LOG") {
          const base: Ast = s.args[1] ?? num(10);
          const inArg = s.args.length < 2 || countOccurrences(s.args[0], unknown) > 0;
          if (inArg) {
            o = bin("^", base, o);
            s = s.args[0];
          } else {
            o = bin("^", s.args[0], bin("/", num(1), o));
            s = s.args[1];
          }
          continue;
        }
        if (s.args.length === 1) {
          const inv = CALL_INVERSE[s.name.toUpperCase()];
          if (!inv) return null;
          o = inv(o);
          s = s.args[0];
          continue;
        }
        return null;
      }
      default:
        return null;
    }
  }
}

export function compileSolver(eq: ParsedEquation, unknown: string): ExprEvaluator | null {
  const inL = countOccurrences(eq.lhs, unknown);
  const inR = countOccurrences(eq.rhs, unknown);
  if (inL + inR !== 1) return null;
  const iso = inL === 1 ? isolate(eq.lhs, eq.rhs, unknown) : isolate(eq.rhs, eq.lhs, unknown);
  if (!iso) return null;
  return compileEvaluator(astToFormula(iso));
}


export interface QuadraticFit { a: number; b: number; c: number }

export function sniffQuadratic(residual: (x: number) => number | null): QuadraticFit | null {
  const probe = (x: number): number | null => {
    const f = residual(x);
    return f !== null && Number.isFinite(f) ? f : null;
  };
  const f0 = probe(0), f1 = probe(1), fm1 = probe(-1);
  if (f0 === null || f1 === null || fm1 === null) return null;
  const a = (f1 + fm1 - 2 * f0) / 2;
  const b = (f1 - fm1) / 2;
  const c = f0;
  for (const x of [2.5, -3.75, 17, -41.5]) {
    const fx = probe(x);
    if (fx === null) return null;
    const pred = (a * x + b) * x + c;
    const scale = Math.max(1, Math.abs(fx), Math.abs(pred), Math.abs(a * x * x), Math.abs(b * x), Math.abs(c));
    if (Math.abs(fx - pred) > 1e-9 * scale) return null;
  }
  return { a, b, c };
}

export function solveQuadratic(q: QuadraticFit): number | number[] | SolError | null {
  const { a, b, c } = q;
  const cscale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (cscale === 0 || Math.abs(a) <= 1e-12 * cscale) return null;
  const disc = b * b - 4 * a * c;
  const dscale = Math.max(b * b, Math.abs(4 * a * c));
  if (Math.abs(disc) <= 1e-12 * dscale) return -b / (2 * a);
  if (disc < 0) {
    return solError("#SOLVE!", "No real solution: the quadratic's discriminant is negative");
  }
  const s = Math.sqrt(disc);
  const qq = -(b + Math.sign(b || 1) * s) / 2;
  const r1 = qq / a;
  const r2 = c / qq;
  return r1 < r2 ? [r1, r2] : [r2, r1];
}

export function solveNumeric(residual: (x: number) => number | null): number | SolError {
  const grid: number[] = [0];
  for (let k = -6; k <= 12; k++) {
    grid.push(10 ** k, -(10 ** k));
  }
  grid.sort((a, b) => a - b);

  let best: number | null = null;
  const consider = (root: number) => {
    if (best === null || Math.abs(root) < Math.abs(best)) best = root;
  };
  const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);
  // A pole changes sign too (1/(x-3) at 3), so a converged point counts only when its residual is small.
  const bisect = (lo: number, hi: number, flo: number, fhi: number): number | null => {
    let l = lo, h = hi, fl = flo;
    for (let i = 0; i < 200; i++) {
      const mid = (l + h) / 2;
      const fm = residual(mid);
      if (!finite(fm)) return null;
      if (fm === 0) return mid;
      if (Math.sign(fm) === Math.sign(fl)) { l = mid; fl = fm; } else h = mid;
      if (h - l <= 1e-12 * Math.max(1, Math.abs(l), Math.abs(h))) break;
    }
    const mid = (l + h) / 2;
    const fm = residual(mid);
    if (!finite(fm)) return null;
    const scale = Math.max(1, Math.abs(flo), Math.abs(fhi));
    return Math.abs(fm) <= 1e-6 * scale ? mid : null;
  };
  /** The last finite point between a finite end and a non-finite end, found by bisection. */
  const domainEdge = (inside: number, outside: number): { x: number; f: number } | null => {
    let i = inside, o = outside;
    for (let k = 0; k < 100; k++) {
      const mid = (i + o) / 2;
      if (finite(residual(mid))) i = mid; else o = mid;
    }
    const f = residual(i);
    return finite(f) ? { x: i, f } : null;
  };
  let prevX: number | null = null;
  let prevF: number | null = null;
  for (const x of grid) {
    const f = residual(x);
    if (!finite(f)) {
      if (prevX !== null && prevF !== null && prevF !== 0) {
        const edge = domainEdge(prevX, x);
        if (edge && edge.f === 0) consider(edge.x);
        else if (edge && Math.sign(edge.f) !== Math.sign(prevF)) {
          const r = bisect(prevX, edge.x, prevF, edge.f);
          if (r !== null) consider(r);
        }
      }
      prevX = x; prevF = null; continue;
    }
    if (f === 0) { consider(x); prevX = x; prevF = f; continue; }
    if (prevX !== null && prevF === null) {
      const edge = domainEdge(x, prevX);
      if (edge && edge.f !== 0 && Math.sign(edge.f) !== Math.sign(f)) {
        const r = bisect(edge.x, x, edge.f, f);
        if (r !== null) consider(r);
      } else if (edge && edge.f === 0) consider(edge.x);
    } else if (prevX !== null && prevF !== null && Math.sign(f) !== Math.sign(prevF)) {
      const r = bisect(prevX, x, prevF, f);
      if (r !== null) consider(r);
    }
    prevX = x; prevF = f;
  }
  if (best !== null) return best;
  return solError("#SOLVE!", "No solution found between \u00b110\u00b9\u00b2. The equation may have no real root here");
}

export function equalsWithin(l: number, r: number): boolean {
  return Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
}
