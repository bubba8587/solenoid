// [[C98]] paletteMirrorsMenubar
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireMenuKey, buildMenus } from "../../src/graph/menuModel";

describe("fireMenuKey — a menu or palette command presses a key like a keyboard", () => {
  const g = globalThis as Record<string, unknown>;
  let fired: { type: string; code: string; on: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
    g.KeyboardEvent = class { constructor(public type: string, public init: { code: string }) {} };
    g.document = { dispatchEvent: (e: { type: string; init: { code: string } }) => { fired.push({ type: e.type, code: e.init.code, on: "document" }); return true; } };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete g.KeyboardEvent;
    delete g.document;
  });

  it("dispatches on the document, where React Flow's Delete listens, then releases the key", () => {
    fireMenuKey("Delete", { key: "Delete" });
    expect(fired).toEqual([{ type: "keydown", code: "Delete", on: "document" }]);
    vi.runAllTimers();
    expect(fired.map((f) => f.type)).toEqual(["keydown", "keyup"]);
  });

  it("Tidy and Cleanup go through the canvas keyboard, so a locked canvas refuses them", () => {
    const view = buildMenus().find((m) => m.label === "View")!;
    for (const label of ["Tidy", "Cleanup"]) {
      const item = view.items.find((i) => "label" in i && i.label === label) as { onClick: () => void };
      item.onClick();
    }
    expect(fired.map((f) => f.code)).toEqual(["KeyT", "KeyC"]);
  });
});
