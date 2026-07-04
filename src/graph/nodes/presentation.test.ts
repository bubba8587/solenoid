import { describe, it, expect, afterEach } from "vitest";
import { PresentationNode } from "./presentation";

describe("PresentationNode", () => {
  it("starts with no steps, no outputs", () => {
    const n = new PresentationNode();
    expect(n.steps).toEqual([]);
    expect(n.activeIndex).toBe(0);
    expect(Object.keys(n.outputs)).toEqual([]);
    expect(n.data()).toEqual({});
  });

  it("addStep appends a step with its own copy of the node-id array", () => {
    const n = new PresentationNode();
    const ids = ["a", "b"];
    n.addStep("Intro", ids);
    ids.push("c"); // mutating the caller's array must not affect the stored step
    expect(n.steps).toEqual([{ title: "Intro", nodeIds: ["a", "b"] }]);
  });

  it("goTo clamps into range; next/prev step through", () => {
    const n = new PresentationNode();
    n.addStep("1", []);
    n.addStep("2", []);
    n.addStep("3", []);
    expect(n.goTo(-5)).toBe(0);
    expect(n.goTo(99)).toBe(2);
    n.goTo(0);
    expect(n.next()).toBe(1);
    expect(n.next()).toBe(2);
    expect(n.next()).toBe(2); // clamped at the end
    expect(n.prev()).toBe(1);
  });

  it("goTo on an empty step list stays at 0", () => {
    const n = new PresentationNode();
    expect(n.goTo(3)).toBe(0);
    expect(n.next()).toBe(0);
  });

  it("removeStep drops a step and re-clamps activeIndex", () => {
    const n = new PresentationNode();
    n.addStep("1", []);
    n.addStep("2", []);
    n.goTo(1);
    n.removeStep(1);
    expect(n.steps).toEqual([{ title: "1", nodeIds: [] }]);
    expect(n.activeIndex).toBe(0);
  });

  it("moveStep swaps neighbors and follows activeIndex", () => {
    const n = new PresentationNode();
    n.addStep("1", []);
    n.addStep("2", []);
    n.goTo(0);
    n.moveStep(0, 1);
    expect(n.steps.map((s) => s.title)).toEqual(["2", "1"]);
    expect(n.activeIndex).toBe(1); // followed step "1" to its new slot

    // Out-of-range moves are no-ops.
    n.moveStep(0, -1);
    expect(n.steps.map((s) => s.title)).toEqual(["2", "1"]);
  });

  it("renameStep updates the title in place", () => {
    const n = new PresentationNode();
    n.addStep("Draft", []);
    n.renameStep(0, "Final");
    expect(n.steps[0].title).toBe("Final");
  });

  it("currentStep reflects activeIndex", () => {
    const n = new PresentationNode();
    n.addStep("A", ["x"]);
    n.addStep("B", ["y"]);
    expect(n.currentStep()?.title).toBe("A");
    n.next();
    expect(n.currentStep()?.title).toBe("B");
  });

  it("a persisted steps array round-trips independently per instance (not aliased)", () => {
    const src = new PresentationNode({ steps: [{ title: "S1", nodeIds: ["a"] }] });
    const clone = new PresentationNode({ steps: src.steps });
    clone.addStep("S2", ["b"]);
    expect(src.steps).toEqual([{ title: "S1", nodeIds: ["a"] }]);
    expect(clone.steps).toHaveLength(2);
  });
});

import { presentationStore } from "../presentationStore";

describe("presentationStore", () => {
  afterEach(() => presentationStore.stop());
  it("tracks the running presentation and clears on stop", () => {
    expect(presentationStore.isActive()).toBe(false);
    presentationStore.start("pres-1");
    expect(presentationStore.isActive()).toBe(true);
    expect(presentationStore.activeId()).toBe("pres-1");
    presentationStore.stop();
    expect(presentationStore.isActive()).toBe(false);
    expect(presentationStore.activeId()).toBeNull();
  });
});
