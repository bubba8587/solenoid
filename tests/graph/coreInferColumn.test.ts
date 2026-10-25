// [[B17]] typedValueModel, [[D99]] rustIsSpec
// The type an imported column's cells read as (`inferColumn`, `nodes::infer_cells`), frozen from the TypeScript reader's
// answers when it moved to the core, with one change on purpose: a list cell crosses as its text, so a list of one
// number reads as that number. FREEZE_CORE=infer-column re-records the core's answers after a deliberate change.
import { it, expect } from "vitest";
import { frozen, readFrozen, sameJson } from "./coreFixtures";
import { inferColumn, inferColumns } from "../../src/graph/frame";
import { solError } from "../../src/graph/errorValue";

interface Case { cells: unknown[]; want: unknown }

const ATOMS: unknown[] = [
  "", " ", null, undefined, 0, -0, 1.5, NaN, Infinity, -Infinity, "NaN", "Infinity", "1e3", "0x10", "007", " 42 ", "1,234", "1,234.5", "$5", "50%", "-", ".", "1.", ".5", "+3",
  true, false, "true", "FALSE", " True ", "yes", "2024-03-05", "2024-03-05T10:30", "2024-03-05 10:30:15Z", "2024-13-01", "5 Mar 2024", "03/05/2024", "abc", "  hi  ", "é😀",
  solError("#N/A", "x"), solError("#DIV/0!", ""), [1, 2], [5], { a: 1 },
  { __unitCell: true, value: 2, dim: { L: 1 } }, { __unitCell: true, value: 3000, dim: { L: 1 }, display: "km" }, { __unitCell: true, value: 1, dim: { M: 1 } },
];

/** Every atom alone and beside every other, then short random columns drawn from the numeric, the logical-and-date and the whole pool. */
function corpus(): unknown[][] {
  const out: unknown[][] = [[]];
  for (const a of ATOMS) out.push([a]);
  for (const a of ATOMS) for (const b of ATOMS) out.push([a, b]);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 4000; i++) {
    const pool = i % 3 === 0 ? ATOMS.slice(0, 20) : i % 3 === 1 ? ATOMS.slice(20, 37) : ATOMS;
    out.push(Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => pool[Math.floor(rnd() * pool.length)]));
  }
  return out;
}

it("reads each imported column as the one type its cells share", () => {
  const cases = frozen<Case>("infer-column", () => corpus().map((cells) => ({ cells, want: inferColumn("c", cells) })));
  expect(cases.length).toBeGreaterThan(6000);
  const bad = cases.filter((c) => !sameJson(inferColumn("c", c.cells), c.want));
  expect(bad.slice(0, 5).map((c) => ({ cells: c.cells, want: c.want, got: inferColumn("c", c.cells) }))).toEqual([]);
});

it("reads many columns in one call as it reads each alone", () => {
  const cases = readFrozen<Case>("infer-column");
  const many = inferColumns(cases.map((c, j) => ({ name: `c${j}`, cells: c.cells })));
  const bad = cases.filter((c, j) => !sameJson({ ...many[j], name: "c" }, c.want));
  expect(bad.length).toBe(0);
});
