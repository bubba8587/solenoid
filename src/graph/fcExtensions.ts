// [[B15]] leanCore, [[C79]] packActivationIsPresentation
// Every pack's FC units and formats register for resolution; only active packs' entries reach the dropdowns.

import { allPacks, packsStore } from "./packs";
import {
  registerPackUnits, registerPackFormats,
  type PackUnit, type PackFormat,
} from "./formatAnnotationStore";

/** Call once at startup. */
export function initPackFcExtensions(): void {
  for (const p of allPacks()) {
    if (p.units) registerPackUnits(p.units);
    if (p.formats) registerPackFormats(p.formats);
  }
}

export function activePackUnits(): PackUnit[] {
  return allPacks().filter((p) => packsStore.isActive(p.id)).flatMap((p) => p.units ?? []);
}

export function activePackFormats(): PackFormat[] {
  return allPacks().filter((p) => packsStore.isActive(p.id)).flatMap((p) => p.formats ?? []);
}
