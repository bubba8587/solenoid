import { describe, it, expect, beforeEach } from "vitest";
import { renderModeStore } from "./renderMode";

// localStorage may be absent in the node test env; the store's persist() is
// try/catch'd, so these exercise the in-memory behavior only.

describe("renderModeStore", () => {
  beforeEach(() => renderModeStore.set("dom"));

  it("defaults to dom and set switches mode", () => {
    expect(renderModeStore.get()).toBe("dom");
    renderModeStore.set("canvas");
    expect(renderModeStore.get()).toBe("canvas");
  });

  it("set to the same value does not notify", () => {
    renderModeStore.set("canvas");
    let n = 0;
    const unsub = renderModeStore.subscribe(() => { n++; });
    renderModeStore.set("canvas"); // unchanged
    expect(n).toBe(0);
    renderModeStore.set("dom"); // changed
    expect(n).toBe(1);
    unsub();
  });

  it("toggle flips dom <-> canvas and notifies", () => {
    let n = 0;
    const unsub = renderModeStore.subscribe(() => { n++; });
    renderModeStore.toggle();
    expect(renderModeStore.get()).toBe("canvas");
    renderModeStore.toggle();
    expect(renderModeStore.get()).toBe("dom");
    expect(n).toBe(2);
    unsub();
  });
});
