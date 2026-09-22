// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE_NAMES, CHROME_HOME } from "../../src/graph/palette";
import { lookTokens, paletteTokens, accentTokens, defaultLookCss, paletteLookCss, paletteClass, accentClass, ACCENT_SLOTS, DEFAULT_ACCENT } from "../../obsidian-plugin/src/lookTokens";

const source = readFileSync("obsidian-plugin/src/look.css", "utf8");

describe("the Solenoid look has one source", () => {
  it("the demo vault's snippet is that file plus the Default palette's tokens (npm run plugin:build writes it)", () => {
    expect(readFileSync("demo-vault/.obsidian/snippets/solenoid.css", "utf8")).toBe(source + defaultLookCss());
  });

  it("never draws a side stripe (DESIGN.md: tint the element itself)", () => {
    expect(source).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:\s*[^;]*solid\s+var\(--sol-(accent|number)/);
    expect(source).toMatch(/--blockquote-border-thickness:\s*0px/);
  });
});

describe("the look's colors come from the palette", () => {
  const defaults = lookTokens("Default", DEFAULT_ACCENT, "dark");

  it("look.css authors none of the tokens lookTokens derives", () => {
    for (const name of Object.keys(defaults)) expect(source, name).not.toMatch(new RegExp(`^\\s*${name}:`, "m"));
  });

  it("every built-in palette and accent yields every token in both modes, as a color value", () => {
    for (const name of PALETTE_NAMES) {
      for (const accent of ACCENT_SLOTS) {
        for (const mode of ["dark", "light"] as const) {
          const tokens = lookTokens(name, accent, mode);
          expect(Object.keys(tokens), `${name} ${accent} ${mode}`).toEqual(Object.keys(defaults));
          for (const [token, value] of Object.entries(tokens)) expect(value, `${name} ${accent} ${mode} ${token}`).toMatch(/^(#[0-9a-f]{3}|#[0-9a-f]{6}|\d+%?|\d+, \d+, \d+)$/);
          // The palette's block and the accent's block split the set, nothing lost or doubled.
          const split = { ...paletteTokens(name, mode), ...accentTokens(name, accent, mode) };
          expect(split, `${name} ${accent} ${mode} split`).toEqual(tokens);
          expect(Object.keys(paletteTokens(name, mode)).filter((t) => t in accentTokens(name, accent, mode))).toEqual([]);
        }
      }
    }
  });

  it("the Default palette's tokens are the app's own hexes, light mode darkened as the chips are", () => {
    expect(defaults["--sol-number"]).toBe("#f5b914");
    expect(defaults["--sol-surface"]).toBe("#1e1e1e");
    expect(lookTokens("Default", DEFAULT_ACCENT, "light")["--sol-number"]).toBe("#eab013");
    expect(lookTokens("Orchard", DEFAULT_ACCENT, "light")["--sol-surface"]).not.toBe(lookTokens("Default", DEFAULT_ACCENT, "light")["--sol-surface"]);
  });

  it("an adaptive palette's chrome moves with the accent; the others' stays in the palette's block", () => {
    for (const name of PALETTE_NAMES) {
      const withAccent = "--sol-surface" in accentTokens(name, "blue", "dark");
      expect(withAccent, name).toBe(CHROME_HOME[name] !== undefined);
    }
    // Blueprint at its home accent is the authored cyanotype, not the gold-rotated print.
    expect(accentTokens("Blueprint", "blue", "dark")["--sol-surface"]).not.toBe(accentTokens("Blueprint", "gold", "dark")["--sol-surface"]);
    expect(accentTokens("Default", "blue", "dark")["--sol-accent"]).toBe(lookTokens("Default", "blue", "dark")["--sol-blue"]);
  });

  it("the plugin's blocks sit under the look class, the palette's class and the accent's", () => {
    const css = paletteLookCss();
    for (const name of PALETTE_NAMES) {
      for (const mode of ["dark", "light"]) {
        expect(css).toContain(`body.solenoid-look.${paletteClass(name)}.theme-${mode} {`);
        for (const accent of ACCENT_SLOTS) expect(css).toContain(`body.solenoid-look.${paletteClass(name)}.${accentClass(accent)}.theme-${mode} {`);
      }
    }
    expect(paletteClass("Colorblind-safe")).toBe("solenoid-palette-colorblind-safe");
    expect(accentClass("neutral-dark")).toBe("solenoid-accent-neutral-dark");
  });
});
