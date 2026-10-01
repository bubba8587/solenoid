// [[A1]] visualGraphCalculator
import { describe, it, expect } from "vitest";
import { inspectorStore } from "../../src/graph/inspectorStore";

describe("inspectorStore focus", () => {
  it("a context-menu focus ends when the panel closes, so a later open shows the selection", () => {
    inspectorStore.openFor("A");
    expect(inspectorStore.getFocus()).toBe("A");
    inspectorStore.close();
    expect(inspectorStore.getFocus()).toBeNull();
    inspectorStore.toggle();
    expect(inspectorStore.get()).toBe(true);
    expect(inspectorStore.getFocus()).toBeNull();
    inspectorStore.toggle();
    expect(inspectorStore.get()).toBe(false);
  });
});
