// [[D22]] oneNamePerCard
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

// A card's catalog name, handed in by catalogUtils.ts: importing the catalog here would close a cycle through the cards.
let catalogName: (node: object) => string | null = () => null;
export function setCatalogNamer(namer: (node: object) => string | null): void {
  catalogName = namer;
}

/** A card's name as its header shows it: its label, else its catalog name. */
export function cardName(node: GraphNode | undefined): string {
  const label = (node as { label?: string } | undefined)?.label?.trim();
  return label || (node ? (catalogName(node) ?? "") : "");
}

interface NamedInputs { id: string; _sourceNames: Record<string, string> }

/** Stamps each Input Switch's inputs with their source cards' names, before a pass: the rows show them and Many
 *  mode names its cube's rows by them. Returns the switches whose names changed. */
export function resolveSwitchNames(editor: AnyEditor): NamedInputs[] {
  const changed: NamedInputs[] = [];
  for (const node of editor.getNodes()) {
    if (!("_sourceNames" in node)) continue;
    const sw = node as unknown as NamedInputs;
    const names: Record<string, string> = {};
    for (const c of editor.getConnections()) {
      if (c.target === sw.id && typeof c.targetInput === "string") names[c.targetInput] = cardName(editor.getNode(c.source));
    }
    if (JSON.stringify(names) !== JSON.stringify(sw._sourceNames)) { sw._sourceNames = names; changed.push(sw); }
  }
  return changed;
}
