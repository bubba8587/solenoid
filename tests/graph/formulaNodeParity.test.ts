// [[B16]] oneFormulaSurface, [[C51]] formulaNaming, [[formula-language#Parity measurement]]
import { describe, it, expect } from "vitest";
import { measureParity, excelNamedGapNames, excelCoverage } from "../../src/graph/formulaNodeParity";
import { initPackFormulas } from "../../src/graph/formulaExtensions";

// Gap A: a node's Excel name that gives #NAME? in a formula.
const EXCEL_NAMED_GAP: string[] = [];

// Gap C: a dispatchable name with no node, no EXCEL_GAP entry, and no deliberate registration.
const UNTRACKED_DISPATCHABLE: string[] = [];

const fmt = (xs: string[]) => (xs.length ? `\n  ${xs.join("\n  ")}\n` : " (none)");

describe("formula ↔ node parity ratchet", () => {
  // Pack formula functions register at app startup, as the report script measures them.
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
          `[[C51]] formulaNaming). If a name genuinely cannot\n` +
          `be registered (2-D shape under the noFramesInFormulas cap, or a lambda meta-function), add it to\n` +
          `EXCEL_NAMED_GAP here WITH a reason in the comment above.`,
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
          `(nodeExcel.ts). [[B16]] oneFormulaSurface applies to the formula surface too — see [[C51]] formulaNaming.`,
      ).toEqual([]);
    });
  });

  it("never advertises Formula.js internals as formula functions", () => {
    const leaked = m.noNode.filter((n) => n.startsWith("utils."));
    expect(leaked, `Formula.js internals leaked into the formula name list:${fmt(leaked)}`).toEqual([]);
  });

  it("inScope and nativeGap partition the catalog — the coverage denominator is honest", () => {
    const inScope = new Set(m.inScope.map((r) => r.type));
    const excluded = new Set(m.nativeGap.map((r) => r.type));
    for (const t of inScope) expect(excluded.has(t), `${t} counted in BOTH populations`).toBe(false);
  });

  // Gap A is empty, so only a made-up partly covered row tells `every` from `some`.
  it("excelCovered quantifier is EVERY, not SOME — one missing name uncovers the node", () => {
    const only = (avail: string[]) => (n: string) => avail.includes(n);
    expect(excelCoverage(["CEILING", "CEILING.MATH"], only(["CEILING", "CEILING.MATH"]))).toBe(true);
    expect(excelCoverage(["CEILING", "CEILING.MATH"], only(["CEILING"]))).toBe(false);
    expect(excelCoverage([], () => true)).toBe(false); // vacuous ≠ complete
  });
});
