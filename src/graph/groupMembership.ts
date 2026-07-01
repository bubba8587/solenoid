import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode } from "./rete-nodes";
import { resolveColor } from "./palette";

// ─── Group membership store ─────────────────────────────────────────────────────
// Maps a member node id → its group's color (resolved to a HEX here, so consumers
// like NodeCard get a paint-ready value), so a node card can show a subtle
// "inside a group" indicator. Rebuilt whenever membership changes (create /
// reconcile / delete / load). A module store because node cards render in a
// separate React root.

import { createNotifier } from "./storeKit";

const _byNode = new Map<string, string>();
const { notify, subscribe, version } = createNotifier();

export const groupMembershipStore = {
  /** The group color for a member node, or undefined if it's not in a group. */
  color: (nodeId: string): string | undefined => _byNode.get(nodeId),
  version,
  subscribe,
};

/** Recompute the node→group-color map from the current groups. */
export function rebuildGroupMembership(editor: NodeEditor<Schemes>): void {
  _byNode.clear();
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode) {
      for (const m of g.members) _byNode.set(m, resolveColor(g.color));
    }
  }
  notify();
}
