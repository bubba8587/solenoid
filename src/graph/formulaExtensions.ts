// [[C76]], [[C79]], [[C51]] formulaNaming
// Must stay out of `excelFormula.ts`, where importing packs would cycle.

import { allPacks, packsStore } from "./packs";
import { registerInternal, unregisterInternal, internalFunctionNames, FX_FUNCTION_NAMES, EXCEL_IMPL_META } from "./excelFunctions";
import { formulaFunctionNames } from "./excelFormula";
import type { PackFormula } from "./packs/packShared";

let coreNames: Set<string> | null = null;

const PACK_FORMULA_OWNER = new Map<string, string>();
const PACK_FORMULA_META = new Map<string, PackFormula>();

export function initPackFormulas(): void {
  // Snapshot on the first call only: a re-run against the live registry would reject its own earlier registrations as core names.
  if (!coreNames) {
    coreNames = new Set([...internalFunctionNames(), ...FX_FUNCTION_NAMES].map((n) => n.toUpperCase()));
  }

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

export function packFormulaNames(): string[] {
  return [...PACK_FORMULA_OWNER.keys()];
}

export function packFormulaSignature(name: string): string | null {
  return PACK_FORMULA_META.get(name.toUpperCase())?.signature ?? null;
}

let cachedNames: string[] = [];
let cachedVersion = -1;

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
