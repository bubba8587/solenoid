import { describe, it, expect, beforeEach } from "vitest";
import { calcModeStore } from "./calcModeStore";

// The manual/auto gate processGraph short-circuits on — shipped in 1.0 with
// zero direct coverage (v1.0 audit, quality). The mode × dirty transition
// matrix, pinned.

beforeEach(() => {
  calcModeStore.setMode("auto"); // also clears dirty
});

describe("calcModeStore", () => {
  it("defaults to auto and not dirty", () => {
    expect(calcModeStore.mode()).toBe("auto");
    expect(calcModeStore.isManual()).toBe(false);
    expect(calcModeStore.dirty()).toBe(false);
  });

  it("setMode returns true only on an actual change", () => {
    expect(calcModeStore.setMode("manual")).toBe(true);
    expect(calcModeStore.setMode("manual")).toBe(false);
    expect(calcModeStore.setMode("auto")).toBe(true);
  });

  it("markDirty flags; clearDirty resets", () => {
    calcModeStore.setMode("manual");
    calcModeStore.markDirty();
    expect(calcModeStore.dirty()).toBe(true);
    calcModeStore.clearDirty();
    expect(calcModeStore.dirty()).toBe(false);
  });

  it("switching to auto clears a pending dirty flag (the caller recomputes)", () => {
    calcModeStore.setMode("manual");
    calcModeStore.markDirty();
    expect(calcModeStore.setMode("auto")).toBe(true);
    expect(calcModeStore.dirty()).toBe(false);
  });

  it("notifies subscribers on every mode/dirty transition, and only then", () => {
    let fired = 0;
    const unsub = calcModeStore.subscribe(() => fired++);
    calcModeStore.setMode("manual"); // 1
    calcModeStore.setMode("manual"); // no-op
    calcModeStore.markDirty();       // 2
    calcModeStore.markDirty();       // no-op (already dirty)
    calcModeStore.clearDirty();      // 3
    calcModeStore.clearDirty();      // no-op
    calcModeStore.setMode("auto");   // 4
    unsub();
    calcModeStore.setMode("manual");
    calcModeStore.setMode("auto");
    expect(fired).toBe(4);
  });

  it("version bumps with each notification (useSyncExternalStore snapshot)", () => {
    const v0 = calcModeStore.version();
    calcModeStore.setMode("manual");
    expect(calcModeStore.version()).toBeGreaterThan(v0);
    calcModeStore.setMode("auto");
  });

  it("survives a missing localStorage (the vitest env is node — persist must not throw)", () => {
    // The store's try/catch IS the behavior under test: private mode / no
    // storage must degrade to in-memory mode, never crash a setMode.
    expect(() => calcModeStore.setMode("manual")).not.toThrow();
    expect(calcModeStore.mode()).toBe("manual");
    calcModeStore.setMode("auto");
  });
});
