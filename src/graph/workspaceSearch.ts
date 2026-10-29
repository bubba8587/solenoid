// [[C132]] workspaceTree. The Navigator's Everywhere search; workspace-tree.md § The pane.
import { nodeTypeName } from "./nodeNamer";
import { nodeName } from "./catalogUtils";

export type SearchDoc = {
  id: string;
  name: string;
  folder: string;
  graph: { nodes: { type: string; name?: string; init?: unknown }[] };
};
export type SearchHit =
  | { kind: "doc"; docId: string; label: string; detail: string }
  | { kind: "node"; docId: string; label: string; detail: string; nodeName?: string; nodeType: string; nodeLabel: string };

/** What the card's header shows: its saved title, else its catalog name (by op), else its type's name, as `nodeDisplayName`. */
export function savedNodeLabel(n: { type: string; init?: unknown }): string {
  const init = n.init as { label?: unknown; op?: unknown } | undefined;
  const label = init?.label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const shape = { constructor: { name: n.type }, op: init?.op };
  return nodeName(shape) ?? nodeTypeName(shape);
}

/** Documents whose name or folder matches, then cards whose title or type matches, the open document's cards left to the outline. */
export function searchLibrary(docs: SearchDoc[], currentId: string | null, query: string, maxNodes = 60): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const where = (d: SearchDoc) => (d.folder ? `${d.folder.replace(/\//g, " › ")} › ${d.name}` : d.name);
  const hits: SearchHit[] = [];
  for (const d of docs) {
    if (d.name.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q)) {
      hits.push({ kind: "doc", docId: d.id, label: d.name, detail: d.folder.replace(/\//g, " › ") });
    }
  }
  let nodes = 0;
  for (const d of docs) {
    if (d.id === currentId) continue;
    for (const n of d.graph.nodes) {
      if (nodes >= maxNodes) return hits;
      if (n.type === "FormatControllerNode") continue;
      const label = savedNodeLabel(n);
      const type = nodeTypeName({ constructor: { name: n.type } });
      if (!label.toLowerCase().includes(q) && !type.toLowerCase().includes(q)) continue;
      hits.push({ kind: "node", docId: d.id, label, detail: where(d), nodeName: n.name, nodeType: n.type, nodeLabel: label });
      nodes++;
    }
  }
  return hits;
}
