import { describe, it, expect } from "vitest";
import { AllocatorNode } from "../../../src/graph/nodes/frame";
import { type FrameValue, type FrameColumn, frameFromInputText } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/copyPaste";
import seed from "../../../src/graph/seedGraphs/allocator.json";

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const cats = frame([
  { name: "Category", type: "string", values: ["Car", "Other"] },
  { name: "Min", type: "number", values: [20, 10] },
  { name: "Max", type: "number", values: [50, 40] },
]);
const allocOf = (out: { frame: FrameValue | unknown }): unknown[] =>
  (out.frame as FrameValue).columns.find((c) => c.name === "Allocation")!.values;
// Weights are an ordered column on the frame (orderedColumnsAreFrames), never a wired list.
const wcats = (weights: number[]): FrameValue =>
  frame([...cats.columns, { name: "Weight", type: "number", values: weights }]);

describe("AllocatorNode", () => {
  it("fits a budget by weight, clamped to each range (the worked example)", () => {
    const n = new AllocatorNode();
    n.literals.amount = 60;
    expect(allocOf(n.data({ categories: [cats] }))).toEqual([30, 30]);          // no Weight column → equal
    expect(allocOf(n.data({ categories: [wcats([1, 3])] }))).toEqual([20, 40]); // Weight column drives it
  });

  it("emits Category, Allocation, and Share as a raw fraction of the spend", () => {
    const n = new AllocatorNode();
    n.literals.amount = 60;
    const cols = (n.data({ categories: [wcats([1, 3])] }).frame as FrameValue).columns;
    const col = (name: string) => cols.find((c) => c.name === name)!.values;
    expect(cols.map((c) => c.name)).toEqual(["Category", "Allocation", "Share"]);
    expect(col("Allocation")).toEqual([20, 40]);
    expect(col("Share")).toEqual([1 / 3, 2 / 3]); // raw decimal, formatted downstream
  });

  it("reads weights from the Weight column; no column means equal weights", () => {
    const n = new AllocatorNode();
    n.literals.amount = 60;
    expect(allocOf(n.data({ categories: [wcats([1, 3])] }))).toEqual([20, 40]); // column
    expect(allocOf(n.data({ categories: [cats] }))).toEqual([30, 30]);          // equal fallback
  });

  it("min-for-target buys the most-valued category first", () => {
    const zero = frame([
      { name: "Category", type: "string", values: ["A", "B"] },
      { name: "Min", type: "number", values: [0, 0] },
      { name: "Max", type: "number", values: [100, 100] },
      { name: "Weight", type: "number", values: [3, 1] },
    ]);
    const n = new AllocatorNode({ mode: "minTarget" });
    n.literals.amount = 150;
    expect(allocOf(n.data({ categories: [zero] }))).toEqual([50, 0]);
  });

  it("min-proportional scales up from the binding floor", () => {
    const n = new AllocatorNode({ mode: "minProportional" });
    const wide = frame([
      { name: "Category", type: "string", values: ["Car", "Other"] },
      { name: "Min", type: "number", values: [20, 10] },
      { name: "Max", type: "number", values: [1000, 1000] },
      { name: "Weight", type: "number", values: [1, 3] },
    ]);
    expect(allocOf(n.data({ categories: [wide] }))).toEqual([20, 60]);
  });

  it("carries the min column's unit onto the Allocation column", () => {
    const withUnit = frame([
      { name: "Category", type: "string", values: ["Car", "Other"] },
      { name: "Min", type: "number", values: [20, 10], unit: { display: "USD", base: "USD", factor: 1 } as never },
      { name: "Max", type: "number", values: [50, 40] },
    ]);
    const n = new AllocatorNode();
    n.literals.amount = 60;
    const out = n.data({ categories: [withUnit] });
    const alloc = (out.frame as FrameValue).columns.find((c) => c.name === "Allocation")!;
    expect(alloc.unit).toBeTruthy();
  });

  it("errors when there is no min/max number column", () => {
    const bad = frame([{ name: "X", type: "string", values: ["a", "b"] }]);
    const out = new AllocatorNode().data({ categories: [bad] });
    expect(isSolError(out.frame)).toBe(true);
  });

  it("an unwired categories input yields no result, not a crash", () => {
    expect(new AllocatorNode().data({}).frame).toBeNull();
  });

  it("round-trips its op through extractInit", () => {
    const back = new AllocatorNode(extractInit(new AllocatorNode({ mode: "minProportional" })) as never);
    expect(back.mode).toBe("minProportional");
  });

  // Ties the shipped seed to a verified answer: Tech and Travel fill their small caps
  // (12k, 10k), then Car/Housing/Furniture split the remaining 78k by weight (2:3:1).
  it("computes the allocator seed's allocation", () => {
    const nodes = seed.nodes as { id: string; init?: Record<string, unknown>; literals?: Record<string, number> }[];
    const items = nodes.find((n) => n.id === "items")!;
    const alloc = nodes.find((n) => n.id === "alloc")!;
    const f = frameFromInputText(items.init!.frameText as string);
    const n = new AllocatorNode({ mode: alloc.init!.mode as never });
    n.literals.amount = alloc.literals!.amount;
    expect(allocOf(n.data({ categories: [f] }))).toEqual([26000, 39000, 13000, 12000, 10000]);
  });
});
