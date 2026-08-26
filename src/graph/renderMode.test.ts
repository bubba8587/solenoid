import { describe, it, expect, beforeEach } from "vitest";
import { renderModeStore } from "./renderMode";

// localStorage may be absent in the node test env; the store's persist() is
// try/catch'd, so these exercise the in-memory behavior only.

describe("renderModeStore", () => {
  beforeEach(() => renderModeStore.set("dom"));

  it("defaults to dom and set switches mode", () => {
    expect(renderModeStore.get()).toBe("dom");
    renderModeStore.set("html");
    expect(renderModeStore.get()).toBe("html");
  });

  it("set to the same value does not notify", () => {
    renderModeStore.set("html");
    let n = 0;
    const unsub = renderModeStore.subscribe(() => { n++; });
    renderModeStore.set("html"); // unchanged
    expect(n).toBe(0);
    renderModeStore.set("dom"); // changed
    expect(n).toBe(1);
    unsub();
  });
});
