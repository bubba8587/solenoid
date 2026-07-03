import { ClassicPreset } from "rete";
import { FLAT_CATALOG } from "./catalogUtils";

// ─── Class-name → constructor registry, derived from the Add-menu catalog ───────
// Every catalog leaf is a factory for one of our node classes; calling each once
// and recording its constructor gives a complete name→Ctor map without hand-
// listing ~150 classes. Built lazily and cached. Shared by persistence.ts (the
// top-level graph loader) and composite.ts (a Composite node's own internal
// subgraph, which is serialized independently of the outer graph — see
// CompositeNode.hydrate).

export type NodeCtor = new (init?: Record<string, unknown>) => ClassicPreset.Node;

let _ctorByName: Map<string, NodeCtor> | null = null;

export function ctorRegistry(): Map<string, NodeCtor> {
  if (_ctorByName) return _ctorByName;
  const m = new Map<string, NodeCtor>();
  for (const entry of FLAT_CATALOG.values()) {
    try {
      const inst = entry.create() as ClassicPreset.Node;
      const ctor = inst.constructor as NodeCtor;
      if (!m.has(ctor.name)) m.set(ctor.name, ctor);
    } catch {
      // A factory that can't construct standalone is skipped — it just won't
      // round-trip (none currently do this).
    }
  }
  _ctorByName = m;
  return m;
}
