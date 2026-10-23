// [[C130]] rustCore, [[D99]] rustIsSpec: a trap in the wasm core answers its call with an error and brings the module
// back, so the engine outlives it.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadWasmEngineSync, wasmEngineLoaded, wasmInvokeSync, onCore, CoreTrap } from "../../src/graph/engineWasm";
import { evaluateOnCore, callOnCore } from "../../src/graph/coreValues";
import { computeColumnOnEngine, collectPreview, runFrameUnary, useWasmBackend } from "../../src/graph/frameBackend";

it("a trap answers its own call and leaves later calls on a working core", () => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  expect(onCore(() => wasmInvokeSync("engine_trap"), "trapped")).toBe("trapped");
  // Hundreds of traps on one instance leave its stack pointer out of memory; each one gets a fresh instance.
  for (let i = 0; i < 500; i++) expect(() => wasmInvokeSync("engine_trap")).toThrow(CoreTrap);
  expect(wasmEngineLoaded()).toBe(true);
  expect(evaluateOnCore("SUM(xs) + LEN(t)", { xs: [1, 2, 3], t: "abc" })).toBe(9);
  expect(callOnCore("SUM", [[1, 2], [3]])).toBe(6);
  const col = computeColumnOnEngine({ __frame: true, columns: [{ name: "a", type: "number", values: [1, 2] }] }, "@a * 2", 2);
  expect(col).toMatchObject({ cells: [2, 4] });
});

// A verb's failure rejects its preview, so the error guard makes it the node's own error and nothing downstream reads a
// frame that is gone.
it("a lazy frame left in a dead instance rejects its preview with #REF!", async () => {
  loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
  useWasmBackend();
  try {
    const frame = { __frame: true as const, columns: [{ name: "a", type: "number" as const, values: [3, 1, 2] }] };
    const ref = await runFrameUnary(frame, { kind: "sort", by: "a", dir: "asc" });
    expect(() => wasmInvokeSync("engine_trap")).toThrow(CoreTrap);
    await expect(collectPreview(ref)).rejects.toMatchObject({ code: "#REF!" });
  } finally {
    useWasmBackend();
  }
});
