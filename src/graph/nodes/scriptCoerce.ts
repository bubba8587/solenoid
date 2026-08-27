// Folds a script's return value onto the value model. Nothing leaves the Script node
// that is not already a Solenoid value: per cell, a wrong family is #TYPE! (families
// never auto-cross, noAutoCross; the logical→number bridge is the one exception), a
// non-number is #DOMAIN!, an unsupported object is #TYPE!; at the top, a shape that is
// neither a value, a list, nor rows of values is #SHAPE!.
import { solError, isSolError } from "../errorValue";
import { jsDateToSerial } from "./dateSerial";
import { isCx } from "../cxValue";
import type { ResultType } from "./shared";

const EXPECTS: Record<ResultType, string> = { number: "a number", text: "text", date: "a date", auto: "a value" };

function describe(v: unknown): string {
  if (typeof v === "object" && v !== null && "__unclonable" in v) {
    const k = (v as { __unclonable: string }).__unclonable;
    return k === "function" ? "a function" : k === "symbol" ? "a symbol" : `a ${k}`;
  }
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

function wrong(v: unknown, t: ResultType, hint?: string): unknown {
  return solError("#TYPE!", `Returned ${describe(v)} where ${EXPECTS[t]} was expected${hint ? `; ${hint}` : ""}`);
}

export function coerceScriptCell(c: unknown, t: ResultType): unknown {
  if (c === null || c === undefined) return null;
  if (isSolError(c)) return c;
  if (typeof c === "bigint") {
    if (c > BigInt(Number.MAX_SAFE_INTEGER) || c < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return solError("#OVERFLOW!", "The result is too large to represent exactly");
    }
    c = Number(c);
  }
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return solError("#DOMAIN!", "The result is an invalid date");
    return t === "date" || t === "auto" ? jsDateToSerial(c) : solError("#TYPE!", `Returned a date where ${EXPECTS[t]} was expected`);
  }
  if (typeof c === "number") {
    if (Number.isNaN(c)) return solError("#DOMAIN!", "The result is not a number");
    return t === "text" ? solError("#TYPE!", "Returned a number where text was expected; use String()") : c;
  }
  if (typeof c === "boolean") {
    if (t === "number") return c ? 1 : 0;
    return t === "auto" ? c : solError("#TYPE!", `Returned a boolean where ${EXPECTS[t]} was expected`);
  }
  if (typeof c === "string") {
    if (t === "text" || t === "auto") return c;
    return solError("#TYPE!", `Returned text where ${EXPECTS[t]} was expected${t === "number" ? "; use Number()" : ""}`);
  }
  if (isCx(c)) return t === "auto" ? c : solError("#TYPE!", `Returned a complex number where ${EXPECTS[t]} was expected`);
  return wrong(c, t, "return numbers, text, booleans, dates, or lists of them");
}

/** The whole return value: a scalar, a list, or rows of values (padded with null when
 *  ragged, as every broadcaster pads). Anything deeper or mixed is #SHAPE!. */
export function coerceScriptResult(v: unknown, t: ResultType): unknown {
  if (!Array.isArray(v)) return coerceScriptCell(v, t);
  if (v.length === 0) return [];
  const rows = v.filter(Array.isArray).length;
  if (rows === 0) return v.map((c) => coerceScriptCell(c, t));
  if (rows !== v.length) return solError("#SHAPE!", "Returned values mixed with rows; return a list, or a list of rows");
  const width = Math.max(...(v as unknown[][]).map((r) => r.length));
  const out: unknown[][] = [];
  for (const row of v as unknown[][]) {
    if (row.some(Array.isArray)) return solError("#SHAPE!", "Returned rows nested deeper than a table; return a list of rows");
    const cells = row.map((c) => coerceScriptCell(c, t));
    while (cells.length < width) cells.push(null);
    out.push(cells);
  }
  return out;
}
