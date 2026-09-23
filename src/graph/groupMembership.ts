// [[C86]] membershipByGesture, [[C87]] groupsAreSubflows
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { resolveColor } from "./palette";


import { createNotifier } from "./storeKit";

const _byNode = new Map<string, string>();
// Ids each editor contributed, so a rebuild for one graph (a drill-in) never wipes another's memberships in this app-wide map.
const _byEditor = new WeakMap<NodeEditor<Schemes>, Set<string>>();
const { notify, subscribe, version } = createNotifier();

export const groupMembershipStore = {
  color: (nodeId: string): string | undefined => _byNode.get(nodeId),
  version,
  subscribe,
};

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
