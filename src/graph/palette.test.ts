import { describe, it, expect, afterEach } from "vitest";
import { BUILTIN_PALETTES, BUILTIN_CHROME, CHROME_KEYS, type ChromeKey, CHROME_VARS, DERIVED_CHROME_VARS, DEFAULT_CHROME, chromeCssVars, PALETTE_NAMES, COLOR_PALETTE, paletteStore, reportPaletteStore, resolveColor, NEUTRAL_HEX, NEUTRAL_WHITE, NEUTRAL_DARK, nextNeutral, isNeutralShade, PALETTE, themeAccent, contrastInk } from "./palette";

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

// The chrome ramp a palette may author (App.css's neutral tokens). Parallel to the
// slot map: never resolved through resolveColor, written straight by appTheme.
describe("chrome ramp", () => {
  const MODES = ["dark", "light"] as const;

  afterEach(() => {
    paletteStore.setActiveBase("Default");
    paletteStore.loadCustomTemplate("Default");
    paletteStore.setDocPalette(null);
  });

  it("every declared chrome key is known and a hex color", () => {
    for (const name of PALETTE_NAMES) {
      for (const mode of MODES) {
        for (const [key, hex] of Object.entries(BUILTIN_CHROME[name][mode])) {
          expect(CHROME_KEYS).toContain(key);
          expect(hex, `${name}/${mode}/${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });

  // All or nothing: a partial ramp writes its keys but derives NOTHING (chromeCssVars),
  // so half a ramp lands the app in a mix of authored neutrals and App.css ones. Default
  // is the only palette that authors none — it IS App.css, and a copy here would be two
  // homes for one truth.
  it("a palette authors either no chrome or a COMPLETE ramp in both modes", () => {
    for (const name of PALETTE_NAMES) {
      for (const mode of MODES) {
        const declared = Object.keys(BUILTIN_CHROME[name][mode]).sort();
        if (name === "Default") expect(declared, "Default authors chrome").toEqual([]);
        else expect(declared, `${name}/${mode}`).toEqual([...CHROME_KEYS].sort());
      }
    }
  });

  it("switching the app base swaps the ramp, and back to none", () => {
    expect(paletteStore.chrome().light).toEqual({}); // Default rides App.css
    paletteStore.setActiveBase("Orchard");
    expect(paletteStore.chrome().light).toEqual(BUILTIN_CHROME.Orchard.light);
    paletteStore.setActiveBase("Solarized");
    expect(paletteStore.chrome().light).toEqual(BUILTIN_CHROME.Solarized.light);
    paletteStore.setActiveBase("Default");
    expect(paletteStore.chrome().light).toEqual({}); // cleared, not left on the last ramp
  });

  it("a doc pin picks the chrome too, and wins over the app choice", () => {
    paletteStore.setActiveBase("Orchard");
    paletteStore.setDocPalette({ base: "Default" });
    expect(paletteStore.chrome().dark).toEqual({});
    paletteStore.setDocPalette({ base: "Muted" });
    expect(paletteStore.chrome().dark).toEqual(BUILTIN_CHROME.Muted.dark);
    paletteStore.setDocPalette(null);
    expect(paletteStore.chrome().dark).toEqual(BUILTIN_CHROME.Orchard.dark);
  });

  it("the custom ramp starts neutral, is always complete, and edits on Save", () => {
    expect(paletteStore.customChrome().dark).toEqual(DEFAULT_CHROME.dark);
    paletteStore.setActiveBase("Custom");
    expect(paletteStore.chrome().light).toEqual(DEFAULT_CHROME.light);
    paletteStore.setCustomMap(paletteStore.customMap(), { dark: { canvasBg: "#123456" }, light: {} });
    expect(paletteStore.chrome().dark).toEqual({ ...DEFAULT_CHROME.dark, canvasBg: "#123456" });
    expect(paletteStore.chrome().light).toEqual(DEFAULT_CHROME.light); // the other mode is carried, not wiped
  });

  it("setCustomMap ignores an invalid chrome hex, keeping the prior value", () => {
    paletteStore.setActiveBase("Custom");
    paletteStore.setCustomMap(paletteStore.customMap(), { dark: { canvasBg: "nope" }, light: {} });
    expect(paletteStore.customChrome().dark.canvasBg).toBe(DEFAULT_CHROME.dark.canvasBg);
  });

  it("loading a template reseeds the ramp; a chromeless one restores the neutral", () => {
    paletteStore.loadCustomTemplate("Orchard");
    expect(paletteStore.customChrome().light).toEqual({ ...DEFAULT_CHROME.light, ...BUILTIN_CHROME.Orchard.light });
    paletteStore.loadCustomTemplate("Solarized");
    expect(paletteStore.customChrome().light).toEqual({ ...DEFAULT_CHROME.light, ...BUILTIN_CHROME.Solarized.light });
    paletteStore.loadCustomTemplate("Default"); // the one chromeless template
    expect(paletteStore.customChrome().light).toEqual(DEFAULT_CHROME.light);
  });
});

// What makes a ramp "appropriate" rather than merely different. Every rule here is a
// claim DESIGN.md §2 already makes about the neutral ramp; a palette may recolor the
// workbench but not renege on its structure. The App.css baseline is held to the same
// bar, so a rule that Default fails is a wrong rule, not a failing palette.
describe("chrome ramp structure", () => {
  const chan = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lum = (h: string) => [0.2126, 0.7152, 0.0722].reduce((a, w, i) => {
    const s = chan(h, i);
    return a + w * (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  // Every authored ramp, plus the App.css baseline they all descend from.
  const RAMPS: [string, "dark" | "light", Record<ChromeKey, string>][] = [
    ["(App.css)", "dark", DEFAULT_CHROME.dark],
    ["(App.css)", "light", DEFAULT_CHROME.light],
    ...PALETTE_NAMES.flatMap((name) =>
      (["dark", "light"] as const)
        .filter((m) => Object.keys(BUILTIN_CHROME[name][m]).length > 0)
        .map((m) => [name, m, BUILTIN_CHROME[name][m] as Record<ChromeKey, string>] as [string, "dark" | "light", Record<ChromeKey, string>]),
    ),
  ];

  it.each(RAMPS)("%s/%s: the canvas is darker than the card, and the dots read on it", (_n, _m, r) => {
    expect(lum(r.canvasBg)).toBeLessThan(lum(r.surface));
    const dot = ratio(r.canvasDot, r.canvasBg);
    expect(dot).toBeGreaterThan(1.1); // visible
    expect(dot).toBeLessThan(2.2);    // a grid, not a starfield
  });

  it.each(RAMPS)("%s/%s: the field is the brightest layer in light, a recess in dark", (_n, mode, r) => {
    const fieldBrighter = lum(r.surfaceSunken) > lum(r.surface);
    expect(fieldBrighter).toBe(mode === "light");
  });

  it.each(RAMPS)("%s/%s: the hover fill steps toward the ink, never away", (_n, _m, r) => {
    const toInk = Math.sign(lum(r.text) - lum(r.surface));
    expect(Math.sign(lum(r.surfaceRaised) - lum(r.surface))).toBe(toInk);
  });

  it.each(RAMPS)("%s/%s: the three border tiers step outward from the card", (_n, _m, r) => {
    const d = (k: ChromeKey) => Math.abs(lum(r[k]) - lum(r.surface));
    expect(d("borderSubtle")).toBeLessThan(d("border"));
    expect(d("border")).toBeLessThan(d("borderStrong"));
  });

  it.each(RAMPS)("%s/%s: the four ink tiers step down in contrast", (_n, _m, r) => {
    const c = (k: ChromeKey) => ratio(r[k], r.surface);
    expect(c("textBright")).toBeGreaterThan(c("text"));
    expect(c("text")).toBeGreaterThan(c("textDim"));
    expect(c("textDim")).toBeGreaterThan(c("textMuted"));
  });

  // D35: contrast is scoped to the two palettes that PROMISE it — Default, the
  // experience nobody chose, and Colorblind-safe, whose brief is legibility. The rest
  // are aesthetic opt-ins where fidelity to a look wins; Solarized sits near 3:1 by
  // design and forcing AA meant shipping something that was no longer Solarized.
  // Widening this set back to every palette is a decision, not a tidy-up.
  const AA_PALETTES = new Set(["(App.css)", "Default", "Colorblind-safe"]);
  const AA_RAMPS = RAMPS.filter(([name]) => AA_PALETTES.has(name));

  // DESIGN.md §2: "the muted tier clears WCAG AA 4.5:1 on the card/sunken surfaces".
  // The canvas is deliberately excluded for the secondary tiers — nothing sets body
  // text directly on the canvas, and the App.css light ramp is itself at 4.35 there.
  it.each(AA_RAMPS)("%s/%s: every ink tier clears WCAG AA on the card and the field", (_n, _m, r) => {
    for (const k of ["text", "textDim", "textMuted"] as const) {
      expect(ratio(r[k], r.surface), `${k} on card`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(r[k], r.surfaceSunken), `${k} on field`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(r.text, r.canvasBg), "text on canvas").toBeGreaterThanOrEqual(4.5);
  });

  // The scope above is only honest if the guaranteed palettes actually exist as ramps
  // to check. Colorblind-safe authoring chrome is what puts it in AA_RAMPS at all.
  it("the AA-guaranteed palettes are all present in the checked set", () => {
    expect(AA_RAMPS.map(([n, m]) => `${n}/${m}`).sort())
      .toEqual(["(App.css)/dark", "(App.css)/light", "Colorblind-safe/dark", "Colorblind-safe/light"]);
  });
});

// chromeCssVars is the whole contract with appTheme: what it omits, appTheme CLEARS.
describe("chromeCssVars", () => {
  it("an unauthored ramp produces nothing, so every chrome var falls back to App.css", () => {
    expect(chromeCssVars({}, "dark")).toEqual({});
    expect(chromeCssVars({}, "light")).toEqual({});
  });

  it("a partial ramp writes what it has and derives nothing", () => {
    const out = chromeCssVars({ canvasBg: "#141309" }, "dark");
    expect(out).toEqual({ "--canvas-bg": "#141309" });
  });

  it("a full ramp writes all 13 tokens plus the derived ones", () => {
    for (const mode of ["dark", "light"] as const) {
      const out = chromeCssVars(BUILTIN_CHROME.Orchard[mode], mode);
      for (const { var: name, key } of CHROME_VARS) {
        expect(out[name], `${mode}/${name}`).toBe(BUILTIN_CHROME.Orchard[mode][key]);
      }
      // Dark keeps App.css's black shadows and its accent-tinted wordmark, so those
      // four stay unwritten and get cleared. Light derives every one.
      const derived = DERIVED_CHROME_VARS.filter((v) => out[v] !== undefined);
      expect(derived.length, mode).toBe(mode === "light" ? DERIVED_CHROME_VARS.length : DERIVED_CHROME_VARS.length - 4);
    }
  });

  it("derives every chrome var from the DEFAULT ramp too (no key is Orchard-only)", () => {
    const out = chromeCssVars(DEFAULT_CHROME.light, "light");
    for (const name of DERIVED_CHROME_VARS) expect(out[name], name).toBeTruthy();
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
