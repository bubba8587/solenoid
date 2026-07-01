import { describe, it, expect } from "vitest";
import { BUILTIN_PALETTES, PALETTE_NAMES, COLOR_PALETTE } from "./palette";

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
  // forces it (Colorblind-safe maps 12 slots onto a smaller proven CVD set). Every
  // other built-in must give all 12 slots visibly distinct hexes.
  it("non-Colorblind palettes have 12 distinct colours", () => {
    for (const name of PALETTE_NAMES) {
      if (name === "Colorblind-safe") continue;
      const hexes = COLOR_PALETTE.map((s) => BUILTIN_PALETTES[name][s].toLowerCase());
      expect(new Set(hexes).size, `${name} has duplicate colours`).toBe(hexes.length);
    }
  });
});
