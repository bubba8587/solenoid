// [[D99]] rustIsSpec: text stays well formed, so a slice that halves a surrogate pair answers U+FFFD for the half.
// The conformance canon() makes every frozen string well formed, so these read the answers raw.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadWasmEngineSync } from "../../src/graph/engineWasm";
import { evaluateOnCore } from "../../src/graph/coreValues";

it("a slice that halves an emoji answers U+FFFD for the half, and whole slices keep it", () => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  const t = "a😀b";
  expect(evaluateOnCore("LEFT(t,2)&RIGHT(t,2)", { t })).toEqual({ value: "a��b" });
  expect(evaluateOnCore("UNICODE(MID(t,3,1))", { t })).toEqual({ value: 65533 });
  expect(evaluateOnCore("LEFT(t,3)&MID(t,4,1)", { t })).toEqual({ value: "a😀b" });
});
