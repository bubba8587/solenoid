// Bridges packs → the formula language (D19 decision 3). Sibling of
// `fcExtensions.ts`. RESOLUTION is global (every KNOWN pack registers at startup, so
// a deactivated pack's functions still compute); ADVERTISING is active-only.
//
// Must live outside `excelFormula.ts`: packs import node classes, which import the
// formula engine, so a packs import there would cycle.

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

/** Register every known pack's formula functions for resolution. Call once at
 *  startup, alongside `initPackFcExtensions`.
 *
 *  A pack may not claim a name the core already dispatches, or one another pack
 *  already claimed — a collision THROWS at startup rather than silently shadowing
 *  a built-in. */
export function initPackFormulas(): void {
  // Snapshotted on the FIRST call only (after every core registration has run at
  // module load): against the LIVE registry a re-run would see its own previous
  // registrations as core names and reject every one of them. Covers Formula.js's
  // exports too — a pack claiming SUMPRODUCT must be caught even though nothing
  // registered it — plus the blocked spellings a pack must not quietly revive.
  if (!coreNames) {
    coreNames = new Set([...internalFunctionNames(), ...FX_FUNCTION_NAMES].map((n) => n.toUpperCase()));
  }

  // Withdraw the previous run's registrations, so a pack that is no longer present
  // stops answering instead of lingering as a ghost function.
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

// Highlighting runs on every keystroke while the advertised set changes only on a
// pack toggle, so it's memoized against the store's version counter.
let cachedNames: string[] = [];
let cachedVersion = -1;

/** The function names the EDITOR should offer and highlight: everything the core
 *  registers, plus the functions of currently-ACTIVE packs. Inactive packs' names
 *  still dispatch — they just aren't advertised. */
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
