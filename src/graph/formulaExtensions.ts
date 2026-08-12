// Packs → the formula language (D19 decision 3): RESOLUTION is global, ADVERTISING
// is active-only. Must stay out of `excelFormula.ts` — a packs import there cycles.

import { allPacks, packsStore } from "./packs";
import { registerInternal, unregisterInternal, internalFunctionNames, FX_FUNCTION_NAMES, EXCEL_IMPL_META } from "./excelFunctions";
import { formulaFunctionNames } from "./excelFormula";
import type { PackFormula } from "./packs/packShared";

/** The core's own dispatchable names, snapshotted before any pack registers. */
let coreNames: Set<string> | null = null;

/** name → the pack id that contributed it (every known pack, active or not). */
const PACK_FORMULA_OWNER = new Map<string, string>();
/** name → its declared signature/arity, for the editor hint. */
const PACK_FORMULA_META = new Map<string, PackFormula>();

/** Register every known pack's formula functions; a name the core or another pack
 *  already claims THROWS at startup rather than silently shadowing it. */
export function initPackFormulas(): void {
  // Snapshotted on the FIRST call only: against the LIVE registry a re-run would
  // see its own previous registrations as core names and reject every one.
  if (!coreNames) {
    coreNames = new Set([...internalFunctionNames(), ...FX_FUNCTION_NAMES].map((n) => n.toUpperCase()));
  }

  // Withdraw the previous run's registrations, so a removed pack stops answering.
  for (const name of PACK_FORMULA_OWNER.keys()) {
    unregisterInternal(name);
    delete EXCEL_IMPL_META[name];
  }
  PACK_FORMULA_OWNER.clear();
  PACK_FORMULA_META.clear();
  for (const p of allPacks()) {
    for (const f of p.formulas ?? []) {
      const name = f.name.toUpperCase();
      const claimed = PACK_FORMULA_OWNER.get(name);
      if (claimed) {
        throw new Error(`Pack "${p.id}" declares formula ${name}, already claimed by pack "${claimed}"`);
      }
      if (coreNames.has(name)) {
        throw new Error(`Pack "${p.id}" declares formula ${name}, which already exists in the core formula language`);
      }
      PACK_FORMULA_OWNER.set(name, p.id);
      PACK_FORMULA_META.set(name, f);
      registerInternal(name, f.impl);
      EXCEL_IMPL_META[name] = {
        returns: f.returns, arity: f.arity, native: true,
        ...(f.rank ? { rank: f.rank } : {}),
        ...(f.listArgs ? { listArgs: true } : {}),
      };
    }
  }
}

/** Every pack-contributed formula name (active or not). */
export function packFormulaNames(): string[] {
  return [...PACK_FORMULA_OWNER.keys()];
}

/** The curated argument hint a pack declared for one of its functions. */
export function packFormulaSignature(name: string): string | null {
  return PACK_FORMULA_META.get(name.toUpperCase())?.signature ?? null;
}

// Memoized against the store version: highlighting runs on every keystroke.
let cachedNames: string[] = [];
let cachedVersion = -1;

/** The names the EDITOR offers: the core plus ACTIVE packs — an inactive pack's
 *  functions still dispatch, they just aren't advertised. */
export function advertisedFunctionNames(): string[] {
  const v = packsStore.version();
  if (v === cachedVersion) return cachedNames;
  const hidden = new Set<string>();
  for (const [name, packId] of PACK_FORMULA_OWNER) {
    if (!packsStore.isActive(packId)) hidden.add(name);
  }
  const all = formulaFunctionNames();
  cachedNames = hidden.size === 0 ? all : all.filter((n) => !hidden.has(n.toUpperCase()));
  cachedVersion = v;
  return cachedNames;
}
