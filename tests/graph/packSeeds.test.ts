// [[C79]] packActivationIsPresentation, [[C1]] demoVault
// Every pack ships an example seed, offered in the seed menus while the pack is on. A pack's seed shows that pack, and
// nothing from another pack, which may be off.
import { describe, it, expect, afterEach } from "vitest";
import { BUILTIN_PACKS, packsStore } from "../../src/graph/packs";
import { SEEDS, seedGroups } from "../../src/graph/seeds";
import { packMarksOf } from "./packContent";

type Saved = { group?: string; nodes: { id: string; type: string; init?: Record<string, unknown> }[] };
const packs = import.meta.glob("../../src/graph/seedGraphs/packs/*.json", { eager: true, import: "default" }) as Record<string, Saved>;
const idOf = (path: string) => path.replace(/^.*\//, "").replace(/\.json$/, "");
const marksIn = (g: Saved) => g.nodes.flatMap((n) => packMarksOf(n).map((m) => `${n.id}: ${m}`));

describe("pack seeds", () => {
  it("every pack names a seed in seedGraphs/packs/, and every file there is a pack's", () => {
    const files = new Set(Object.keys(packs).map(idOf));
    expect(BUILTIN_PACKS.filter((p) => !files.has(p.seed)).map((p) => `${p.id} → ${p.seed}`)).toEqual([]);
    expect([...files].filter((id) => !BUILTIN_PACKS.some((p) => p.seed === id))).toEqual([]);
  });

  for (const pack of BUILTIN_PACKS) {
    const g = Object.entries(packs).find(([path]) => idOf(path) === pack.seed)?.[1];
    if (!g) continue;
    it(`${pack.seed} shows its pack, at least three of its cards or functions, and no other pack`, () => {
      const marks = marksIn(g);
      const own = new Set(marks.filter((m) => m.includes(` ${pack.id}: `)).map((m) => m.replace(/^[^:]*: /, "")));
      const allowed = new Set([pack.id, ...(pack.dependsOn ?? [])]);
      const foreign = marks.filter((m) => !allowed.has(m.split(": ")[1]));
      expect(own.size, [...own].join(", ")).toBeGreaterThanOrEqual(3);
      expect(foreign).toEqual([]);
      expect(g.group).toBe("Packs");
    });
  }
});

describe("the seed menus", () => {
  const was = new Map(BUILTIN_PACKS.map((p) => [p.id, packsStore.isActive(p.id)]));
  afterEach(() => { for (const [id, on] of was) packsStore.setActive(id, on); });
  it("offer a pack's seed while the pack is on, under Packs, and not while it is off", () => {
    const pack = BUILTIN_PACKS.find((p) => p.id === "chemistry")!;
    packsStore.setActive(pack.id, true);
    expect(seedGroups().find((g) => g.head === "Packs")?.ids).toContain(pack.seed);
    packsStore.setActive(pack.id, false);
    expect(seedGroups().find((g) => g.head === "Packs")?.ids ?? []).not.toContain(pack.seed);
    expect(pack.seed in SEEDS).toBe(true);
  });
});
