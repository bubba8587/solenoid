// [[C130]] rustCore, [[D99]] rustIsSpec: a trap in the wasm core answers on the TS for that call and brings the module
// back, so the engine outlives it.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadWasmEngineSync, wasmEngineLoaded, wasmInvokeSync, onCore, CoreTrap } from "../../src/graph/engineWasm";
import { evaluateOnCore, callCore } from "../../src/graph/coreValues";
import { computeColumnOnEngine } from "../../src/graph/frameBackend";

it("a trap falls back for its call and leaves later calls on a working core", () => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  expect(onCore(() => wasmInvokeSync("engine_trap"), "ts")).toBe("ts");
  // Hundreds of traps on one instance leave its stack pointer out of memory; each one gets a fresh instance.
  for (let i = 0; i < 500; i++) expect(() => wasmInvokeSync("engine_trap")).toThrow(CoreTrap);
  expect(wasmEngineLoaded()).toBe(true);
  expect(evaluateOnCore("SUM(xs) + LEN(t)", { xs: [1, 2, 3], t: "abc" })).toEqual({ value: 9 });
  expect(callCore("SUM", [[1, 2], [3]])).toBe(6);
  const col = computeColumnOnEngine({ __frame: true, columns: [{ name: "a", type: "number", values: [1, 2] }] }, "@a * 2", 2);
  expect(col).toMatchObject({ cells: [2, 4] });
});
