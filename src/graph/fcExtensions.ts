// EVERY known pack's units/formats register for resolution, so a saved graph still renders
// a deactivated pack's unit; only ACTIVE packs' entries reach the dropdowns. The one module
// that knows both packs and the FC store, keeping each side agnostic of the other.

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
