import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXCEL_IMPL_META } from "./excelFunctions";

// ─── FX-11 — a node must not offer LESS than the formula surface it dispatches to ──
//
// The two surfaces (a NODE's data() and a formula name) share one impl. A node that
// calls `resolveExcelFunction("X")` but hands it FEWER arguments than X accepts ships a
// capability the formula has and the node lacks — a node↔formula disparity, a defect
// regardless of how either compares to Excel (rules.md FX-11 / decisions D37). Excel /
// Formula.js divergence is a judgement call; our OWN two surfaces disagreeing is not.
//
// This scan is the completeness half, in the sourceInvariants idiom — it reads the real
// node source and classifies every `resolveExcelFunction(…)` call site:
//   • LITERAL + directly called — `resolveExcelFunction("NAME")(a, b, …)`: the arguments
//     are counted (a `...spread` covers the variadic max) and must reach
//     `EXCEL_IMPL_META[NAME].max`, else the name is a SANCTIONED shortfall with a reason.
//   • DYNAMIC or INDIRECT — the name is an expression, or the result is bound before it
//     is called: a static scan can't count these, so each must appear in MANUAL with a
//     note (what it resolves to, that it passes the max, and the behavioural test that
//     proves it). A NEW such site fails until reviewed — the blind spot can't grow silently.

const NODES_DIR = path.resolve(__dirname, "nodes");

function nodeFiles(): string[] {
  return fs
    .readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name))
    .map((e) => path.join(NODES_DIR, e.name));
}

/** Source with `//` line comments stripped (call syntax never lives in a string here). */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Scan from the opening bracket at `open`: return the index just past its match, the
 *  top-level comma count, whether any content was seen, and whether a top-level `...`
 *  spread appears. Skips nested brackets and string/template literals. */
function spanFrom(src: string, open: number): { end: number; commas: number; content: boolean; spread: boolean } {
  let depth = 0, commas = 0, content = false, spread = false, quote = "";
  let i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; content = true; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; if (depth > 1) content = true; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) break; continue; }
    if (depth === 1) {
      if (c === ",") { commas++; continue; }
      if (!/\s/.test(c)) content = true;
      if (c === "." && src.slice(i, i + 3) === "...") spread = true;
    }
  }
  return { end: i, commas, content, spread };
}

interface Site { file: string; name: string | null; inner: string; passed: number; direct: boolean }

function scanSites(): Site[] {
  const sites: Site[] = [];
  const CALL = "resolveExcelFunction(";
  for (const file of nodeFiles()) {
    const src = code(file);
    const rel = `nodes/${path.basename(file)}`;
    let from = 0;
    for (;;) {
      const at = src.indexOf(CALL, from);
      if (at < 0) break;
      const openInner = at + CALL.length - 1; // the '(' of resolveExcelFunction(
      const arg = spanFrom(src, openInner);
      const inner = src.slice(openInner + 1, arg.end).trim();
      from = arg.end + 1;
      const literal = /^"([A-Za-z0-9._]+)"$/.exec(inner);
      // Is the result invoked right here? skip an optional `!`, then require '('.
      let j = arg.end + 1;
      while (j < src.length && /[\s!]/.test(src[j])) j++;
      const direct = src[j] === "(";
      let passed = 0;
      if (direct) {
        const call = spanFrom(src, j);
        passed = call.spread ? Number.POSITIVE_INFINITY : call.content ? call.commas + 1 : 0;
      }
      sites.push({ file: rel, name: literal ? literal[1] : null, inner, passed, direct });
    }
  }
  return sites;
}

describe("FX-11 — a node dispatching to a formula function must pass all its arguments", () => {
  // LITERAL-name dispatches that pass fewer args than the impl accepts ON PURPOSE, each
  // with the reason the shortfall is not a real capability gap. (Empty: none today.)
  const SANCTIONED: Record<string, string> = {};

  // DYNAMIC / INDIRECT dispatches a static scan cannot arg-count, keyed by
  // `file::inner-expression`, each noting what it resolves to and that it passes the max.
  const MANUAL: Record<string, string> = {
    'nodes/text.ts::fn':
      'LEFT/RIGHT (fn = op) — passes 2 args (text, num_chars), covering arity [1,2]; num_chars is a socket. Behavioural: text.test.ts.',
    'nodes/text.ts::this.op === "find" ? "FIND" : "SEARCH"':
      'FIND/SEARCH — passes 3 args (needle, haystack, start), covering arity [2,3]; start is a socket. Behavioural: text.test.ts / formulaTier1.test.ts.',
  };

  it("literal dispatches pass all the arguments the formula accepts", () => {
    const offenders: string[] = [];
    for (const s of scanSites()) {
      if (!s.name || !s.direct) continue;
      const meta = EXCEL_IMPL_META[s.name];
      if (!meta) continue; // not in the arity table (a native-only pass-through)
      const max = meta.arity[1];
      if (s.passed >= max || s.name in SANCTIONED) continue;
      offenders.push(`${s.name} (${s.file}): passes ${s.passed} arg(s), formula accepts up to ${max}`);
    }
    expect(offenders, `FX-11 argument disparity —\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every dynamic/indirect dispatch is accounted for (the blind spot cannot grow silently)", () => {
    const unaccounted: string[] = [];
    for (const s of scanSites()) {
      if (s.name && s.direct) continue; // handled by the arg-count check above
      const key = `${s.file}::${s.inner}`;
      if (key in MANUAL) continue;
      unaccounted.push(key);
    }
    expect(unaccounted, `FX-11: a dynamic/indirect resolveExcelFunction dispatch with no MANUAL parity note —\n${unaccounted.join("\n")}`).toEqual([]);
  });
});
