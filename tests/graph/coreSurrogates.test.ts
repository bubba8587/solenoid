// [[D99]] rustIsSpec: a slice that halves a surrogate pair leaves the formula to the TS, whose strings keep the half.
// The conformance canon() makes every frozen string well formed, so these read the answers raw.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadWasmEngineSync } from "../../src/graph/engineWasm";
import { evaluateOnCore } from "../../src/graph/coreValues";
import { compileEvaluator } from "../../src/graph/excelFormula";

it("halves of an emoji rejoin as the emoji, never U+FFFD", () => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  const t = "a😀b";
  for (const f of ["LEFT(t,2)&RIGHT(t,2)", "MID(t,1,2)&MID(t,3,2)", "UNICODE(MID(t,3,1))", "REGEXREPLACE(t,\"(?:)\",\"-\")"]) {
    expect(evaluateOnCore(f, { t }), f).toBeNull();
  }
  expect(compileEvaluator("LEFT(t,2)&RIGHT(t,2)")!({ t })).toBe("a😀b");
  expect(compileEvaluator("UNICODE(MID(t,3,1))")!({ t })).toBe(56832);
  expect(evaluateOnCore("LEFT(t,3)&MID(t,4,1)", { t })).toEqual({ value: "a😀b" });
});
