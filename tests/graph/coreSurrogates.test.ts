// [[D99]] rustIsSpec: text stays well formed, so a slice that halves a surrogate pair answers U+FFFD for the half, and
// text holding a lone surrogate reads with U+FFFD for it as it crosses into the core.
import { it, expect } from "vitest";
import { evaluateOnCore } from "../../src/graph/coreValues";
import { frameBackend, useWasmBackend } from "../../src/graph/frameBackend";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import type { FrameValue } from "../../src/graph/frame";
import type { FrameOp } from "../../src/graph/frameOps";

it("a slice that halves an emoji answers U+FFFD for the half, and whole slices keep it", () => {
  const t = "a😀b";
  expect(evaluateOnCore("LEFT(t,2)&RIGHT(t,2)", { t })).toBe("a��b");
  expect(evaluateOnCore("UNICODE(MID(t,3,1))", { t })).toBe(65533);
  expect(evaluateOnCore("LEFT(t,3)&MID(t,4,1)", { t })).toBe("a😀b");
});

it("a lone surrogate reads as U+FFFD, in a formula's text, its values and a frame's cells", async () => {
  expect(evaluateOnCore("t & \"\uD83D\"", { t: "a\uDE00" })).toBe("a��");
  const f: FrameValue = { __frame: true, columns: [{ name: "s", type: "string", values: ["\uD83D", "b", "\uDE00", "\uD83D"] }] };
  useWasmBackend();
  const be = frameBackend();
  try {
    const got = await be.collect(await be.apply(await be.source(f), { kind: "distinct" } as FrameOp));
    expect(got.columns[0].values).toEqual(["�", "b"]);
  } finally {
    wasmInvokeSync("engine_clear");
  }
});
