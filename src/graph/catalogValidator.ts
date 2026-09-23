// [[C8]] declareOnce

import { NODE_EXCEL } from "./nodeExcel";
import { FLAT_CATALOG, classifyType, buildCatalog } from "./catalogUtils";
import type { CatalogEntry, CatalogCategory } from "./AddNodeMenu";

const MENU_MAX_ITEMS = 12;
const MENU_MAX_DEPTH = 3;

function isMenuCategory(e: CatalogEntry): e is CatalogCategory {
  return e.type === "category" && "children" in e;
}

function checkMenuShape(entries: CatalogEntry[], depth: number, trail: string): void {
  for (const e of entries) {
    if (!isMenuCategory(e)) continue;
    const path = trail ? `${trail} › ${e.label}` : e.label;
    const rows = e.children.length;
    if (rows > MENU_MAX_ITEMS) {
      console.warn(`[catalog] menu "${path}" has ${rows} rows (soft max ${MENU_MAX_ITEMS}) — consider folding some into a submenu. Not an error.`);
    }
    if (depth > MENU_MAX_DEPTH) {
      console.warn(`[catalog] menu "${path}" is ${depth} submenu levels deep (soft max ${MENU_MAX_DEPTH}) — consider flattening. Not an error.`);
    }
    checkMenuShape(e.children, depth + 1, path);
  }
}

export function validateCatalog(): void {
  let issues = 0;

  for (const type of Object.keys(NODE_EXCEL)) {
    if (!FLAT_CATALOG.has(type)) {
      console.warn(`[catalog] NODE_EXCEL has Excel metadata for "${type}" but no such catalog node exists — remove the stale entry or fix the type`);
      issues++;
    }
  }

  if (issues === 0) {
    console.debug("[catalog] validation passed");
  } else {
    console.warn(`[catalog] ${issues} issue(s) found — check nodeExcel.ts`);
  }

  let core = 0, matcher = 0;
  for (const [type, entry] of FLAT_CATALOG) {
    if (entry.packs?.length) continue;
    if (classifyType(type) === "matcher") matcher++; else core++;
  }
  console.debug(`[catalog] built-ins: ${matcher} Excel matchers, ${core} core essentials`);

  checkMenuShape(buildCatalog(false), 1, "");
}
