// [[C76]], [[C79]], [[C51]] formulaNaming
// A pack's formula functions are the core's (`fns_packs.rs`); a pack declares their signatures and owns their names,
// which the editor advertises only while the pack is on.
import { allPacks, packsStore } from "./packs";
import { formulaFunctionNames, FUNCTION_ARITY } from "./excelFunctions";
import type { PackFormula } from "./packs/packShared";
import { setPackLookup } from "./emptySlots";

const PACK_FORMULA_OWNER = new Map<string, string>();
const PACK_FORMULA_META = new Map<string, PackFormula>();

export function initPackFormulas(): void {
  for (const name of PACK_FORMULA_OWNER.keys()) delete FUNCTION_ARITY[name];
  PACK_FORMULA_OWNER.clear();
  PACK_FORMULA_META.clear();
  cachedVersion = -1;
  for (const p of allPacks()) {
    for (const f of p.formulas ?? []) {
      const name = f.name.toUpperCase();
      const claimed = PACK_FORMULA_OWNER.get(name);
      if (claimed) {
        throw new Error(`Pack "${p.id}" declares formula ${name}, already claimed by pack "${claimed}"`);
      }
      PACK_FORMULA_OWNER.set(name, p.id);
      PACK_FORMULA_META.set(name, f);
      FUNCTION_ARITY[name] = f.arity;
    }
  }
}

export function packFormulaNames(): string[] {
  return [...PACK_FORMULA_OWNER.keys()];
}

export function packFormulaSignature(name: string): string | null {
  return PACK_FORMULA_META.get(name.toUpperCase())?.signature ?? null;
}

export function packFormulaMeta(name: string): PackFormula | undefined {
  return PACK_FORMULA_META.get(name.toUpperCase());
}
setPackLookup(packFormulaMeta);

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
