// [[C45]] excelComparisons
import { solError, isSolError, type SolError } from "./errorValue";
import { parseDate } from "./nodes/dateSerial";
import { compareStrings } from "./stringOrder";

export type CriterionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export interface Criterion {
  op: CriterionOp;
  value: number | boolean | string | null;
  wild?: RegExp;
}

const PREFIX: Array<[string, CriterionOp]> = [["<>", "neq"], [">=", "gte"], ["<=", "lte"], ["=", "eq"], [">", "gt"], ["<", "lt"]];

function wildcardToRegex(pattern: string): RegExp | null {
  let re = "", hasWild = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) { re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i++; continue; }
    if (ch === "*") { re += ".*"; hasWild = true; continue; }
    if (ch === "?") { re += "."; hasWild = true; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return hasWild ? new RegExp(`^${re}$`, "i") : null;
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
  const n = Number(rest);
  if (rest.trim() !== "" && Number.isFinite(n)) return { op, value: n };
  if (numericRange) {
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
    if (typeof cell === "number") return cmp(crit.op, cell - crit.value);
    if (typeof cell === "boolean") return false;
    const asNum = Number(cell);
    return typeof cell === "string" && cell.trim() !== "" && Number.isFinite(asNum) ? cmp(crit.op, asNum - crit.value) : crit.op === "neq";
  }
  if (typeof cell !== "string") return crit.op === "neq";
  if (crit.wild) { const hit = crit.wild.test(cell); return crit.op === "eq" ? hit : !hit; }
  const a = cell.toLowerCase(), b = crit.value.toLowerCase();
  if (crit.op === "eq") return a === b;
  if (crit.op === "neq") return a !== b;
  return cmp(crit.op, compareStrings(a, b));
}

export type CriteriaKind = "sum" | "count" | "average" | "min" | "max";

export function criteriaAggregate(kind: CriteriaKind, values: readonly unknown[] | null, pairs: ReadonlyArray<[readonly unknown[], unknown]>): number | SolError | null {
  if (pairs.length === 0) return solError("#VALUE!", "At least one criteria range and criterion is needed");
  const crits: Criterion[] = [];
  for (const [range, raw] of pairs) {
    const numeric = range.some((v) => typeof v === "number") && !range.some((v) => typeof v === "string" && v !== "");
    const c = parseCriterion(raw, numeric);
    if (isSolError(c)) return c;
    crits.push(c);
  }
  let n = pairs.reduce((m, [r]) => Math.min(m, r.length), Infinity);
  if (values) n = Math.min(n, values.length);
  const kept: number[] = [];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!pairs.every(([r], k) => criterionMatches(r[i], crits[k]))) continue;
    count++;
    if (!values) continue;
    const v = values[i];
    if (isSolError(v)) return v;
    if (typeof v === "number" && Number.isFinite(v)) kept.push(v);
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) kept.push(Number(v));
  }
  switch (kind) {
    case "count": return count;
    case "sum": return kept.reduce((a, b) => a + b, 0);
    case "average": return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : solError("#DIV/0!", "No rows matched the criteria");
    case "min": return kept.length ? kept.reduce((a, b) => Math.min(a, b)) : 0;
    case "max": return kept.length ? kept.reduce((a, b) => Math.max(a, b)) : 0;
  }
}
