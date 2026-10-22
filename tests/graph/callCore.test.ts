// [[C17]] shareImpl, [[D99]] rustIsSpec
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { callCore } from "../../src/graph/coreValues";
import { loadWasmEngineSync, wasmEngineLoaded } from "../../src/graph/engineWasm";
import { isSolError, solError } from "../../src/graph/errorValue";

const call = () => callCore("SUMPRODUCT", [[1, 2, 3], [1, solError("#N/A", "no match"), 3]]);

it("callCore answers a Formula.js error as Solenoid's, on the TS and on the core", () => {
  const ts = call();
  expect(isSolError(ts)).toBe(true);
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  expect(wasmEngineLoaded()).toBe(true);
  const core = call();
  expect(isSolError(core)).toBe(true);
  expect(core).not.toBeInstanceOf(Error);
});
