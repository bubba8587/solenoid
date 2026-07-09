// ─── Node packs ─────────────────────────────────────────────────────────────────
// A "pack" is an additive bundle layered on top of the permanent core catalog
// (Solenoid controls + Excel-matcher nodes, which are never toggleable). Packs are
// how node domains — geometry, timesavers, engineering references — ship and
// switch on/off.
//
// Each pack's DEFINITION lives in its own file under src/graph/packs/ (built on
// packs/packShared.ts — the authoring types + the formula-preset helper). This
// module is the registry + activation store.
//
// Placement, not a separate subtree: a pack's nodes are INSERTED into the existing
// Add-menu category tree (or the catch-all "Other" category) at a target path, so
// activating a pack never grows the top-level menu. Each placed node is marked with
// a subtle "from a pack" indicator (see AddNodeMenu). A node `type` may be claimed
// by several packs (e.g. HYPOTENUSE is both Geometry and Timesavers) — the catalog
// builder inserts it once and records every owning pack (catalogUtils.buildCatalog).
//
// Activation is a PRESENTATION filter only:
//   • The Add menu shows a pack's nodes only while it (or another pack claiming the
//     same type) is active.
//   • Every pack's node constructors are ALWAYS registered (nodeRegistry +
//     FLAT_CATALOG over all packs), so a saved graph using a node from a deactivated
//     pack still loads and renders. Deactivating never breaks a file.
//
// Custom packs (dropped into a user data folder) are stubbed: the interface and
// loader exist, but loading real packs is a later step (needs the desktop shell's
// filesystem access + a settled pack format). The web build has no folder.

import { createNotifier } from "./storeKit";
import { GEOMETRY_PACK } from "./packs/geometry";
import { TIMESAVERS_PACK } from "./packs/timesavers";
import { ELECTRICITY_PACK } from "./packs/electricity";
import type { Pack, PackPlacement } from "./packs/packShared";

// Re-export the authoring types so existing consumers keep one import site.
export type { Pack, PackPlacement, FormulaPackEntry } from "./packs/packShared";

export const BUILTIN_PACKS: Pack[] = [
  GEOMETRY_PACK,
  TIMESAVERS_PACK,
  ELECTRICITY_PACK,
];

// Reclassification of EXISTING core catalog nodes into add-on packs — a node
// `type` → the pack id(s) that claim it. Derived from each pack's `tags`.
// Unlike `nodes` (which add NEW pack-only nodes), these re-home nodes already
// defined in NODE_CATALOG: the catalog builder marks them with the pack
// indicator and hides them when all their packs are off.
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

/** Load custom packs from the user data folder. Stub — returns none until the
 *  desktop shell wires up filesystem access and the pack format is settled. */
export function loadCustomPacks(): CustomPack[] {
  return [];
}

/** Every pack the app knows about (built-in + any loaded custom). */
export function allPacks(): Pack[] {
  return [...BUILTIN_PACKS, ...loadCustomPacks()];
}

// A pack node placement carrying its owning pack's identity — what the catalog
// builder consumes to insert + tag + dedupe.
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

// ─── Active-state store (persisted) ─────────────────────────────────────────────
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
      // Pull in dependencies so the pack's nodes resolve (a pack may build on
      // another's). Transitive, guarded against cycles by the visited set.
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
