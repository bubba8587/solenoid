// [[C47]]
import { parseFormula, type Ast } from "./excelFormula";

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
