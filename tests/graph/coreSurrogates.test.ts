// [[D99]] rustIsSpec, [[rust-core#Nothing falls back]]
import { it, expect } from "vitest";
import { evaluateOnCore } from "../../src/graph/coreValues";
import { coreStore } from "./coreStore";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import type { FrameValue } from "../../src/graph/frame";
import type { FrameOp } from "../../src/graph/frameOps";

it("a cut that would halve an emoji takes it whole, and whole cuts keep it", () => {
  const t = "a😀b";
  expect(evaluateOnCore("LEFT(t,2)&RIGHT(t,2)", { t })).toBe("a😀😀b");
  expect(evaluateOnCore("UNICODE(MID(t,3,1))", { t })).toBe(128512);
  expect(evaluateOnCore("LEFT(t,3)&MID(t,4,1)", { t })).toBe("a😀b");
});

it("a lone surrogate reads as U+FFFD, in a formula's text, its values and a frame's cells", async () => {
  expect(evaluateOnCore("t & \"\uD83D\"", { t: "a\uDE00" })).toBe("a��");
  const f: FrameValue = { __frame: true, columns: [{ name: "s", type: "string", values: ["\uD83D", "b", "\uDE00", "\uD83D"] }] };
  const be = coreStore();
  try {
    const got = await be.collect(await be.apply(await be.source(f), { kind: "distinct" } as FrameOp));
    expect(got.columns[0].values).toEqual(["�", "b"]);
  } finally {
    wasmInvokeSync("engine_clear");
  }
});
