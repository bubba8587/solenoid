// [[B3]] sameNodeEverywhere
// Which shipped examples use each card, so the Reference can open one that shows it working.
import { SEEDS, SEED_GROUPS, type SeedId } from "./seeds";
import { catalogTypeFor } from "./catalogUtils";

let _index: Map<string, SeedId[]> | null = null;

/** The listed examples (in menu order) that place a card of this catalog type, each named once. */
export function examplesUsing(type: string): { id: SeedId; label: string }[] {
  if (!_index) {
    _index = new Map();
    for (const id of SEED_GROUPS.flatMap((g) => g.ids)) {
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
