// Bridges packs → the formula language (D19 decision 4). Direct sibling of
// `fcExtensions.ts`, and deliberately the same shape:
//
//   RESOLUTION is global — every KNOWN pack's functions register at startup, so a
//   saved graph that calls one still COMPUTES when the pack is deactivated. That
//   isn't leniency, it's the pack-architecture guarantee: a formula pack node
//   serializes as a plain ExpressionNode and reloads with its pack off, so the
//   functions its formula calls have to keep answering. A deactivated pack that
//   turned working documents into #NAME? would be a data-loss bug.
//
//   "KNOWN" is doing real work in that sentence, and the guarantee stops there.
//   DEACTIVATED (in `allPacks()`, toggled off) resolves; ABSENT (never installed, or
//   removed from the packs folder) cannot — a `PackFormula.impl` is a JS function
//   that ships inside the pack, so with the pack gone there is nothing to call. This
//   is the same line `pack-architecture.md` draws between a pre-set-formula pack node
//   (data — the core compiler evaluates it with the pack absent) and a custom-LOGIC
//   node (code — goes inert). A pack FUNCTION is on the custom-logic side.
//
//   The unsolved part is DIAGNOSIS, and it is narrower than the placeholder plan
//   covers: placeholders degrade a missing pack NODE, but a pack function called from
//   an ExpressionNode the user typed by hand is not a pack node, so nothing degrades
//   it — the formula just reports an unknown function without naming the pack that
//   would provide it. Fixing that needs the unbuilt "saved files record their required
//   packs + versions" half (pack-architecture.md; backlog "Pack distribution").
//
//   ADVERTISING is active-only — highlighting and autocomplete offer a pack's
//   functions only while it's on, so an off pack doesn't teach a name the Add menu
//   isn't showing.
//
// This module is the only place that knows BOTH packs and the formula registry,
// which keeps `excelFunctions` pack-agnostic and `packs.ts` formula-agnostic. It
// also has to live outside `excelFormula.ts`: packs import node classes, which
// import the formula engine, so a packs import there would cycle.

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
 *  already claimed: silently shadowing a built-in is precisely the drift D19
 *  exists to stop, so a collision throws at startup where it's obvious, rather
 *  than changing what SUM means three screens later. */
export function initPackFormulas(): void {
  // Snapshotted on the FIRST call, which is after every core registration has run
  // at module load. Without it the check would compare against the live registry,
  // where this function's OWN previous registrations look exactly like core ones —
  // so a re-run (custom packs reloaded, a pack list rebuilt) would reject every
  // name it had just registered itself.
  // Every name that could already resolve: the registry's own impls AND Formula.js's
  // exports (a pack claiming SUMPRODUCT must be caught even though nothing registered
  // it), plus the blocked spellings, which a pack must not quietly revive.
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

// The advertised set changes only when a pack is toggled, while highlighting runs
// on every keystroke — so it's memoized against the store's version counter
// rather than rebuilt per call.
let cachedNames: string[] = [];
let cachedVersion = -1;

/** The function names the EDITOR should offer and highlight: everything the core
 *  registers, plus the functions of currently-ACTIVE packs. Inactive packs' names
 *  still dispatch (see the module note) — they just aren't advertised. */
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
