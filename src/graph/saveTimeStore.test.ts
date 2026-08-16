import { describe, it, expect, beforeEach } from "vitest";
import { saveTimeStore } from "./saveTimeStore";

describe("saveTimeStore", () => {
  beforeEach(() => saveTimeStore.clear());

  it("starts empty and keeps the two clocks independent", () => {
    expect(saveTimeStore.lastAutosaveAt()).toBeNull();
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();
    saveTimeStore.markAutosave(1000);
    expect(saveTimeStore.lastAutosaveAt()).toBe(1000);
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();
    saveTimeStore.markFileSave(2000);
    expect(saveTimeStore.lastAutosaveAt()).toBe(1000);
    expect(saveTimeStore.lastFileSaveAt()).toBe(2000);
  });

  it("notifies subscribers on every mark", () => {
    let hits = 0;
    const off = saveTimeStore.subscribe(() => { hits++; });
    saveTimeStore.markAutosave(1);
    saveTimeStore.markFileSave(2);
    off();
    saveTimeStore.markAutosave(3);
    expect(hits).toBe(2);
  });
});
