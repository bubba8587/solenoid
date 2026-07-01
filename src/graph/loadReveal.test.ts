import { describe, it, expect } from "vitest";
import { revealWaves, loadRevealStore } from "./loadReveal";

const flat = (waves: string[][]) => waves.flat();
const waveOf = (waves: string[][], id: string) => waves.findIndex((w) => w.includes(id));

describe("revealWaves — input→output layering", () => {
  it("orders a simple chain source → sink", () => {
    const waves = revealWaves(["a", "b", "c"], [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ]);
    expect(waves).toEqual([["a"], ["b"], ["c"]]);
  });

  it("puts a node one level deeper than its DEEPEST source (longest path)", () => {
    // a → b → d, a → d : d must wait for b (depth 2), not ride a's depth+1.
    const waves = revealWaves(["a", "b", "d"], [
      { source: "a", target: "b" },
      { source: "b", target: "d" },
      { source: "a", target: "d" },
    ]);
    expect(waveOf(waves, "a")).toBeLessThan(waveOf(waves, "b"));
    expect(waveOf(waves, "b")).toBeLessThan(waveOf(waves, "d"));
  });

  it("groups independent roots into the first wave", () => {
    const waves = revealWaves(["x", "y", "z"], []);
    expect(waves).toEqual([["x", "y", "z"]]);
  });

  it("never drops a node in a cycle — flushes it to a final wave", () => {
    const waves = revealWaves(["a", "b", "c"], [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "b" }, // b↔c cycle
    ]);
    expect(flat(waves).sort()).toEqual(["a", "b", "c"]);
    expect(waveOf(waves, "a")).toBe(0);
  });

  it("ignores self-loops and dangling edges", () => {
    const waves = revealWaves(["a", "b"], [
      { source: "a", target: "a" },        // self-loop
      { source: "a", target: "b" },
      { source: "ghost", target: "b" },    // dangling source
    ]);
    expect(waves).toEqual([["a"], ["b"]]);
  });

  it("returns [] for an empty graph", () => {
    expect(revealWaves([], [])).toEqual([]);
  });
});

describe("loadRevealStore", () => {
  it("tracks phase, progress, and per-connection reveal flags", () => {
    expect(loadRevealStore.isActive()).toBe(false);
    loadRevealStore.begin();
    expect(loadRevealStore.phase()).toBe("building");
    expect(loadRevealStore.isActive()).toBe(true);
    loadRevealStore.setProgress(0.5);
    expect(loadRevealStore.progress()).toBeCloseTo(0.5);
    loadRevealStore.startReveal();
    expect(loadRevealStore.phase()).toBe("revealing");
    expect(loadRevealStore.progress()).toBe(1);
    loadRevealStore.revealConn("c1");
    expect(loadRevealStore.isConnRevealed("c1")).toBe(true);
    expect(loadRevealStore.isConnRevealed("c2")).toBe(false);
    loadRevealStore.finish();
    expect(loadRevealStore.isActive()).toBe(false);
    expect(loadRevealStore.isConnRevealed("c1")).toBe(false);
  });

  it("clamps progress to [0,1]", () => {
    loadRevealStore.begin();
    loadRevealStore.setProgress(2);
    expect(loadRevealStore.progress()).toBe(1);
    loadRevealStore.setProgress(-1);
    expect(loadRevealStore.progress()).toBe(0);
    loadRevealStore.finish();
  });
});
