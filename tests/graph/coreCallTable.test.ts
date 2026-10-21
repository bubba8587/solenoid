// [[D99]] rustIsSpec
// The core's own call table (crates/solenoid-core/data/call_traits.json): every function name's dispatch facts,
// argument roles and empty-slot readings, frozen from the TypeScript's `formulaCallTable` by FREEZE_CORE=1. A name's
// per-position lists keep only their head: past it they repeat with period two, which the core extends.
// FREEZE_CORE=call-traits (or 1) rewrites it.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { freezes } from "./coreFixtures";
import { formulaCallTable, type FormulaCallTraits } from "../../src/graph/excelFormula";
import { FX_FUNCTION_NAMES, internalFunctionNames, resolveExcelFunction, FRAME_SURFACE_NAMES, NODE_SURFACE_NAMES, ELIMINATED_FUNCTIONS } from "../../src/graph/excelFunctions";

const FILE = path.resolve(__dirname, "../../crates/solenoid-core/data/call_traits.json");
const SLOTS = 64;

/** The shortest head (two or more) that the list's tail repeats with period two. */
function head<T>(xs: T[]): T[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  let n = xs.length;
  while (n > 2 && same(xs[n - 1], xs[n - 3])) n--;
  return xs.slice(0, n);
}

function build(): Record<string, unknown> {
  const names = [...new Set([...FX_FUNCTION_NAMES, ...internalFunctionNames(), ...Object.keys(FRAME_SURFACE_NAMES), ...Object.keys(NODE_SURFACE_NAMES), ...ELIMINATED_FUNCTIONS]
    .map((n) => n.toUpperCase()))].filter((n) => /^[A-Z_][A-Z0-9_.]*$/.test(n)).sort();
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const t = formulaCallTable(`${name}(${",".repeat(SLOTS - 1)})`)?.[name] as FormulaCallTraits | undefined;
    if (!t) continue;
    const blanks = Array.from({ length: SLOTS }, (_, i) => (i in t.blanks ? t.blanks[i] : null));
    const scalar = Array.from({ length: SLOTS }, (_, i) => t.scalar.includes(i));
    const { roles: _r, blanks: _b, scalar: _s, ...facts } = t;
    out[name] = { ...facts, resolves: !!resolveExcelFunction(name), roles: head(t.roles), blanks: head(blanks), scalar: head(scalar) };
  }
  return out;
}

it("the core's call table is the TypeScript's", () => {
  const table = build();
  if (freezes("call-traits")) fs.writeFileSync(FILE, JSON.stringify(table) + "\n");
  expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual(JSON.parse(JSON.stringify(table)));
});
