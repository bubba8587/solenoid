import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { resolveColor } from "./palette";

// Member node id → its group's color, resolved to a HEX here so consumers get a paint-ready
// value.

import { createNotifier } from "./storeKit";

const _byNode = new Map<string, string>();
// Ids each editor contributed, so a rebuild for one graph (a composite drill-in) never
// wipes another's memberships: the map is app-wide, the groups are per editor.
const _byEditor = new WeakMap<NodeEditor<Schemes>, Set<string>>();
const { notify, subscribe, version } = createNotifier();

export const groupMembershipStore = {
  /** The group color for a member node, or undefined if it's not in a group. */
  color: (nodeId: string): string | undefined => _byNode.get(nodeId),
  version,
  subscribe,
};

/** Recompute the node→group-color map from the current groups. */
export function rebuildGroupMembership(editor: NodeEditor<Schemes>): void {
  for (const id of _byEditor.get(editor) ?? []) _byNode.delete(id);
  const mine = new Set<string>();
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode) {
      for (const m of g.members) { _byNode.set(m, resolveColor(g.color)); mine.add(m); }
    }
  }
  _byEditor.set(editor, mine);
  notify();
}
