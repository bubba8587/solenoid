import { describe, it, expect } from "vitest";
import { measureParity, excelNamedGapNames } from "./formulaNodeParity";

// ─── The parity RATCHET (D19) ─────────────────────────────────────────────────
// The node set and the formula language drifted apart because NOTHING checked one
// against the other — a node could ship with an Excel name that no formula could
// call, and Formula.js could drag in a legacy name nobody decided to support. See
// `docs/formula-node-parity.md`.
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
// D23 opened this list: the cap lifted, and the matrix tranche closed the
// 2-D-shaped registrations (TOCOL/TOROW/WRAPROWS/WRAPCOLS/MDETERM/MINVERSE/
// SEQUENCE — `formulaMatrix.test.ts`). What remains splits in two:
// - array-returning functions awaiting their list/matrix-model registrations
//   (FILTER/SORTBY/GROUPBY/RANDARRAY/SCAN, the table TAKE) — closeable now,
//   tranche by tranche, same discipline;
// - the lambda META-functions (LAMBDA/MAP/BYROW/BYCOL/MAKEARRAY/REDUCE) — a
//   language feature (compilePositional at rank 2), the last tranche.
const EXCEL_NAMED_GAP: string[] = [
  "BYCOL",
  "BYROW",
  "FILTER",
  "GROUPBY",
  "LAMBDA",
  "MAKEARRAY",
  "MAP",
  "RANDARRAY",
  "REDUCE",
  "SCAN",
  "SORTBY",
  "TAKE",
];

// GAP C — dispatchable in a formula, but no node, no EXCEL_GAP entry, and not a
// deliberately registered native: names Formula.js drags in that nobody decided to
// support. D19 decision 1 blocks the legacy/superseded ones outright (see
// LEGACY_ALIASES in excelFunctions.ts), so what stays here is only what survived
// curation. An empty list is the goal, not a bug.
const UNTRACKED_DISPATCHABLE: string[] = [];

const fmt = (xs: string[]) => (xs.length ? `\n  ${xs.join("\n  ")}\n` : " (none)");

describe("formula ↔ node parity ratchet", () => {
  const m = measureParity();

  describe("gap A — Excel-named nodes not callable in a formula", () => {
    const live = excelNamedGapNames(m);

    it("has no NEW gap (a node shipped with an Excel name and no formula registration)", () => {
      const added = live.filter((n) => !EXCEL_NAMED_GAP.includes(n));
      expect(
        added,
        `These Excel names have a node but are NOT callable in a formula:${fmt(added)}\n` +
          `Register a native impl for each (excelFunctions.ts \`registerInternal\`), sharing the\n` +
          `node's compute — see docs/formula-node-parity.md "Tier 1". If a name genuinely cannot\n` +
          `be registered (2-D shape under the D2 cap, or a lambda meta-function), add it to\n` +
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
          `(nodeExcel.ts). D10 applies to the formula surface too — see decisions.md D19.`,
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
});
