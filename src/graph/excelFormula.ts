// [[C22]], [[C80]], [[D99]] rustIsSpec
import { isFunctionName } from "./excelFunctions";
import { formatScalar } from "./components/format";
import { emptySlotReading } from "./emptySlots";
import { evaluateOnCore, callOnCore, toWellFormed } from "./coreValues";
import { wasmInvokeSync, onCore } from "./engineWasm";

// ─── AST ────────────────────────────────────────────────────────────────────
export type Ast =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "name"; name: string }
  | { t: "call"; name: string; args: Ast[] }
  | { t: "apply"; fn: Ast; args: Ast[] }
  | { t: "unary"; op: "-" | "+"; arg: Ast }
  | { t: "percent"; arg: Ast }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "blank" }
  | { t: "atcol"; name: string }
  | { t: "wholecol"; name: string };

const IDENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Parsing ──────────────────────────────────────────────────────────────────
/** The formula's tree, as the core parses it ([[D99]] rustIsSpec); null where it doesn't parse. */
function parseExpr(expr: string): Ast | null {
  if (!expr.trim()) return null;
  return onCore(() => wasmInvokeSync<Ast | null>("engine_formula_parse", { expr: toWellFormed(expr) }), null);
}

export function parseFormula(expr: string): Ast | null {
  return parseExpr(expr);
}

export function formulaSyntaxHint(expr: string): string | null {
  const s = expr.replace(/"[^"]*"?/g, '""').trim();
  if (/[{}]/.test(s)) return "Braces { } aren't formula syntax. Remove them: array literals aren't supported, so wire a List or Table input instead";
  if (s.startsWith("=")) return "Drop the leading =, and type just the formula body";
  if (/;/.test(s)) return "Separate arguments with commas, not semicolons";
  const openB = (s.match(/\[/g) ?? []).length;
  const closeB = (s.match(/\]/g) ?? []).length;
  if (openB !== closeB) return "Unclosed [. A whole column is [Name], and this row's cell is @[Name]";
  const bare = s.replace(/\[@\[[^\]]*\]\]|\[[^\]]*\]/g, "[]");
  const open = (bare.match(/\(/g) ?? []).length;
  const close = (bare.match(/\)/g) ?? []).length;
  if (open > close) return `Missing ${open - close} closing parenthesis${open - close === 1 ? "" : "es"}`;
  if (close > open) return `${close - open} extra closing parenthesis${close - open === 1 ? "" : "es"}`;
  let depth = 0;
  for (const ch of bare) if ((depth += ch === "(" ? 1 : ch === ")" ? -1 : 0) < 0) return "A ) comes before the ( it would close";
  if (/[+\-*/^&,<>=]$/.test(s)) return "The formula ends mid-expression (trailing operator)";
  return null;
}

export const FORMULA_CONSTANTS: Record<string, number> = {
  pi:  Math.PI,
  tau: 2 * Math.PI,
  e:   Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};
function constantValue(name: string): number | undefined {
  return FORMULA_CONSTANTS[name.toLowerCase()];
}
export const isFormulaConstant = (name: string): boolean => constantValue(name) !== undefined;

// ─── Variable extraction ──────────────────────────────────────────────────────
/** The LAMBDA hosts, whose bare function-name argument is that function as a LAMBDA, not a variable. */
const ETA_HOSTS = new Set(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"]);
const isEtaName = (a: Ast): boolean =>
  a.t === "name" && constantValue(a.name) === undefined && isFunctionName(a.name);

function collectNames(n: Ast, out: string[], seen: Set<string>, bound: ReadonlySet<string> = new Set()): void {
  switch (n.t) {
    case "name":
      if (constantValue(n.name) === undefined && !bound.has(n.name) && !seen.has(n.name)) { seen.add(n.name); out.push(n.name); }
      break;
    case "call": {
      if (n.name.toUpperCase() === "LAMBDA" && n.args.length >= 1) {
        const inner = new Set(bound);
        for (const a of n.args.slice(0, -1)) if (a.t === "name") inner.add(a.name);
        collectNames(n.args[n.args.length - 1], out, seen, inner);
        break;
      }
      const eta = ETA_HOSTS.has(n.name.toUpperCase());
      n.args.forEach((a) => { if (!(eta && isEtaName(a))) collectNames(a, out, seen, bound); });
      break;
    }
    case "apply":
      collectNames(n.fn, out, seen, bound);
      n.args.forEach((a) => { if (!isEtaName(a)) collectNames(a, out, seen, bound); });
      break;
    case "unary": case "percent": collectNames(n.arg, out, seen, bound); break;
    case "bin": collectNames(n.l, out, seen, bound); collectNames(n.r, out, seen, bound); break;
  }
}

export function extractVariables(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out: string[] = [];
  collectNames(ast, out, new Set());
  return out;
}

function collectRowRefs(n: Ast, out: Set<string>, bound: ReadonlySet<string> = new Set()): void {
  switch (n.t) {
    case "atcol": if (!bound.has(n.name)) out.add(n.name); break;
    case "wholecol": if (!bound.has(n.name)) out.add(n.name); break;
    case "call": {
      if (n.name.toUpperCase() === "LAMBDA" && n.args.length >= 1) {
        const inner = new Set(bound);
        for (const a of n.args.slice(0, -1)) if (a.t === "name") inner.add(a.name);
        collectRowRefs(n.args[n.args.length - 1], out, inner);
        break;
      }
      n.args.forEach((a) => collectRowRefs(a, out, bound));
      break;
    }
    case "apply": collectRowRefs(n.fn, out, bound); n.args.forEach((a) => collectRowRefs(a, out, bound)); break;
    case "unary": case "percent": collectRowRefs(n.arg, out, bound); break;
    case "bin": collectRowRefs(n.l, out, bound); collectRowRefs(n.r, out, bound); break;
  }
}

export function rowRefNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  collectRowRefs(ast, out);
  return [...out];
}

export function atColNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.t) {
      case "atcol": if (IDENT_NAME.test(n.name)) out.add(n.name); break;
      case "call": n.args.forEach(walk); break;
      case "apply": walk(n.fn); n.args.forEach(walk); break;
      case "unary": case "percent": walk(n.arg); break;
      case "bin": walk(n.l); walk(n.r); break;
    }
  };
  walk(ast);
  return [...out];
}

export type ExprEvaluator = (env: Record<string, unknown>) => unknown;

/** A formula over named values, on the Rust core ([[D99]] rustIsSpec); null where it doesn't parse. */
export function compileEvaluator(expr: string): ExprEvaluator | null {
  if (!parseExpr(expr)) return null;
  return (env) => evaluateOnCore(expr, env);
}

export function compilePositional(
  expr: string,
  paramNames: string[],
): ((...args: unknown[]) => unknown) | null {
  const evaluate = compileEvaluator(expr);
  if (!evaluate) return null;
  return (...args: unknown[]) => {
    const env: Record<string, unknown> = {};
    for (let i = 0; i < paramNames.length; i++) env[paramNames[i]] = args[i];
    return evaluate(env);
  };
}

// ─── LaTeX (AST → KaTeX) ──────────────────────────────────────────────────────
const GREEK = new Set([
  "alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa",
  "lambda","mu","nu","xi","rho","sigma","tau","phi","chi","psi","omega","pi",
]);

function symbolLatex(name: string): string {
  let base = name, sub = "";
  const us = name.indexOf("_");
  if (us >= 0) { base = name.slice(0, us); sub = name.slice(us + 1); }
  else { const m = name.match(/^([A-Za-z]+)(\d+)$/); if (m) { base = m[1]; sub = m[2]; } }
  const low = base.toLowerCase();
  let b: string;
  if (GREEK.has(low)) b = low === "phi" ? "\\varphi" : `\\${low}`;
  else if (base.length > 1) b = `\\mathrm{${base}}`;
  else b = base;
  return sub ? `${b}_{${sub.length > 1 ? `{${sub}}` : sub}}` : b;
}

function numLatex(v: string): string {
  const m = v.match(/^([0-9.]+)[eE]([+-]?\d+)$/);
  if (m) {
    const mant = m[1] === "1" ? "" : `${m[1]} \\times `;
    return `${mant}10^{${parseInt(m[2], 10)}}`;
  }
  return v;
}

// KaTeX's own operator names: the arc functions are \arcsin, never \asin.
const TRIG_TEX: Record<string, string> = {
  SIN: "\\sin", COS: "\\cos", TAN: "\\tan",
  SINH: "\\sinh", COSH: "\\cosh", TANH: "\\tanh",
  ASIN: "\\arcsin", ACOS: "\\arccos", ATAN: "\\arctan",
};
const CMP_TEX: Record<string, string> = { "=": "=", "<>": "\\ne", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" };

/** Text escaped for KaTeX's text mode. */
function texText(s: string): string {
  return s.replace(/[\\{}$&#%_^~]/g, (c) => {
    switch (c) {
      case "\\": return "\\textbackslash{}";
      case "^":  return "\\textasciicircum{}";
      case "~":  return "\\textasciitilde{}";
      default:   return `\\${c}`;
    }
  });
}

/** KaTeX has no `\textquotedbl`, so the quotes stay literal inside `\text{}`. */
function texString(s: string): string {
  return `\\text{"${texText(s)}"}`;
}

// prec: cmp=1, concat=2, add=3, mul=4, exp=5, unary=6, atom=7.
function tex(n: Ast, parent: number): string {
  const wrap = (s: string, prec: number) => (parent > prec ? `\\left(${s}\\right)` : s);
  switch (n.t) {
    case "num": return numLatex(n.v);
    case "blank": return "\\varnothing";
    case "atcol": return `\\text{@${IDENT_NAME.test(n.name) ? n.name : `[${n.name}]`}}`;
    case "wholecol": return `\\text{[${n.name}]}`;
    case "str": return texString(n.v);
    case "bool": return `\\mathrm{${n.v ? "TRUE" : "FALSE"}}`;
    case "name": return symbolLatex(n.name);
    case "unary": return wrap(`${n.op === "-" ? "-" : ""}${tex(n.arg, 6)}`, 6);
    case "percent": return wrap(`${tex(n.arg, 6)}\\%`, 6);
    case "apply":
      return wrap(`${tex(n.fn, 7)}\\left(${n.args.map((x) => tex(x, 0)).join(", ")}\\right)`, 7);
    case "call": {
      const name = n.name.toUpperCase();
      // An empty slot shows the value it reads as, muted ([[D96]] emptySlotShowsItsValue).
      const arg = (i: number, prec: number): string => {
        const x = n.args[i];
        if (x.t !== "blank") return tex(x, prec);
        const shown = emptySlotReading(name, i).shown;
        return shown === null ? "\\," : `\\textcolor{gray}{\\textit{${texText(shown)}}}`;
      };
      const all = (sep: string) => n.args.map((_, i) => arg(i, 0)).join(sep);
      const a = n.args;
      if (name === "SQRT" && a[0]) return `\\sqrt{${arg(0, 0)}}`;
      if (name === "ABS" && a[0]) return `\\left|${arg(0, 0)}\\right|`;
      if (name === "POWER" && a[1]) return wrap(`${arg(0, 5)}^{${arg(1, 0)}}`, 5);
      if (name === "EXP" && a[0]) return wrap(`e^{${arg(0, 0)}}`, 5);
      if (name === "PI" && a.length === 0) return "\\pi";
      if (name === "LN") return `\\ln\\!\\left(${all(",\\, ")}\\right)`;
      if ((name === "LOG10" || name === "LOG") && a.length <= 1) return `\\log\\!\\left(${all("")}\\right)`;
      const fn = TRIG_TEX[name] ?? `\\operatorname{${name}}`;
      return `${fn}\\!\\left(${all(",\\, ")}\\right)`;
    }
    case "bin": {
      if (n.op === "/") return `\\frac{${tex(n.l, 0)}}{${tex(n.r, 0)}}`;
      if (n.op === "^") return wrap(`${tex(n.l, 5)}^{${tex(n.r, 0)}}`, 5);
      if (n.op === "*") return wrap(`${tex(n.l, 4)} \\cdot ${tex(n.r, 4)}`, 4);
      if (n.op === "&") return wrap(`${tex(n.l, 2)}\\mathbin{\\&}${tex(n.r, 2)}`, 2);
      if (n.op in CMP_TEX) return wrap(`${tex(n.l, 1)} ${CMP_TEX[n.op]} ${tex(n.r, 1)}`, 1);
      const right = tex(n.r, n.op === "-" ? 4 : 3);
      return wrap(`${tex(n.l, 3)} ${n.op} ${right}`, 3);
    }
  }
}

export function formulaToLatex(expr: string): string | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  try {
    return tex(ast, 0);
  } catch {
    return null;
  }
}

/** `f(params) = body`, the head's parameters written as the body writes them; null when the body does not parse. */
export function lambdaToLatex(params: readonly string[], expr: string): string | null {
  const body = formulaToLatex(expr);
  return body === null ? null : `f(${params.map(symbolLatex).join(",\\,")}) = ${body}`;
}

// ─── Step-by-step evaluation ─────────────────────────────────────────────────

// A step shows its numbers as every unformatted number shows ([[D94]] oneNumberDisplay).
const cleanNum = (v: number): string => (Number.isFinite(v) ? formatScalar(v) : String(v));

function applyBin(op: string, l: number, r: number): number {
  switch (op) {
    case "+": return l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/": return l / r;
    case "^": return Math.pow(l, r);
    case "=": return l === r ? 1 : 0;
    case "<>": return l !== r ? 1 : 0;
    case "<": return l < r ? 1 : 0;
    case ">": return l > r ? 1 : 0;
    case "<=": return l <= r ? 1 : 0;
    case ">=": return l >= r ? 1 : 0;
    default: return NaN;
  }
}

export type FormulaStep = { latex: string };

export function evaluateSteps(expr: string, vars: Record<string, number>): { steps: FormulaStep[]; value: number } | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  const steps: FormulaStep[] = [];
  const seen = new Set<string>();
  const num = (v: number): Ast => ({ t: "num", v: cleanNum(v) });
  let ok = true;

  const emit = (exprAst: Ast, value: number) => {
    const key = tex(exprAst, 0);
    if (seen.has(key)) return;
    seen.add(key);
    steps.push({ latex: `${key} = ${numLatex(cleanNum(value))}` });
  };

  const ev = (n: Ast): number => {
    switch (n.t) {
      case "num": return parseFloat(n.v);
      case "blank": return 0;
      case "name": { const c = constantValue(n.name); return c !== undefined ? c : (vars[n.name] ?? 0); }
      case "bool": return n.v ? 1 : 0;
      case "str": ok = false; return NaN;
      case "atcol": { ok = false; return NaN; }
      case "wholecol": { ok = false; return NaN; }
      case "unary": { const a = ev(n.arg); return n.op === "-" ? -a : a; }
      case "percent": return ev(n.arg) / 100;
      case "apply": { ok = false; return NaN; }
      case "call": {
        const argv = n.args.map(ev);
        let value: number;
        const r = callOnCore(n.name.toUpperCase(), argv);
        if (typeof r === "number") value = r;
        else { ok = false; value = NaN; }
        emit({ t: "call", name: n.name, args: argv.map(num) }, value);
        return value;
      }
      case "bin": {
        const l = ev(n.l), r = ev(n.r);
        if (n.op === "&") ok = false;
        const value = applyBin(n.op, l, r);
        emit({ t: "bin", op: n.op, l: num(l), r: num(r) }, value);
        return value;
      }
    }
  };

  const value = ev(ast);
  if (!ok || !Number.isFinite(value) || steps.length === 0) return null;
  return { steps, value };
}
