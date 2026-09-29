// [[C16]] polarsEngine
// Readers on a lazy upstream answer as they do on the same frame held eagerly.
import { describe, it, expect, beforeEach } from "vitest";
import { runFrameUnary, resetFrameBackendToJs, clearCollectMemo } from "../../src/graph/frameBackend";
import { SumIfsNode } from "../../src/graph/nodes/list";
import type { FrameValue } from "../../src/graph/frame";

const abc: FrameValue = {
  __frame: true,
  columns: [
    { name: "A", type: "number", values: [1, 2] },
    { name: "B", type: "number", values: [10, 20] },
    { name: "C", type: "number", values: [100, 200] },
  ],
};

beforeEach(() => { resetFrameBackendToJs(); clearCollectMemo(); });

describe("SUMIFS resolves a positional column against the upstream frame", () => {
  const sumifs = async (cond: string, values: string, lazy: boolean) => {
    const n = new SumIfsNode({ op: "sumifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = cond;
    n.stringLiterals.values = values;
    const frame = lazy ? await runFrameUnary(abc, { kind: "distinct" }) : abc;
    return (await n.data({ frame: [frame] } as never)).result;
  };

  it.each([["C", "1", 3], ["3", "A", 3], ["2", "3", 300]])("condition %s, values %s", async (cond, values, want) => {
    expect(await sumifs(cond, values, false)).toBe(want);
    expect(await sumifs(cond, values, true)).toBe(want);
  });
});
