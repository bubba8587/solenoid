// [[B3]] sameNodeEverywhere
// Which shipped examples use each card, so the Reference can open one that shows it working.
import { SEEDS, SEED_GROUPS, type SeedId } from "./seeds";
import { allPacks } from "./packs";
import { catalogTypeFor } from "./catalogUtils";

let _index: Map<string, SeedId[]> | null = null;

/** The listed examples (in menu order) that place a card of this catalog type, each named once. */
export function examplesUsing(type: string): { id: SeedId; label: string }[] {
  if (!_index) {
    _index = new Map();
    // The release notes document what changed, so they don't stand as an example of any one card.
    // Each pack's example stands for its pack's cards, offered whether or not the pack is on (a pack card's page is).
    const listed = [...SEED_GROUPS.flatMap((g) => g.ids), ...allPacks().map((p) => p.seed).filter((id) => id in SEEDS)];
    for (const id of listed.filter((id) => id !== "whats-new")) {
      const nodes = (SEEDS[id].graph as { nodes?: { type?: string; init?: { op?: unknown } }[] }).nodes ?? [];
      const types = new Set<string>();
      for (const n of nodes) {
        const t = n.type ? catalogTypeFor(n.type, n.init?.op) : null;
        if (t) types.add(t);
      }
      for (const t of types) (_index.get(t) ?? _index.set(t, []).get(t)!).push(id);
    }
  }
  return (_index.get(type) ?? []).map((id) => ({ id, label: SEEDS[id].label }));
}
