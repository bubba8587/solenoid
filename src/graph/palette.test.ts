import { describe, it, expect, afterEach } from "vitest";
import { BUILTIN_PALETTES, PALETTE_NAMES, COLOR_PALETTE, paletteStore, reportPaletteStore, resolveColor } from "./palette";

describe("built-in palettes", () => {
  it("every palette defines all 12 slots as hex colours", () => {
    for (const name of PALETTE_NAMES) {
      const p = BUILTIN_PALETTES[name];
      expect(Object.keys(p).length).toBe(COLOR_PALETTE.length);
      for (const slot of COLOR_PALETTE) {
        expect(p[slot], `${name}/${slot}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  // Author's rule (2026-06-21): slots may share a colour ONLY where colourblindness
  // forces it (Colorblind-safe maps 12 slots onto a smaller proven CVD set) or where
  // a palette is DELIBERATELY monochrome (Equinox — all one gray, type read by socket
  // shape). Every other built-in must give all 12 slots visibly distinct hexes.
  const SHARED_COLOUR_OK = new Set(["Colorblind-safe", "Equinox"]);
  it("non-Colorblind palettes have 12 distinct colours", () => {
    for (const name of PALETTE_NAMES) {
      if (SHARED_COLOUR_OK.has(name)) continue;
      const hexes = COLOR_PALETTE.map((s) => BUILTIN_PALETTES[name][s].toLowerCase());
      expect(new Set(hexes).size, `${name} has duplicate colours`).toBe(hexes.length);
    }
  });
});

// F-1 — the app-wide user-editable custom palette.
describe("custom palette (F-1)", () => {
  afterEach(() => {
    paletteStore.setActiveBase("Default");
    paletteStore.loadCustomTemplate("Default"); // restore the shared singleton map
    paletteStore.setDocPalette(null);
  });

  it("activates a user-authored map as the app base and edits live", () => {
    paletteStore.setActiveBase("Custom");
    expect(paletteStore.activeBase()).toBe("Custom");
    expect(resolveColor("gold")).toBe(BUILTIN_PALETTES.Default.gold); // seeds from Default
    paletteStore.setCustomSlot("gold", "#123456");
    expect(resolveColor("gold")).toBe("#123456");
    expect(paletteStore.customMap().gold).toBe("#123456");
  });

  it("loadCustomTemplate seeds every slot from a built-in", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.loadCustomTemplate("Solarized");
    for (const slot of COLOR_PALETTE) {
      expect(resolveColor(slot)).toBe(BUILTIN_PALETTES.Solarized[slot]);
    }
  });

  it("editing the custom map while a built-in is active doesn't retint the canvas", () => {
    paletteStore.setActiveBase("Muted");
    paletteStore.setCustomSlot("gold", "#abcdef");
    expect(resolveColor("gold")).toBe(BUILTIN_PALETTES.Muted.gold); // Muted still shows
    paletteStore.setActiveBase("Custom");
    expect(resolveColor("gold")).toBe("#abcdef"); // the pending edit now applies
  });

  it("ignores an invalid hex", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.setCustomSlot("gold", "not-a-hex");
    expect(resolveColor("gold")).toBe(BUILTIN_PALETTES.Default.gold);
  });

  it("customMap() returns a copy", () => {
    const m = paletteStore.customMap();
    m.gold = "#000000";
    expect(paletteStore.customMap().gold).not.toBe("#000000");
  });

  it("setCustomMap commits a whole map at once (the editor's Save)", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.setCustomMap({ ...BUILTIN_PALETTES.Muted, gold: "#abcdef" });
    expect(resolveColor("gold")).toBe("#abcdef");
    expect(resolveColor("blue")).toBe(BUILTIN_PALETTES.Muted.blue);
  });

  it("setCustomMap ignores invalid hexes, keeping the prior slot", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.loadCustomTemplate("Default");
    paletteStore.setCustomMap({ ...paletteStore.customMap(), gold: "nope" });
    expect(resolveColor("gold")).toBe(BUILTIN_PALETTES.Default.gold);
  });
});

// Bundle 13 #52 — a colors-only brand override PARALLEL to the canvas palette.
// The core invariant under test: setting a report override must NEVER change
// what the canvas (paletteStore/resolveColor) resolves, and vice versa.
describe("reportPaletteStore (report/export-only, parallel to the canvas palette)", () => {
  afterEach(() => {
    reportPaletteStore.setReportPalette(null);
    paletteStore.setDocPalette(null);
  });

  it("with no declaration, mirrors the canvas's effective color for a slot", () => {
    expect(reportPaletteStore.resolve("gold")).toBe(resolveColor("gold"));
    expect(reportPaletteStore.reportPalette()).toBeUndefined();
  });

  it("a report override changes reportPaletteStore.resolve WITHOUT touching the canvas", () => {
    const canvasBefore = resolveColor("gold");
    reportPaletteStore.setReportPalette({ overrides: { gold: "#ff00ff" } });
    expect(reportPaletteStore.resolve("gold")).toBe("#ff00ff");
    expect(resolveColor("gold")).toBe(canvasBefore); // canvas untouched
  });

  it("a report base pin resolves through that palette's slots", () => {
    reportPaletteStore.setReportPalette({ base: "Muted" });
    expect(reportPaletteStore.resolve("gold")).toBe(BUILTIN_PALETTES.Muted.gold);
    // The canvas doc palette is independent — still Default.
    expect(resolveColor("gold")).toBe(BUILTIN_PALETTES.Default.gold);
  });

  it("reportPalette() serializes only what was declared, round-trips through setReportPalette", () => {
    reportPaletteStore.setReportPalette({ base: "Solarized", overrides: { pink: "#123456" } });
    const block = reportPaletteStore.reportPalette();
    expect(block).toEqual({ base: "Solarized", overrides: { pink: "#123456" } });

    reportPaletteStore.setReportPalette(block);
    expect(reportPaletteStore.resolve("pink")).toBe("#123456");
    expect(reportPaletteStore.resolve("gold")).toBe(BUILTIN_PALETTES.Solarized.gold);
  });

  it("null clears the report declaration back to mirroring the canvas", () => {
    reportPaletteStore.setReportPalette({ overrides: { gold: "#ff00ff" } });
    reportPaletteStore.setReportPalette(null);
    expect(reportPaletteStore.reportPalette()).toBeUndefined();
    expect(reportPaletteStore.resolve("gold")).toBe(resolveColor("gold"));
  });

  it("ignores an unknown base name and a non-slot override key", () => {
    reportPaletteStore.setReportPalette({ base: "NotAPalette", overrides: { notASlot: "#fff", gold: "#abcdef" } });
    expect(reportPaletteStore.resolve("gold")).toBe("#abcdef");
    expect(reportPaletteStore.reportPalette()).toEqual({ overrides: { gold: "#abcdef" } });
  });
});
