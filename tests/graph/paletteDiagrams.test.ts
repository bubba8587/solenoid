// [[A1]] visualGraphCalculator, [[components#The design system]], [[palette-and-theme#Each palette, drawn]]
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paletteDiagrams } from "../../scripts/palette-diagrams";

describe("the palette spec's diagrams", () => {
  it("are what palette.ts draws now (rerun `node scripts/vite-run.mjs scripts/palette-diagrams.ts`)", () => {
    for (const [file, svg] of Object.entries(paletteDiagrams())) expect(readFileSync(file, "utf8"), file).toBe(svg);
  });
});
