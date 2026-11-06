// [[C79]] packActivationIsPresentation
// What in a saved graph belongs to a pack: a card only a pack places, a pack's formula preset, a pack's formula
// function in a node's text, or a core card a pack claims (its tags). The seed tests read it both ways: a pack's
// seed shows its own pack, and a default seed shows none.
import { BUILTIN_PACKS } from "../../src/graph/packs";
import { NODE_CATALOG } from "../../src/graph/nodeCatalog";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import type { CatalogEntry, NodeCatalogEntry } from "../../src/graph/AddNodeMenu";

type SavedNode = { id: string; type: string; init?: Record<string, unknown> };
type Made = { constructor: { name: string }; op?: unknown; expr?: unknown };

function leaves(entries: CatalogEntry[]): NodeCatalogEntry[] {
  return entries.flatMap((e) => ("children" in e ? leaves((e as { children: CatalogEntry[] }).children) : [e as NodeCatalogEntry]));
}

const make = (entry: NodeCatalogEntry) => entry.create() as Made;
const coreMade = leaves(NODE_CATALOG).map(make);
const CORE_CLASSES = new Set(coreMade.map((m) => m.constructor.name));
const CORE_OPS = new Set(coreMade.map((m) => `${m.constructor.name}/${String(m.op)}`));

/** Each pack's marks: the classes only it places, its presets' formulas, its function names, the core cards it claims. */
export const PACK_MARKS = BUILTIN_PACKS.map((p) => {
  const placed = (p.nodes ?? []).map((n) => make(n.entry));
  const tagged = (p.tags ?? []).flatMap((t) => (FLAT_CATALOG.get(t) ? [make(FLAT_CATALOG.get(t)!)] : []));
  // A core class the pack places at an op no core entry offers (Mann–Whitney on the hypothesis-test card) is the pack's too.
  const placedOps = placed.filter((m) => m.op !== undefined && CORE_CLASSES.has(m.constructor.name) && !CORE_OPS.has(`${m.constructor.name}/${String(m.op)}`));
  return {
    id: p.id,
    classes: new Set(placed.map((m) => m.constructor.name).filter((c) => !CORE_CLASSES.has(c))),
    presets: new Set(placed.filter((m) => typeof m.expr === "string").map((m) => m.expr as string)),
    functions: (p.formulas ?? []).map((f) => f.name),
    claimed: [...tagged, ...placedOps].map((m) => ({ cls: m.constructor.name, op: m.op })),
  };
});

const textOf = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(textOf) : v && typeof v === "object" ? Object.values(v).flatMap(textOf) : [];

/** Every pack mark a node carries, as "pack: what". */
export function packMarksOf(node: SavedNode): string[] {
  const init = node.init ?? {};
  const text = textOf(init).join("\n");
  const out: string[] = [];
  for (const m of PACK_MARKS) {
    if (m.classes.has(node.type)) out.push(`${m.id}: ${node.type}`);
    if ((node.type === "ExpressionNode" || node.type === "EquationNode") && init.locked && m.presets.has(String(init.expr))) {
      out.push(`${m.id}: preset ${String(init.label ?? init.expr)}`);
    }
    for (const f of m.functions) if (new RegExp(`\\b${f.replace(".", "\\.")}\\s*\\(`, "i").test(text)) out.push(`${m.id}: ${f}()`);
    for (const c of m.claimed) if (c.cls === node.type && (c.op === undefined || c.op === init.op)) out.push(`${m.id}: claims ${node.type}${c.op ? `/${String(c.op)}` : ""}`);
  }
  return out;
}
