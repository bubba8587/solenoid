// [[B3]] sameNodeEverywhere
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { SEED_GROUPS } from "../../src/graph/seeds";
import { BUILTIN_PACKS } from "../../src/graph/packs";

// A tile without its picture shows a broken image; `node scripts/site-shots.mjs --thumbs <id>` draws one.
describe("site gallery thumbnails", () => {
  const tiles = [
    ...SEED_GROUPS.flatMap((g) => g.ids).map((id) => ["examples", id]),
    ...BUILTIN_PACKS.map((p) => ["packs", p.id]),
  ];
  it.each(tiles)("%s/%s has a thumbnail in both themes", (kind, id) => {
    for (const mode of ["dark", "light"]) expect(existsSync(`public/thumbs/${kind}/${id}-${mode}.webp`)).toBe(true);
  });
});
