// React Flow port (C0) — own seed glob. Deliberately NOT seeds.ts: that route
// imports persistence.ts and would drag the rete render stack into the harness.
import type { SavedGraphLite } from "./flowModel";

type SeedFile = SavedGraphLite & { label?: string; order?: number };

const modules = import.meta.glob<SeedFile>("../seedGraphs/*.json", {
  eager: true,
  import: "default",
});

export const FLOW_SEEDS: Record<string, { label: string; graph: SavedGraphLite }> = {};
const ordered = Object.entries(modules)
  .map(([path, mod]) => ({
    id: path.replace(/^.*\//, "").replace(/\.json$/, ""),
    mod,
  }))
  .sort((a, b) => (a.mod.order ?? 1000) - (b.mod.order ?? 1000) || a.id.localeCompare(b.id));
for (const { id, mod } of ordered) {
  FLOW_SEEDS[id] = { label: mod.label ?? id, graph: mod };
}

export const DEFAULT_SEED_ID: string =
  "getting-started" in FLOW_SEEDS ? "getting-started" : Object.keys(FLOW_SEEDS)[0];
