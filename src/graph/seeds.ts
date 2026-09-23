// [[C89]] standoffsSolveLast (the seed rule), [[C1]] demoVault
import { loadGraph } from "./persistence";
import type { SavedGraph } from "./persistence";

type SeedFile = SavedGraph & { label?: string; order?: number; group?: string; hidden?: boolean };
const DEFAULT_ORDER = 1000;
const DEFAULT_GROUP = "More";

const modules = import.meta.glob<SeedFile>("./seedGraphs/*.json", {
  eager: true,
  import: "default",
});

function idFromPath(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.json$/, "");
}

// Load safety only: seeds.test.ts requires a label, order and group on every seed.
function labelFromId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type SeedId = string;

// Insertion order is the menu order (consumers map Object.entries).
export const SEEDS: Record<string, { label: string; group: string; graph: SavedGraph }> = {};
export const SEED_GROUPS: { head: string; ids: SeedId[] }[] = [];
const ordered = Object.entries(modules)
  .map(([path, mod]) => ({ id: idFromPath(path), mod, order: mod.order ?? DEFAULT_ORDER }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
for (const { id, mod } of ordered) {
  const group = mod.group ?? DEFAULT_GROUP;
  SEEDS[id] = { label: mod.label ?? labelFromId(id), group, graph: mod };
  if (mod.hidden) continue; // a developer sheet: loadable by id, absent from the menus
  const bucket = SEED_GROUPS.find((g) => g.head === group);
  if (bucket) bucket.ids.push(id);
  else SEED_GROUPS.push({ head: group, ids: [id] });
}

export const DEFAULT_SEED_ID: SeedId =
  "getting-started" in SEEDS ? "getting-started" : Object.keys(SEEDS)[0] ?? "getting-started";

export async function clearAndLoadSeed(id: SeedId): Promise<boolean> {
  const seed = SEEDS[id];
  if (!seed) return false;
  await loadGraph(seed.graph);
  return true;
}
