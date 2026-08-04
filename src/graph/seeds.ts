import { loadGraph } from "./persistence";
import type { SavedGraph } from "./persistence";

// ─── Seed graphs ──────────────────────────────────────────────────────────────
// Seeds are plain JSON files in ./seedGraphs/ — the SAME shape serializeGraph
// produces. Drop a new `*.json` in that folder and it shows up in the seed menu
// automatically; no code change.

// A seed file is the exported-graph shape plus two optional menu-only fields:
// `label` (display name) and `order` (sort key for the "New from example" list —
// lower floats higher; unset defaults to DEFAULT_ORDER, keeping the rest in
// alphabetical file order). loadGraph/validateSavedGraph ignore both.
type SeedFile = SavedGraph & { label?: string; order?: number };
const DEFAULT_ORDER = 1000;

// Vite inlines every matching JSON at build time. `import: "default"` hands us
// the parsed object directly.
const modules = import.meta.glob<SeedFile>("./seedGraphs/*.json", {
  eager: true,
  import: "default",
});

function idFromPath(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.json$/, "");
}

// "getting-started" → "Getting Started" (fallback when the file has no label).
function labelFromId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type SeedId = string;

// Build in display order: by `order` ascending, then alphabetically by id. Object
// insertion order is what the menu renders (DocumentTitle maps Object.entries).
export const SEEDS: Record<string, { label: string; graph: SavedGraph }> = {};
const ordered = Object.entries(modules)
  .map(([path, mod]) => ({ id: idFromPath(path), mod, order: mod.order ?? DEFAULT_ORDER }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
for (const { id, mod } of ordered) {
  SEEDS[id] = { label: mod.label ?? labelFromId(id), graph: mod };
}

// The seed loaded on a fresh start (no autosave). Falls back to whatever seed
// exists if "getting-started" isn't present yet.
export const DEFAULT_SEED_ID: SeedId =
  "getting-started" in SEEDS ? "getting-started" : Object.keys(SEEDS)[0] ?? "getting-started";

/** Replace the current graph with the named seed. Returns false if unknown. */
export async function clearAndLoadSeed(id: SeedId): Promise<boolean> {
  const seed = SEEDS[id];
  if (!seed) return false;
  await loadGraph(seed.graph); // loadGraph clears, rebuilds, reprocesses, and zooms
  return true;
}
