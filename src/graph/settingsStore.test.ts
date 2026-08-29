import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsStore, initSettings, SETTINGS_SCHEMA } from "./settingsStore";

// settingsStore.ts persists to localStorage. The test environment is Node
// (no built-in localStorage), so we provide a minimal in-memory mock so
// the initSettings() round-trip tests can exercise real behavior.
const _ls: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (k) => _ls[k] ?? null,
  setItem: (k, v) => { _ls[k] = v; },
  removeItem: (k) => { delete _ls[k]; },
  clear: () => { Object.keys(_ls).forEach((k) => delete _ls[k]); },
  length: 0,
  key: () => null,
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

const LS_KEY = "solenoid.settings";

function resetToDefaults() {
  // No public reset() — drive each key back to the known default via set().
  // The equality guard means this is a no-op (no notify) when already at default.
  settingsStore.set("groupPush", true);
  settingsStore.set("tidyAlign", "center");
  settingsStore.set("csvFolder", "");
}

beforeEach(() => {
  localStorageMock.clear();
  resetToDefaults();
});

describe("settingsStore — equality guard (no-op on same value)", () => {
  it("set() with the same value neither notifies nor bumps the version", () => {
    const cb = vi.fn();
    settingsStore.subscribe(cb);
    const before = settingsStore.version();
    settingsStore.set("groupPush", true); // already true
    settingsStore.set("tidyAlign", "center"); // already center
    expect(cb).not.toHaveBeenCalled();
    expect(settingsStore.version()).toBe(before);
  });

  it("set() with a different value notifies and bumps the version", () => {
    const cb = vi.fn();
    settingsStore.subscribe(cb);
    const before = settingsStore.version();
    settingsStore.set("tidyAlign", "top");
    expect(cb).toHaveBeenCalledOnce();
    expect(settingsStore.version()).toBeGreaterThan(before);
    expect(settingsStore.get("tidyAlign")).toBe("top");
  });

  it("toggle flips both ways and always notifies (value always changes)", () => {
    const cb = vi.fn();
    settingsStore.subscribe(cb);
    settingsStore.toggle("groupPush");
    expect(settingsStore.get("groupPush")).toBe(false);
    settingsStore.toggle("groupPush");
    expect(settingsStore.get("groupPush")).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops future notifications", () => {
    const cb = vi.fn();
    const unsub = settingsStore.subscribe(cb);
    unsub();
    settingsStore.set("groupPush", false);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("settingsStore — persistence round-trip", () => {
  it("set() writes to localStorage immediately, overwriting the previous value", () => {
    settingsStore.set("csvFolder", "/first");
    settingsStore.set("csvFolder", "/second");
    const parsed = JSON.parse(localStorage.getItem(LS_KEY)!);
    expect(parsed.csvFolder).toBe("/second");
  });

  it("initSettings() restores a previously set value", () => {
    // Write to storage directly so the in-memory state (at defaults from beforeEach)
    // differs — simulates reading a persisted session on startup.
    // Characterization: resetToDefaults() also calls persist(), so set() then reset
    // would overwrite storage to defaults before initSettings() could read "top" back.
    localStorage.setItem(LS_KEY, JSON.stringify({ groupPush: true, tidyAlign: "top", csvFolder: "" }));
    expect(settingsStore.get("tidyAlign")).toBe("center"); // still at default in memory
    initSettings();
    expect(settingsStore.get("tidyAlign")).toBe("top"); // restored from storage
  });

  it("initSettings() is a no-op when localStorage has no entry", () => {
    // localStorage is clear (from beforeEach). State is at defaults.
    const before = settingsStore.version();
    initSettings();
    expect(settingsStore.version()).toBe(before);
    expect(settingsStore.get("groupPush")).toBe(true);
  });

  it("initSettings() fills missing keys from defaults (partial stored object)", () => {
    // Store a partial object — only tidyAlign, no groupPush or csvFolder.
    localStorage.setItem(LS_KEY, JSON.stringify({ tidyAlign: "top" }));
    // Reset to defaults first so initSettings has something to restore over.
    resetToDefaults();
    initSettings();
    expect(settingsStore.get("tidyAlign")).toBe("top"); // from storage
    expect(settingsStore.get("groupPush")).toBe(true);  // default (not in storage)
    expect(settingsStore.get("csvFolder")).toBe("");    // default (not in storage)
  });

  it("initSettings() ignores malformed JSON and leaves settings unchanged", () => {
    localStorage.setItem(LS_KEY, "not-valid-json{{{");
    const before = settingsStore.version();
    initSettings(); // should swallow the parse error
    expect(settingsStore.version()).toBe(before);
    expect(settingsStore.get("groupPush")).toBe(true);
  });
});

// `disabledOnMobile` is a CONTRACT, not a hint: a marked setting must be grayed in
// Settings AND dropped from the command palette AND ignored by the feature. Pinning
// the exact marked set here means adding the flag to a new field is a deliberate act
// that fails this test until all three consumers are updated.
describe("SETTINGS_SCHEMA — disabledOnMobile", () => {
  const marked = SETTINGS_SCHEMA.flatMap((s) => s.fields)
    .filter((f) => f.disabledOnMobile)
    .map((f) => f.key)
    .sort();

  it("marks exactly the settings with no mobile counterpart", () => {
    expect(marked).toEqual(["commandPaletteAlwaysOn", "minimapPosition"]);
  });

  it("every marked field is still a real, rendered field", () => {
    for (const key of marked) {
      const field = SETTINGS_SCHEMA.flatMap((s) => s.fields).find((f) => f.key === key);
      expect(field, `${key} should exist in the schema`).toBeDefined();
      // A "folder" field has no toggle/segment control to gray, so the flag would
      // silently do nothing there.
      expect(field!.type === "folder", `${key} must not be a folder field`).toBe(false);
    }
  });
});
