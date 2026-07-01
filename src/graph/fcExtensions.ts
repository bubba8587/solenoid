// Bridges packs → Format Controller. Every known pack's units/formats are
// registered for resolution at startup, so a saved graph that uses a pack's
// unit/format still renders even when the pack is deactivated — mirroring how
// pack node constructors are always registered. The FC dropdowns, in contrast,
// offer only ACTIVE packs' entries (the activePack* helpers below).
//
// This module is the only place that knows BOTH packs and the FC store, keeping
// formatAnnotationStore pack-agnostic (it just holds the merged resolution maps)
// and packs.ts FC-agnostic (it just declares unit/format data).

import { allPacks, packsStore } from "./packs";
import {
  registerPackUnits, registerPackFormats,
  type PackUnit, type PackFormat,
} from "./formatAnnotationStore";

/** Register every known pack's FC units/formats for resolution. Call once at startup. */
export function initPackFcExtensions(): void {
  for (const p of allPacks()) {
    if (p.units) registerPackUnits(p.units);
    if (p.formats) registerPackFormats(p.formats);
  }
}

/** Units contributed by currently-active packs (for the FC unit dropdown). */
export function activePackUnits(): PackUnit[] {
  return allPacks().filter((p) => packsStore.isActive(p.id)).flatMap((p) => p.units ?? []);
}

/** Number formats contributed by currently-active packs (for the FC format dropdown). */
export function activePackFormats(): PackFormat[] {
  return allPacks().filter((p) => packsStore.isActive(p.id)).flatMap((p) => p.formats ?? []);
}
