// [[C17]] shareImpl, [[D99]] rustIsSpec
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { callCore } from "../../src/graph/coreValues";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { loadWasmEngineSync, wasmEngineLoaded } from "../../src/graph/engineWasm";
import { isSolError, solError } from "../../src/graph/errorValue";

const na = solError("#N/A", "no match");
const div = solError("#DIV/0!", "zero");
// A card's call and its formula over the same values: [name, args, formula over a, b].
const CASES: [string, unknown[], string][] = [
  ["SUMPRODUCT", [[1, 2, 3], [1, na, 3]], "SUMPRODUCT(a, b)"],
  ["SUM", [[[1, na], [div, 4]]], "SUM(a)"],
  ["ROUND", [div, 2], "ROUND(a, b)"],
  ["MAX", [[1, div], na], "MAX(a, b)"],
  ["COUNT", [[1, na, 3]], "COUNT(a)"],
];

const answers = () => CASES.map(([name, args, f]) => {
  const card = callCore(name, args);
  const formula = compileEvaluator(f)!({ a: args[0], b: args[1] });
  return { name, card: isSolError(card) ? card.code : card, formula: isSolError(formula) ? formula.code : formula };
});

it("a card answers what its formula does on an error argument, on the TS and on the core", () => {
  for (const r of answers()) expect(r.card, r.name).toEqual(r.formula);
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  expect(wasmEngineLoaded()).toBe(true);
  for (const r of answers()) expect(r.card, r.name).toEqual(r.formula);
  expect(callCore("SUMPRODUCT", [[1, 2, 3], [1, na, 3]])).toBe(na);
});
