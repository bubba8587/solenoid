// Pack registry + activation store (definitions live under src/graph/packs/).
// Activation filters the Add menu ONLY — every pack's constructors stay registered,
// so a saved graph using a deactivated pack's node still loads.

import { createNotifier } from "./storeKit";
import { GEOMETRY_PACK } from "./packs/geometry";
import { TIMESAVERS_PACK } from "./packs/timesavers";
import { ELECTRICITY_PACK } from "./packs/electricity";
import { ELECTROMAGNETISM_PACK } from "./packs/electromagnetism";
import { HEALTH_PACK } from "./packs/health";
import { FLUIDS_PACK } from "./packs/fluids";
import { THERMO_PACK } from "./packs/thermo";
import { SETS_PACK } from "./packs/sets";
import { EARTHSKY_PACK } from "./packs/earthsky";
import { CHEMISTRY_PACK } from "./packs/chemistry";
import type { Pack, PackPlacement } from "./packs/packShared";

// Re-export the authoring types so existing consumers keep one import site.
export type { Pack, PackPlacement, FormulaPackEntry } from "./packs/packShared";

export const BUILTIN_PACKS: Pack[] = [
  GEOMETRY_PACK,
  TIMESAVERS_PACK,
  ELECTRICITY_PACK,
  ELECTROMAGNETISM_PACK,
  HEALTH_PACK,
  FLUIDS_PACK,
  THERMO_PACK,
  SETS_PACK,
  EARTHSKY_PACK,
  CHEMISTRY_PACK,
];

// Node `type` → the pack id(s) claiming it: re-homes nodes already in NODE_CATALOG,
// unlike `nodes`, which adds pack-only ones.
export const NODE_PACK_TAGS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const p of BUILTIN_PACKS) {
    for (const type of p.tags ?? []) (out[type] ??= []).push(p.id);
  }
  return out;
})();

// Custom packs loaded from the user data folder. Stubbed for now.
export interface CustomPack extends Pack { source: string }

/** Where users will drop custom packs. Shown in Settings; not yet read. */
export function customPacksFolder(): string {
  return "<app data>/Solenoid/packs";
}

/** Stub — returns none until filesystem access and the pack format are settled. */
export function loadCustomPacks(): CustomPack[] {
  return [];
}

export function allPacks(): Pack[] {
  return [...BUILTIN_PACKS, ...loadCustomPacks()];
}

// A placement carrying its owning pack's identity — the catalog builder's input.
export interface PlacedPackNode {
  packId: string;
  packName: string;
  placement: PackPlacement;
}

/** Pack node placements, optionally only from active packs. */
export function packPlacements(opts: { activeOnly: boolean }): PlacedPackNode[] {
  if (!_initialised) initPacks();
  const packs = opts.activeOnly ? allPacks().filter((p) => _active.has(p.id)) : allPacks();
  const out: PlacedPackNode[] = [];
  for (const p of packs) {
    for (const placement of p.nodes ?? []) out.push({ packId: p.id, packName: p.name, placement });
  }
  return out;
}

const LS_KEY = "solenoid.packs";
let _active = new Set<string>();
let _initialised = false;
const { notify, subscribe, version } = createNotifier();
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify([..._active])); }
  catch { /* private mode / quota — non-fatal */ }
}

/** Read persisted pack activation (falling back to each pack's default). */
export function initPacks(): void {
  let saved: string[] | null = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) saved = JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  _active = new Set(
    saved ?? allPacks().filter((p) => p.defaultActive).map((p) => p.id),
  );
  _initialised = true;
}

export const packsStore = {
  isActive: (id: string) => _active.has(id),
  setActive(id: string, on: boolean) {
    if (on === _active.has(id)) return;
    if (on) {
      _active.add(id);
      // Transitively activate dependencies so the pack's nodes resolve.
      const seen = new Set<string>([id]);
      const queue = [...(allPacks().find((p) => p.id === id)?.dependsOn ?? [])];
      while (queue.length) {
        const dep = queue.shift()!;
        if (seen.has(dep)) continue;
        seen.add(dep);
        _active.add(dep);
        queue.push(...(allPacks().find((p) => p.id === dep)?.dependsOn ?? []));
      }
    } else {
      _active.delete(id);
      // Dependents are left active — harmless, and avoids surprise cascades.
    }
    persist();
    notify();
  },
  toggle(id: string) { this.setActive(id, !_active.has(id)); },
  version,
  subscribe,
};
