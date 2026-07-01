import { describe, it, expect } from "vitest";
import { chainClosure } from "./isolateStore";

const edges = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "x", target: "y" }, // a separate component
  { source: "c", target: "d" },
];

describe("chainClosure", () => {
  it("walks downstream from the seed", () => {
    expect([...chainClosure(edges, ["a"])].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("walks upstream as well as downstream", () => {
    expect([...chainClosure(edges, ["c"])].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("stays within the connected component", () => {
    expect([...chainClosure(edges, ["x"])].sort()).toEqual(["x", "y"]);
  });

  it("unions the closures of multiple seeds", () => {
    expect([...chainClosure(edges, ["a", "x"])].sort()).toEqual(["a", "b", "c", "d", "x", "y"]);
  });

  it("returns just the seed when it has no connections", () => {
    expect([...chainClosure(edges, ["lonely"])]).toEqual(["lonely"]);
  });

  it("does not loop forever on a cycle", () => {
    const cyclic = [
      { source: "p", target: "q" },
      { source: "q", target: "r" },
      { source: "r", target: "p" },
    ];
    expect([...chainClosure(cyclic, ["p"])].sort()).toEqual(["p", "q", "r"]);
  });
});
