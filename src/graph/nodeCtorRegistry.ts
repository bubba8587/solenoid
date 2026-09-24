// [[B12]] losslessSaves
import { ClassicPreset } from "rete";
import { FLAT_CATALOG } from "./catalogUtils";

// Derived by calling every catalog factory once, lazily, and cached.

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
      // A factory that can't construct standalone is skipped; that type won't round-trip.
    }
  }
  _ctorByName = m;
  return m;
}
