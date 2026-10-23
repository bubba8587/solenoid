// [[C45]] excelComparisons
import { isSolError, type SolError } from "./errorValue";
import { parseDate } from "./nodes/dateSerial";
import { compareStrings } from "./stringOrder";
import { decimalFromText } from "./valueKinds";

export type CriterionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export interface Criterion {
  op: CriterionOp;
  value: number | boolean | string | null;
  wild?: RegExp;
}

const PREFIX: Array<[string, CriterionOp]> = [["<>", "neq"], [">=", "gte"], ["<=", "lte"], ["=", "eq"], [">", "gt"], ["<", "lt"]];

/** Excel's wildcards as a regex source: `?` one character, `*` any run, `~` takes the next character literally. */
export function wildcardSource(pattern: string): { source: string; hasWild: boolean } {
  let source = "", hasWild = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) { source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i++; continue; }
    if (ch === "*") { source += "[\\s\\S]*"; hasWild = true; continue; }
    if (ch === "?") { source += "[\\s\\S]"; hasWild = true; continue; }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return { source, hasWild };
}

function wildcardToRegex(pattern: string): RegExp | null {
  const { source, hasWild } = wildcardSource(pattern);
  return hasWild ? new RegExp(`^${source}$`, "i") : null;
}

const unescape = (s: string) => s.replace(/~(.)/g, "$1");

export function parseCriterion(raw: unknown, numericRange: boolean): Criterion | SolError {
  if (raw === null || raw === undefined) return { op: "eq", value: null };
  if (typeof raw === "number") return { op: "eq", value: raw };
  if (typeof raw === "boolean") return { op: "eq", value: raw };
  if (isSolError(raw)) return raw;
  const text = String(raw);
  let op: CriterionOp = "eq", rest = text;
  for (const [p, o] of PREFIX) if (text.startsWith(p)) { op = o; rest = text.slice(p.length); break; }
  if (rest === "") return { op, value: null };
  if (rest === "TRUE" || rest === "FALSE") return { op, value: rest === "TRUE" };
  if (numericRange) {
    const n = decimalFromText(rest);
    if (Number.isFinite(n)) return { op, value: n };
    const d = parseDate(rest);
    if (isSolError(d)) return d.code === "#AMBIGUOUS!" ? d : { op, value: unescape(rest) };
    if (Number.isFinite(d)) return { op, value: d };
  }
  const wild = op === "eq" || op === "neq" ? wildcardToRegex(rest) : null;
  return { op, value: unescape(rest), ...(wild ? { wild } : {}) };
}

function cmp(op: CriterionOp, c: number): boolean {
  switch (op) {
    case "eq": return c === 0;
    case "neq": return c !== 0;
    case "gt": return c > 0;
    case "gte": return c >= 0;
    case "lt": return c < 0;
    case "lte": return c <= 0;
  }
}

export function criterionMatches(cell: unknown, crit: Criterion): boolean {
  if (isSolError(cell)) return false;
  const blank = cell === null || cell === undefined || cell === "";
  if (crit.value === null) return crit.op === "neq" ? !blank : blank;
  if (blank) return crit.op === "neq";
  if (typeof crit.value === "boolean") return typeof cell === "boolean" && cmp(crit.op, Number(cell) - Number(crit.value));
  if (typeof crit.value === "number") {
    if (typeof cell === "boolean") return false;
    return typeof cell === "number" ? cmp(crit.op, cell - crit.value) : crit.op === "neq";
  }
  if (typeof cell !== "string") return crit.op === "neq";
  if (crit.wild) { const hit = crit.wild.test(cell); return crit.op === "eq" ? hit : !hit; }
  const a = cell.toLowerCase(), b = crit.value.toLowerCase();
  if (crit.op === "eq") return a === b;
  if (crit.op === "neq") return a !== b;
  return cmp(crit.op, compareStrings(a, b));
}

export type CriteriaKind = "sum" | "count" | "average" | "min" | "max";

