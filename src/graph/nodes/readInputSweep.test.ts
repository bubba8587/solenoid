import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── The `?? literal` swallow, ratcheted ──────────────────────────────────────
// `inputs.x?.[0] ?? this.literals.x` silently swallows a WIRED null into the node's
// own typed literal, so a blank flowing down a cable becomes whatever value sits in
// the box. `readInput()` (shared.ts) is the fix: a CONNECTED cable wins even when
// its value is null; only an UNWIRED slot falls back.
//
// THE SPEC IS `docs/value-semantics.md` -> "Reading an input" — what a wired blank
// does, by the input's ROLE (operand / mode / shape / reduction member / check
// parameter / control bound / filter predicate). Settled by the author 2026-07-27:
// follow THIS project's value model, not Excel's optional-argument defaulting.
// `nodes/wiredNull.test.ts` pins a worked example of each row.
//
// So what remains is mechanical, just large. This pins the remaining count PER FILE
// so it can only shrink: a new node reintroducing the idiom fails here, and fixing a
// file requires lowering its number (or deleting the line), which keeps the list from
// rotting into fiction. A file absent from this list is DONE.

const SWALLOW = /\?\? *(this|node)\.(string)?[Ll]iterals/g;

// Remaining `?? literal` reads, by file. LOWER these as files are swept; never raise
// one to make the suite green — that is the bug this exists to stop.
const REMAINING: Record<string, number> = {
  "cube.ts": 5,
  "display.ts": 5,
  "expression.ts": 1,
  "finance.ts": 73,
  "frame.ts": 30,
  "lambda.ts": 1,
  "list.ts": 33,
  "scalar.ts": 13,
  "stats.ts": 22,
  "visual.ts": 23,
};

function countByFile(): Record<string, number> {
  const dir = path.resolve(__dirname);
  const out: Record<string, number> = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    // Skip COMMENT lines: `shared.ts` documents the very idiom this counts, and the
    // fix for a site is often to write a note about it — neither is a live read.
    const code = fs.readFileSync(path.join(dir, f), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const n = (code.match(SWALLOW) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}

describe("wired-null swallow — ratcheted down, never up", () => {
  const live = countByFile();

  it("no file gains a new `?? literal` read", () => {
    const grown = Object.entries(live)
      .filter(([f, n]) => n > (REMAINING[f] ?? 0))
      .map(([f, n]) => `${f}: ${REMAINING[f] ?? 0} → ${n}`);
    expect(
      grown,
      `These files gained a wired-null swallow:\n  ${grown.join("\n  ")}\n\n` +
        `Read an input with \`readInput(inputs.x, this.literals.x ?? default)\` instead of\n` +
        `\`inputs.x?.[0] ?? this.literals.x\`, so a WIRED blank propagates rather than\n` +
        `being replaced by whatever is typed in the node's box. See the policy at the top\n` +
        `of this file, and nodes/wiredNull.test.ts for a worked example of each case.`,
    ).toEqual([]);
  });

  it("the pinned counts are current (lower one when you sweep a file)", () => {
    const stale = Object.entries(REMAINING)
      .filter(([f, n]) => (live[f] ?? 0) < n)
      .map(([f, n]) => `${f}: pinned ${n}, actually ${live[f] ?? 0}`);
    expect(
      stale,
      `These pins are higher than reality — lower them (or delete the line at 0):\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the files already swept stay swept", () => {
    for (const f of ["text.ts", "complex.ts", "chemistry.ts", "dist-discrete.ts", "quality.ts", "logic.ts",
                      "date.ts", "input.ts", "matrix.ts", "tableLambda.ts"]) {
      expect(live[f] ?? 0, `${f} regressed — it was fully swept`).toBe(0);
    }
  });
});
