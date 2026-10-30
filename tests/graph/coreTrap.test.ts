// [[C130]] rustCore, [[D99]] rustIsSpec: a trap in the wasm module answers its call with an
// error and brings the module back, so the engine outlives it (tree/specs/computation/graph-core.md § Traps).
import { it, expect } from "vitest";
import { wasmEngineLoaded, wasmInvokeSync, onCore, CoreTrap } from "../../src/graph/engineWasm";
import { evaluateOnCore, callOnCore } from "../../src/graph/coreValues";
import { computeColumnOnEngine, collectPreview, runFrameUnary, useWasmBackend } from "../../src/graph/frameBackend";

/** The fresh instance comes a microtask after the trap, once the stack has left the module. */
const recovered = () => Promise.resolve();

it("a trap answers its own call and leaves later calls on a working core", async () => {
  expect(onCore(() => wasmInvokeSync("engine_trap"), "trapped")).toBe("trapped");
  // Until the swap, every call answers the trap rather than reach the dead instance.
  expect(() => wasmInvokeSync("engine_clear")).toThrow(CoreTrap);
  await recovered();
  // Hundreds of traps, each on its own fresh instance.
  for (let i = 0; i < 300; i++) {
    expect(() => wasmInvokeSync("engine_trap")).toThrow(CoreTrap);
    await recovered();
  }
  expect(wasmEngineLoaded()).toBe(true);
  expect(evaluateOnCore("SUM(xs) + LEN(t)", { xs: [1, 2, 3], t: "abc" })).toBe(9);
  expect(callOnCore("SUM", [[1, 2], [3]])).toBe(6);
  const col = computeColumnOnEngine({ __frame: true, columns: [{ name: "a", type: "number", values: [1, 2] }] }, "@a * 2", 2);
  expect(col).toMatchObject({ cells: [2, 4] });
});

// A verb's failure rejects its preview, so the error guard makes it the node's own error and nothing downstream reads a
// frame that is gone.
it("a lazy frame left in a dead instance rejects its preview with #REF!", async () => {
  useWasmBackend();
  try {
    const frame = { __frame: true as const, columns: [{ name: "a", type: "number" as const, values: [3, 1, 2] }] };
    const ref = await runFrameUnary(frame, { kind: "sort", by: "a", dir: "asc" });
    expect(() => wasmInvokeSync("engine_trap")).toThrow(CoreTrap);
    await recovered();
    await expect(collectPreview(ref)).rejects.toMatchObject({ code: "#REF!" });
  } finally {
    useWasmBackend();
  }
});
