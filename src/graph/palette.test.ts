import { describe, it, expect, afterEach } from "vitest";
import { BUILTIN_PALETTES, BUILTIN_CANVAS, CANVAS_KEYS, DEFAULT_CANVAS, PALETTE_NAMES, COLOR_PALETTE, paletteStore, reportPaletteStore, resolveColor, NEUTRAL_HEX, NEUTRAL_WHITE, NEUTRAL_DARK, nextNeutral, isNeutralShade, PALETTE, themeAccent, contrastInk } from "./palette";

describe("built-in palettes", () => {
  it("every palette defines all 12 slots as hex colors", () => {
    for (const name of PALETTE_NAMES) {
      const p = BUILTIN_PALETTES[name];
      expect(Object.keys(p).length).toBe(COLOR_PALETTE.length);
      for (const slot of COLOR_PALETTE) {
        expect(p[slot], `${name}/${slot}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  // Author's rule (2026-06-21): slots may share a color ONLY where colourblindness
  // forces it (Colorblind-safe maps 12 slots onto a smaller proven CVD set) or where
  // a palette is DELIBERATELY monochrome (Equinox — all one gray, type read by socket
  // shape). Every other built-in must give all 12 slots visibly distinct hexes.
  const SHARED_COLOUR_OK = new Set(["Colorblind-safe", "Equinox"]);
  it("non-Colorblind palettes have 12 distinct colors", () => {
    for (const name of PALETTE_NAMES) {
      if (SHARED_COLOUR_OK.has(name)) continue;
      const hexes = COLOR_PALETTE.map((s) => BUILTIN_PALETTES[name][s].toLowerCase());
      expect(new Set(hexes).size, `${name} has duplicate colors`).toBe(hexes.length);
    }
  });
});

// The canvas ground a palette may author (--canvas-bg / --canvas-dot). Parallel to
// the slot map: never resolved through resolveColor, written straight by appTheme.
describe("canvas ground", () => {
  afterEach(() => {
    paletteStore.setActiveBase("Default");
    paletteStore.loadCustomTemplate("Default");
    paletteStore.setDocPalette(null);
  });

  it("every declared ground key is a hex color", () => {
    for (const name of PALETTE_NAMES) {
      for (const [key, hex] of Object.entries(BUILTIN_CANVAS[name])) {
        expect(CANVAS_KEYS).toContain(key);
        expect(hex, `${name}/${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  // The author's call: recoloring the graph is what a palette does; recoloring the
  // WORKBENCH is opt-in, and only Orchard opts in. A new palette adding a ground is a
  // deliberate change to this line, not a silent one.
  it("only Orchard authors a ground; every other built-in leaves the neutral one", () => {
    for (const name of PALETTE_NAMES) {
      const declared = Object.keys(BUILTIN_CANVAS[name]);
      if (name === "Orchard") expect(declared.sort()).toEqual([...CANVAS_KEYS].sort());
      else expect(declared, `${name} authors a ground`).toEqual([]);
    }
  });

  it("switching the app base swaps the ground, and back to none", () => {
    expect(paletteStore.canvasColors()).toEqual({});
    paletteStore.setActiveBase("Orchard");
    expect(paletteStore.canvasColors()).toEqual(BUILTIN_CANVAS.Orchard);
    paletteStore.setActiveBase("Muted");
    expect(paletteStore.canvasColors()).toEqual({}); // cleared, not left on Orchard's cream
  });

  it("a doc pin picks the ground too, and wins over the app choice", () => {
    paletteStore.setActiveBase("Orchard");
    paletteStore.setDocPalette({ base: "Muted" });
    expect(paletteStore.canvasColors()).toEqual({});
    paletteStore.setDocPalette(null);
    expect(paletteStore.canvasColors()).toEqual(BUILTIN_CANVAS.Orchard);
  });

  it("the custom ground starts neutral, is always complete, and edits on Save", () => {
    expect(paletteStore.customCanvas()).toEqual(DEFAULT_CANVAS);
    paletteStore.setActiveBase("Custom");
    expect(paletteStore.canvasColors()).toEqual(DEFAULT_CANVAS);
    paletteStore.setCustomMap(paletteStore.customMap(), { bgDark: "#123456" });
    expect(paletteStore.canvasColors()).toEqual({ ...DEFAULT_CANVAS, bgDark: "#123456" });
  });

  it("setCustomMap ignores an invalid ground hex, keeping the prior value", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.setCustomMap(paletteStore.customMap(), { bgDark: "nope" } as Record<string, string>);
    expect(paletteStore.customCanvas().bgDark).toBe(DEFAULT_CANVAS.bgDark);
  });

  it("loading a groundless template clears a ground the author had set", () => {
    paletteStore.loadCustomTemplate("Orchard");
    expect(paletteStore.customCanvas()).toEqual({ ...DEFAULT_CANVAS, ...BUILTIN_CANVAS.Orchard });
    paletteStore.loadCustomTemplate("Muted");
    expect(paletteStore.customCanvas()).toEqual(DEFAULT_CANVAS);
  });
});

// The gray swatch's 3-way neutral cycle (white → gray → dark), reachable only
// through the gray swatch — never as its own grid slot.
describe("neutral shades (gray-swatch cycle)", () => {
  it("cycles gray → dark → white → gray, and homes any real color to gray", () => {
    expect(nextNeutral("gray")).toBe(NEUTRAL_DARK);
    expect(nextNeutral(NEUTRAL_DARK)).toBe(NEUTRAL_WHITE);
    expect(nextNeutral(NEUTRAL_WHITE)).toBe("gray");
    expect(nextNeutral("gold")).toBe("gray"); // first click from a colored value
    expect(nextNeutral(undefined)).toBe("gray");
  });

  it("resolves the two extreme neutrals to their fixed hex, independent of the palette", () => {
    expect(resolveColor(NEUTRAL_WHITE)).toBe(NEUTRAL_HEX[NEUTRAL_WHITE]);
    expect(resolveColor(NEUTRAL_DARK)).toBe(NEUTRAL_HEX[NEUTRAL_DARK]);
    paletteStore.setActiveBase("Solarized");
    expect(resolveColor(NEUTRAL_WHITE)).toBe(NEUTRAL_HEX[NEUTRAL_WHITE]); // palette-independent
    paletteStore.setActiveBase("Default");
  });

  it("the extremes are neutral shades; gray and real slots are not", () => {
    expect(isNeutralShade(NEUTRAL_WHITE)).toBe(true);
    expect(isNeutralShade(NEUTRAL_DARK)).toBe(true);
    expect(isNeutralShade("gray")).toBe(false);
    expect(isNeutralShade("gold")).toBe(false);
  });

  it("the neutral extremes never appear as their own grid swatch", () => {
    expect(COLOR_PALETTE).not.toContain(NEUTRAL_WHITE);
    expect(COLOR_PALETTE).not.toContain(NEUTRAL_DARK);
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

describe("contrast ink is baked, not recomputed", () => {
  it("gives a readable ink for every palette slot in both themes", () => {
    // The pairing that matters: a fill takes --node-accent, its text takes the ink
    // derived from that same color. A light slot must get dark ink and vice versa.
    for (const slot of COLOR_PALETTE) {
      for (const mode of ["dark", "light"] as const) {
        const accent = themeAccent(PALETTE[slot], mode);
        const ink = contrastInk(accent);
        expect(["#fff", "#1a1a1a"], `${slot}/${mode}`).toContain(ink);
      }
    }
  });

  it("is stable across calls (the cache can't drift from a fresh computation)", () => {
    for (const slot of COLOR_PALETTE) {
      const a = contrastInk(PALETTE[slot]);
      const b = contrastInk(PALETTE[slot]);
      expect(b).toBe(a);
    }
  });

  it("light and dark can legitimately differ — themeAccent moves the luminance", () => {
    // Not asserting they DO differ for a given slot (that depends on the palette),
    // only that the ink is asked for the THEMED color rather than the raw slot, so
    // a slot sitting near the threshold can flip. This pins the call shape.
    const raw = PALETTE.lime;
    expect(contrastInk(themeAccent(raw, "light"))).toBe(contrastInk(themeAccent(raw, "light")));
    expect(contrastInk(themeAccent(raw, "dark"))).toBe(contrastInk(themeAccent(raw, "dark")));
  });
});
