// [[C107]] obsidianPlugin
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE_NAMES } from "../../src/graph/palette";
import { lookTokens, defaultLookCss, paletteLookCss, paletteClass } from "../../obsidian-plugin/src/lookTokens";

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
  const defaults = lookTokens("Default", "dark");

  it("look.css authors none of the tokens lookTokens derives", () => {
    for (const name of Object.keys(defaults)) expect(source, name).not.toMatch(new RegExp(`^\\s*${name}:`, "m"));
  });

  it("every built-in palette yields every token in both modes, as a color value", () => {
    for (const name of PALETTE_NAMES) {
      for (const mode of ["dark", "light"] as const) {
        const tokens = lookTokens(name, mode);
        expect(Object.keys(tokens), `${name} ${mode}`).toEqual(Object.keys(defaults));
        for (const [token, value] of Object.entries(tokens)) expect(value, `${name} ${mode} ${token}`).toMatch(/^(#[0-9a-f]{3}|#[0-9a-f]{6}|\d+%?|\d+, \d+, \d+)$/);
      }
    }
  });

  it("the Default palette's tokens are the app's own hexes, light mode darkened as the chips are", () => {
    expect(defaults["--sol-number"]).toBe("#f5b914");
    expect(defaults["--sol-surface"]).toBe("#1e1e1e");
    expect(lookTokens("Default", "light")["--sol-number"]).toBe("#eab013");
    expect(lookTokens("Orchard", "light")["--sol-surface"]).not.toBe(lookTokens("Default", "light")["--sol-surface"]);
  });

  it("the plugin's blocks sit under the look class and the palette's class", () => {
    const css = paletteLookCss();
    for (const name of PALETTE_NAMES) {
      expect(css).toContain(`body.solenoid-look.${paletteClass(name)}.theme-dark {`);
      expect(css).toContain(`body.solenoid-look.${paletteClass(name)}.theme-light {`);
    }
    expect(paletteClass("Colorblind-safe")).toBe("solenoid-palette-colorblind-safe");
  });
});
