// Run with: npx tsx scripts/op-exposure.ts
//
// Which OPS of a multi-op node class are individually reachable from the Add menu?
//
// A node class with an op selector is a navigation convenience for closely-related
// operations — each op is its own function, and the author's intent is that they are
// normally ALSO individually listed in the Add menu, so nobody has to know which card
// hosts which op. This finds the ones that aren't, by instantiating every catalog leaf
// and comparing the ops actually reachable against the class's op table.
//
// Three buckets in the output, and only the FIRST is necessarily a gap:
//   • not fully exposed — the class has ops with no Add-menu entry of their own;
//   • ambiguous — the op-table join was inconclusive; check by hand;
//   • no op table — usually a CONFIG selector (a chart type, an element symbol, a
//     physical constant), where a single leaf is correct.

import * as fs from "node:fs";
import * as path from "node:path";
import { buildCatalog } from "../src/graph/catalogUtils";
import type { CatalogEntry, NodeCatalogEntry } from "../src/graph/AddNodeMenu";

const exposed = new Map<string, Set<string>>();
function walk(es: CatalogEntry[]) {
  for (const e of es) {
    if (e.type === "category" || e.type === "pair") { walk((e as { children: CatalogEntry[] }).children); continue; }
    const leaf = e as NodeCatalogEntry;
    if (leaf.hidden) continue;
    let inst: { constructor?: { name?: string }; op?: unknown };
    try { inst = leaf.create() as typeof inst; } catch { continue; }
    const cls = inst?.constructor?.name;
    if (!cls || typeof inst.op !== "string") continue;
    if (!exposed.has(cls)) exposed.set(cls, new Set());
    exposed.get(cls)!.add(inst.op);
  }
}
walk(buildCatalog(false));

(async () => {
  const metas: Array<{ name: string; keys: string[]; file: string }> = [];
  const dir = "src/graph/nodes";
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    let mod: Record<string, unknown>;
    try { mod = await import(path.resolve(dir, f)) as Record<string, unknown>; } catch { continue; }
    for (const [k, v] of Object.entries(mod)) {
      if (!/META$/.test(k) || !v || typeof v !== "object") continue;
      const keys = Object.keys(v as object);
      if (keys.length >= 2) metas.push({ name: k, keys, file: f });
    }
  }

  const rows: string[] = [], ambiguous: string[] = [], unmatched: string[] = [];
  for (const [cls, ops] of exposed) {
    let cands = metas.filter((m) => [...ops].every((o) => m.keys.includes(o)));
    if (cands.length === 0) { unmatched.push(`${cls} (ops: ${[...ops].join(", ")})`); continue; }
    if (cands.length > 1) {
      const stem = cls.replace(/Node$/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().split("_")[0];
      const byName = cands.filter((m) => m.name.startsWith(stem));
      if (byName.length === 1) cands = byName;
      else { ambiguous.push(`${cls} (${[...ops].join(", ")}) -> ${cands.map((c) => c.name).join(" | ")}`); continue; }
    }
    const m = cands[0];
    if (ops.size >= m.keys.length) continue;
    rows.push(`${cls} — ${ops.size}/${m.keys.length} | MISSING: ${m.keys.filter((k) => !ops.has(k)).join(", ")} | ${m.name} (${m.file})`);
  }
  rows.sort();
  console.log(`\nNot fully exposed in the Add menu (${rows.length}):\n`);
  for (const r of rows) console.log("  " + r);
  console.log(`\nAmbiguous join (${ambiguous.length}) — check by hand:\n`);
  for (const a of ambiguous) console.log("  " + a);
  console.log(`\nNo op table matched (${unmatched.length}) — usually a config selector, one leaf is right:\n`);
  for (const u of unmatched) console.log("  " + u);
  console.log();
})();
