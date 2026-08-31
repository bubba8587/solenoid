import { describe, it, expect } from "vitest";
import { measureParity, excelNamedGapNames, excelCoverage } from "../../src/graph/formulaNodeParity";
import { initPackFormulas } from "../../src/graph/formulaExtensions";

// ─── The parity RATCHET (formulaNaming) ─────────────────────────────────────────────────
// The node set and the formula language drifted apart because NOTHING checked one
// against the other — a node could ship with an Excel name that no formula could
// call, and Formula.js could drag in a legacy name nobody decided to support. The
// ratchet rules are `docs/rules.md` formulaNaming / uniqueNameMap.
//
// This test pins today's gaps and makes them one-way. Both directions assert
// live ⊆ pinned (a NEW gap fails) AND pinned ⊆ live (a CLOSED gap must be deleted
// from the pin, so the lists can't rot into fiction). Same idea as
// `formatModel.ts`: the truth table lives in code, machine-checked.
//
// WHEN THIS FAILS, the message tells you which way. Never "fix" it by widening a
// pin to make CI green — that is the drift this exists to stop. Either close the
// gap (register the impl / add the node / curate the name) or, if the gap is
// deliberate, record it where deliberate gaps live: `EXCEL_GAP` in `nodeExcel.ts`.

// GAP A — a node carries an Excel name, but typing that name in an Expression
// gives #NAME?. The sharpest gap: the node is right there in the Add menu.
//
// matricesInFormulas opened this list: the cap lifted, and the matrix tranche closed the
// 2-D-shaped registrations (TOCOL/TOROW/WRAPROWS/WRAPCOLS/MDETERM/MINVERSE/
// SEQUENCE — `formulaMatrix.test.ts`). What remains splits in two:
// EMPTY — and keep it that way. The matricesInFormulas lambda tranche (2026-07-28) closed the
// last eight: LAMBDA became the evaluator's one special form and the hosts
// (MAP/BYROW/BYCOL/REDUCE/SCAN/MAKEARRAY/GROUPBY) registered against the same
// LambdaValue currency the nodes use (formulaLambda.test.ts). Every Excel name a
// node carries now dispatches. A name appearing here again is a NEW node shipped
// without its registration — close it the shareImpl way before pinning it.
const EXCEL_NAMED_GAP: string[] = [];

// GAP C — dispatchable in a formula, but no node, no EXCEL_GAP entry, and not a
// deliberately registered native: names Formula.js drags in that nobody decided to
// support. formulaNaming decision 1 blocks the legacy/superseded ones outright (see
// LEGACY_ALIASES in excelFunctions.ts), so what stays here is only what survived
// curation. An empty list is the goal, not a bug.
const UNTRACKED_DISPATCHABLE: string[] = [];

const fmt = (xs: string[]) => (xs.length ? `\n  ${xs.join("\n  ")}\n` : " (none)");

describe("formula ↔ node parity ratchet", () => {
  // Pack formula functions register at app startup (main.tsx) — measure the
  // same registry the app runs, like the report script does.
  initPackFormulas();
  const m = measureParity();

  describe("gap A — Excel-named nodes not callable in a formula", () => {
    const live = excelNamedGapNames(m);

    it("has no NEW gap (a node shipped with an Excel name and no formula registration)", () => {
      const added = live.filter((n) => !EXCEL_NAMED_GAP.includes(n));
      expect(
        added,
        `These Excel names have a node but are NOT callable in a formula:${fmt(added)}\n` +
          `Register a native impl for each (excelFunctions.ts \`registerInternal\`), sharing the\n` +
          `node's compute (the parity ratchet — an Excel-named node MUST be callable in a formula;\n` +
          `docs/rules.md formulaNaming). If a name genuinely cannot\n` +
          `be registered (2-D shape under the noFramesInFormulas cap, or a lambda meta-function), add it to\n` +
          `EXCEL_NAMED_GAP here WITH a reason in the comment above.`,
      ).toEqual([]);
    });

    it("has no STALE pin (a gap was closed but never deleted from the list)", () => {
      const closed = EXCEL_NAMED_GAP.filter((n) => !live.includes(n));
      expect(
        closed,
        `These names are pinned as gaps but are now callable in a formula:${fmt(closed)}\n` +
          `Delete them from EXCEL_NAMED_GAP — the ratchet only ratchets while the pin is honest.`,
      ).toEqual([]);
    });
  });

  describe("gap C — dispatchable names nobody decided to support", () => {
    const live = [...m.untracked].sort();

    it("has no NEW untracked name", () => {
      const added = live.filter((n) => !UNTRACKED_DISPATCHABLE.includes(n));
      expect(
        added,
        `These names dispatch in a formula with no node and no recorded decision:${fmt(added)}\n` +
          `Curate each one: block it (LEGACY_ALIASES in excelFunctions.ts) if it is a legacy or\n` +
          `superseded spelling, give it a node, or record it as a deliberate gap in EXCEL_GAP\n` +
          `(nodeExcel.ts). currentExcelParity applies to the formula surface too — see decisions.md formulaNaming.`,
      ).toEqual([]);
    });

    it("has no STALE pin", () => {
      const closed = UNTRACKED_DISPATCHABLE.filter((n) => !live.includes(n));
      expect(
        closed,
        `These names are pinned as untracked but no longer dispatch:${fmt(closed)}\n` +
          `Delete them from UNTRACKED_DISPATCHABLE.`,
      ).toEqual([]);
    });
  });

  // Formula.js's INTERNAL helper namespace is not an Excel surface: `utils.symbols.ADD`
  // and `utils.date.serialToDate` are library plumbing that the namespace walk used to
  // pick up, so they autocompleted in the formula editor as if they were functions a
  // user could call. Pinned so the walk can't start advertising them again.
  it("never advertises Formula.js internals as formula functions", () => {
    const leaked = m.noNode.filter((n) => n.startsWith("utils."));
    expect(leaked, `Formula.js internals leaked into the formula name list:${fmt(leaked)}`).toEqual([]);
  });

  // The coverage DENOMINATOR: in-scope ⊎ excluded-by-design must partition the
  // catalog exactly — no leaf counted twice, none dropped. A coverage claim uses
  // `inScope`, never `rows` (author ruling 2026-08-01: don't report a ratio whose
  // denominator includes leaves that were never candidates).
  it("inScope and nativeGap partition the catalog — the coverage denominator is honest", () => {
    expect(m.inScope.length + m.nativeGap.length).toBe(m.rows.length);
    const inScope = new Set(m.inScope.map((r) => r.type));
    const excluded = new Set(m.nativeGap.map((r) => r.type));
    for (const t of inScope) expect(excluded.has(t), `${t} counted in BOTH populations`).toBe(false);
    // Everything covered is in scope by construction; the only in-scope leaf that
    // is NOT covered is a gap-A leaf (an Excel name that doesn't dispatch).
    expect(m.covered.length + m.excelNamedGap.filter((r) => !r.inFormula).length)
      .toBe(m.inScope.length);
  });

  // The live catalog can't pin this: gap A is empty, so every excel-named row is
  // FULLY covered and `some` vs `every` agree on all of them. The synthetic
  // partial case is the only input that distinguishes the quantifiers.
  it("excelCovered quantifier is EVERY, not SOME — one missing name uncovers the node (useEveryNotSome)", () => {
    const only = (avail: string[]) => (n: string) => avail.includes(n);
    expect(excelCoverage(["CEILING", "CEILING.MATH"], only(["CEILING", "CEILING.MATH"]))).toBe(true);
    expect(excelCoverage(["CEILING", "CEILING.MATH"], only(["CEILING"]))).toBe(false);
    expect(excelCoverage([], () => true)).toBe(false); // vacuous ≠ complete
  });
});
