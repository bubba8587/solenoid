import { describe, it, expect, beforeEach } from "vitest";
import { SaveTimesNode } from "./input";
import { serialToJsDate } from "./dateSerial";
import { saveTimeStore } from "../saveTimeStore";
import { extractInit } from "../copyPaste";

describe("SaveTimesNode", () => {
  beforeEach(() => saveTimeStore.clear());

  it("reads blank before either save has happened", () => {
    const n = new SaveTimesNode();
    expect(n.data()).toEqual({ autosave: null, filesave: null });
  });

  it("emits each clock reading as a date serial carrying its time of day", () => {
    const at = Date.UTC(2026, 7, 16, 14, 32, 0);
    saveTimeStore.markAutosave(at);
    const n = new SaveTimesNode();
    const { autosave, filesave } = n.data();
    expect(filesave).toBeNull();
    // Serials are days-as-float, so a ms round-trip drifts sub-millisecond; the card
    // shows HH:mm, well inside that.
    expect(serialToJsDate(autosave!).getTime()).toBeCloseTo(at, -1);
    // A time of day means a fractional serial, which is what makes the box show HH:mm.
    expect(Number.isInteger(autosave!)).toBe(false);
  });

  it("tracks the two clocks apart", () => {
    const auto = Date.UTC(2026, 7, 16, 9, 0, 0);
    const file = Date.UTC(2026, 7, 16, 9, 5, 0);
    saveTimeStore.markAutosave(auto);
    saveTimeStore.markFileSave(file);
    const n = new SaveTimesNode();
    const out = n.data();
    expect(serialToJsDate(out.autosave!).getTime()).toBeCloseTo(auto, -1);
    expect(serialToJsDate(out.filesave!).getTime()).toBeCloseTo(file, -1);
  });

  it("caches both readings for the card, and re-reads on the next data()", () => {
    const n = new SaveTimesNode();
    n.data();
    expect(n.cachedAutosave).toBeNull();
    saveTimeStore.markAutosave(Date.UTC(2026, 7, 16, 12, 0, 0));
    n.data();
    expect(n.cachedAutosave).not.toBeNull();
    expect(n.cachedFileSave).toBeNull();
  });

  it("round-trips its label through extractInit", () => {
    const n = new SaveTimesNode({ label: "Versions" });
    const init = extractInit(n);
    expect(init.label).toBe("Versions");
    expect(new SaveTimesNode(init).label).toBe("Versions");
  });
});
