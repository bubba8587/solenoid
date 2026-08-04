// Dev-only consistency check for the catalog + Excel-mapping system.
// Called once at startup in development. Logs warnings to the console — never
// throws, so a stale entry can't break the app.
//
// STALENESS GUARD: every node that declares an Excel equivalence (NODE_EXCEL, or
// inline `excel` on a pack entry) must resolve to a real catalog node. This is
// what stops the Function Reference from silently going stale. (The reverse
// direction can't drift: EXCEL_TO_CATALOG is derived from this same metadata.)

import { NODE_EXCEL } from "./nodeExcel";
import { FLAT_CATALOG, classifyType, buildCatalog } from "./catalogUtils";
import type { CatalogEntry, CatalogCategory } from "./AddNodeMenu";

// Soft layout guidelines for the Add menu — flagged, never enforced. They can't
// be hard rules: packs extend the catalog at runtime, so a pack could legitimately
// push a category over. The warning just nudges toward grouping / flattening.
const MENU_MAX_ITEMS = 12;   // items shown in one (sub)menu before it feels long
const MENU_MAX_DEPTH = 3;    // submenu nesting levels before navigation feels deep

function isMenuCategory(e: CatalogEntry): e is CatalogCategory {
  return e.type === "category" && "children" in e;
}

// Walk the catalog tree (built with EVERY pack, activeOnly=false, so the check
// covers the full possible menu, not just what's switched on) and warn on any
// category that runs long or nests deep. Count is per ROW: a pair shows as one
// two-column row, so it counts once — the metric is the menu's visual length.
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

  // Best-effort built-in classification (Core Essentials vs Excel matchers).
  let core = 0, matcher = 0;
  for (const [type, entry] of FLAT_CATALOG) {
    if (entry.packs?.length) continue; // pack node — classified by its pack
    if (classifyType(type) === "matcher") matcher++; else core++;
  }
  console.debug(`[catalog] built-ins: ${matcher} Excel matchers, ${core} core essentials`);

  // Soft layout guidelines (full pack-inclusive catalog).
  checkMenuShape(buildCatalog(false), 1, "");
}
