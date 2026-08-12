import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── The `?? literal` swallow — swept to zero, now a floor ────────────────────
// `inputs.x?.[0] ?? this.literals.x` silently swallows a WIRED null into the node's
// own typed literal, so a blank flowing down a cable becomes whatever value sits in
// the box. `readInput()` (shared.ts) is the fix: a CONNECTED cable wins even when
// its value is null; only an UNWIRED slot falls back.
//
// THE SPEC IS `docs/value-semantics.md` -> "Reading an input" — what a wired blank
// does, by the input's ROLE (operand / mode / shape / column reference / reduction
// member / check parameter / control bound / filter condition), where the guard GOES,
// and how `undefined` (omitted) stays distinct from `null` (unknown). Settled by the
// author 2026-07-27: follow THIS project's value model, not Excel's optional-argument
// defaulting. `nodes/wiredNull.test.ts` pins a worked example of each row.
//
// This started as a per-file ratchet counting down from ~350 sites. Every file is now
// at zero, so it is simply a floor: a node reintroducing the idiom fails here. There
// is no list to maintain and nothing to raise — a failure means one new read to fix,
// not a budget to adjust.

// `??` OR `||` (which swallows falsy values too), with any whitespace — including a
// line break — between the operator and the literal read, so reformatting can't
// hide a swallow from the floor.
const SWALLOW = /(\?\?|\|\|)\s*(this|node)\.(string)?[Ll]iterals/g;

// Blank out comments while PRESERVING line structure, so `shared.ts`'s doc comment
// (which describes the very idiom this counts) and notes written beside a fix don't
// register — and so a trailing comment can't hide a live read on the same line.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, p: string) => p);
}

function offenders(): { file: string; lines: number[] }[] {
  const dir = path.resolve(__dirname);
  const out: { file: string; lines: number[] }[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = stripComments(fs.readFileSync(path.join(dir, f), "utf8"));
    const lines: number[] = [];
    for (const m of src.matchAll(SWALLOW)) {
      lines.push(src.slice(0, m.index).split("\n").length);
    }
    if (lines.length) out.push({ file: f, lines });
  }
  return out;
}

describe("wired-null swallow — swept, and stays swept", () => {
  it("no node reads an input with `?? literal`", () => {
    const found = offenders();
    expect(
      found.map((o) => `${o.file}:${o.lines.join(",")}`),
      `A wired-null swallow is back:\n` +
        found.map((o) => `  ${o.file} lines ${o.lines.join(", ")}`).join("\n") +
        `\n\nRead the input with \`readInput(inputs.x, this.literals.x ?? default)\` instead\n` +
        `of \`inputs.x?.[0] ?? this.literals.x\`, so a WIRED blank takes its role's\n` +
        `disposition rather than being replaced by whatever is typed in the node's box.\n` +
        `Omit the \`?? default\` when the input has a genuine OMITTED reading — readInput\n` +
        `then hands back undefined for that and null for a blank cable.\n` +
        `Spec: docs/value-semantics.md -> "Reading an input". Worked examples of every\n` +
        `role: nodes/wiredNull.test.ts.`,
    ).toEqual([]);
  });
});
