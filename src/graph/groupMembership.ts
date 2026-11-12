// [[group-expand-push#A node joins or leaves a group only when you put it there]], [[A1]] visualGraphCalculator
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";
import { GroupNode } from "./nodeClasses";
import { resolveColor, paletteStore } from "./palette";
import { createNotifier } from "./storeKit";

const _byNode = new Map<string, string>();
// Ids each editor contributed, so a rebuild for one graph (a drill-in) never wipes another's memberships in this app-wide map.
const _byEditor = new WeakMap<GraphEditor<Schemes>, Set<string>>();
const { notify, subscribe, version } = createNotifier();
// The map holds palette slots and `color` resolves them, so a palette change only has to redraw.
paletteStore.subscribe(notify);

export const groupMembershipStore = {
  color: (nodeId: string): string | undefined => { const slot = _byNode.get(nodeId); return slot === undefined ? undefined : resolveColor(slot); },
  version,
  subscribe,
};

/** Takes deleted cards out of every group that held them, so no group (nor the save written from it) names a card that
 *  is gone. A relocation (Wrap as Composite) moves members itself, so only a real delete calls this. */
export function dropFromGroups(editor: GraphEditor<Schemes>, gone: ReadonlySet<string>): void {
  if (gone.size === 0) return;
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.some((m) => gone.has(m))) g.members = g.members.filter((m) => !gone.has(m));
  }
}

export function rebuildGroupMembership(editor: GraphEditor<Schemes>): void {
  for (const id of _byEditor.get(editor) ?? []) _byNode.delete(id);
  const mine = new Set<string>();
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode) {
      for (const m of g.members) { _byNode.set(m, g.color); mine.add(m); }
    }
  }
  _byEditor.set(editor, mine);
  notify();
}
