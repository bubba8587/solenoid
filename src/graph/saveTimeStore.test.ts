import { describe, it, expect, afterEach } from "vitest";
import { saveTimeStore, type SaveClock } from "./saveTimeStore";

const NULLS: SaveClock = { autosavedAt: null, fileSavedAt: null };

describe("saveTimeStore", () => {
  afterEach(() => saveTimeStore.setProvider(() => NULLS));

  it("reads null on both clocks with no provider registered", () => {
    expect(saveTimeStore.lastAutosaveAt()).toBeNull();
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();
  });

  it("delegates reads to the provider, live", () => {
    let clock: SaveClock = { autosavedAt: 1000, fileSavedAt: null };
    saveTimeStore.setProvider(() => clock);
    expect(saveTimeStore.lastAutosaveAt()).toBe(1000);
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();
    clock = { autosavedAt: 1000, fileSavedAt: 2000 }; // no bump needed for a read
    expect(saveTimeStore.lastFileSaveAt()).toBe(2000);
  });

  it("notifies subscribers on setProvider and on bump", () => {
    let hits = 0;
    const off = saveTimeStore.subscribe(() => { hits++; });
    saveTimeStore.setProvider(() => NULLS);
    saveTimeStore.bump();
    off();
    saveTimeStore.bump();
    expect(hits).toBe(2);
  });
});
