// [[B12]] losslessSaves, [[C86]] membershipByGesture
import type { GraphEditor } from "./graphEditor";
import { GraphConnection, GraphNode } from "./graphModel";
import type { Schemes, SolenoidNode, SolenoidConnection } from "./schemes";
import { dockedNodeStore } from "./dockedNodeStore";
import { selectNode, unselectAllNodes } from "./canvasCommands";
import { getCtorRegistry } from "./ctorProvider";
import { getActiveEditor, getActiveView, editScopeFor } from "./activeGraph";
import { nodeNameStore } from "./nodeNameStore";
import { savedNodeBody, restoreNodeState, savedSideTables, restoreSideTables, type SavedNodeBody, type SideTables } from "./savedNodeBody";
import { PlaceholderNode, placeholderFor } from "./nodes/placeholder";

// A snapshot taken at copy time, so a later edit or delete of the source never changes what pastes.
interface ClipboardEntry {
  id: string;
  Ctor: new (init?: Record<string, unknown>) => GraphNode;
  body: SavedNodeBody;
  /** Set on a placeholder: the socket keys a paste rebuilds it with. */
  sockets?: { inputs: string[]; outputs: string[] };
  x: number;
  y: number;
}

interface ClipboardData {
  entries: ClipboardEntry[];
  side: SideTables;
  connections: Array<{
    srcIdx: number;
    srcOutput: string;
    tgtIdx: number;
    tgtInput: string;
  }>;
}

let _clipboard: ClipboardData | null = null;

// By name, not instanceof: composite.ts imports this module.
const isMarker = (n: { constructor: { name: string } }) =>
  n.constructor.name === "CompositeInputNode" || n.constructor.name === "CompositeOutputNode";

/** The nodes a copy takes: the selection, a group's members and every docked FC riding a copied node, never a boundary marker. */
export function copySet(editor: GraphEditor<Schemes>): SolenoidNode[] {
  const ids = new Set<string>();
  for (const n of editor.getNodes()) {
    if (!n.selected) continue;
    ids.add(n.id);
    const members = (n as unknown as { members?: string[] }).members;
    if (Array.isArray(members)) for (const m of members) ids.add(m);
  }
  for (const id of [...ids]) for (const d of dockedNodeStore.getDockedTo(id)) ids.add(d.id);
  return editor.getNodes().filter((n) => ids.has(n.id) && !isMarker(n)) as SolenoidNode[];
}

function snapshotEntry(n: GraphNode, x: number, y: number): ClipboardEntry {
  const body = savedNodeBody(n);
  const sockets = n instanceof PlaceholderNode ? { inputs: Object.keys(n.inputs), outputs: Object.keys(n.outputs) } : undefined;
  return { id: n.id, Ctor: n.constructor as ClipboardEntry["Ctor"], body: { ...body, init: structuredClone(body.init) }, ...(sockets ? { sockets } : {}), x, y };
}

/** The side tables a paste carries: the card's own look. */
function pastedSideTables(owns: (id: string) => boolean): SideTables {
  const { frameFormats } = savedSideTables(owns);
  return frameFormats ? { frameFormats } : {};
}

export function copySelected() {
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view) return;

  const selected = copySet(editor);
  if (selected.length === 0) return;

  const selectedIds = new Set(selected.map((n) => n.id));
  const internalConns = editor.getConnections().filter(
    (c) => selectedIds.has(c.source) && selectedIds.has(c.target),
  );

  const positions = selected.map(
    (n) => view.position(n.id) ?? { x: 0, y: 0 },
  );
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));

  const idxMap = new Map(selected.map((n, i) => [n.id, i]));

  _clipboard = {
    entries: selected.map((n, i) => snapshotEntry(n, positions[i].x - minX, positions[i].y - minY)),
    side: pastedSideTables((id) => selectedIds.has(id)),
    connections: internalConns.map((c) => ({
      srcIdx: idxMap.get(c.source)!,
      srcOutput: c.sourceOutput,
      tgtIdx: idxMap.get(c.target)!,
      tgtInput: c.targetInput,
    })),
  };
}


function cloneEntry(e: ClipboardEntry): GraphNode | null {
  if (e.sockets) return placeholderFor({ ...e.body, init: structuredClone(e.body.init) }, e.sockets);
  try {
    const clone = new e.Ctor(structuredClone(e.body.init));
    // Restore the value maps after construction, or the constructor's own defaults overwrite them.
    const cloneAny = clone as unknown as Record<string, unknown>;
    if (e.body.literals) cloneAny.literals = { ...e.body.literals };
    if (e.body.stringLiterals) cloneAny.stringLiterals = { ...e.body.stringLiterals };
    return clone;
  } catch {
    return null;
  }
}

const PASTE_OFFSET = 30;

export async function pasteClipboard(canvasX: number, canvasY: number) {
  if (!_clipboard || _clipboard.entries.length === 0) return;
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view) return;
  const scope = editScopeFor(editor);

  const originX = canvasX + PASTE_OFFSET;
  const originY = canvasY + PASTE_OFFSET;

  const clip = _clipboard;
  const clones = clip.entries.map(cloneEntry);

  const oldToNew = new Map<string, string>();
  for (let i = 0; i < clones.length; i++) {
    if (clones[i]) oldToNew.set(clip.entries[i].id, clones[i]!.id);
  }
  for (const clone of clones) {
    if (!clone) continue;
    const ref = (clone instanceof PlaceholderNode ? clone.savedInit : clone) as unknown as
      { members?: string[]; hostNodeId?: string; steps?: Array<{ nodeIds?: string[] }> };
    if (Array.isArray(ref.members)) {
      ref.members = ref.members.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
    }
    if (typeof ref.hostNodeId === "string" && ref.hostNodeId) {
      ref.hostNodeId = oldToNew.get(ref.hostNodeId) ?? "";
    }
    if (Array.isArray(ref.steps)) {
      for (const step of ref.steps) {
        if (Array.isArray(step.nodeIds)) {
          step.nodeIds = step.nodeIds.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
        }
      }
    }
  }

  const toAdd: Array<{ clone: SolenoidNode; type: string; x: number; y: number }> = [];
  for (let i = 0; i < clones.length; i++) {
    const clone = clones[i];
    if (!clone) continue;
    restoreNodeState(clone.id, clip.entries[i].body);
    const fresh = (clone as unknown as { assignFreshSeq?: () => void }).assignFreshSeq;
    if (typeof fresh === "function") fresh.call(clone);
    toAdd.push({ clone: clone as SolenoidNode, type: clip.entries[i].body.type, x: originX + clip.entries[i].x, y: originY + clip.entries[i].y });
  }

  unselectAllNodes();
  scope.begin();
  try {
    await Promise.all(toAdd.map(async ({ clone, type, x, y }) => {
      await editor.addNode(clone);
      nodeNameStore.ensure(clone.id, type);
      await view.moveNode(clone.id, { x, y });
    }));
    const reg = getCtorRegistry();
    for (const { clone } of toAdd) {
      const hydrate = (clone as unknown as { hydrate?: (r: typeof reg) => Promise<void> }).hydrate;
      if (typeof hydrate === "function") await hydrate(reg);
    }
    restoreSideTables(clip.side, (id) => oldToNew.get(id));
    toAdd.forEach(({ clone }, idx) => selectNode(clone.id, idx > 0));
    for (const conn of clip.connections) {
      const src = clones[conn.srcIdx];
      const tgt = clones[conn.tgtIdx];
      if (!src || !tgt) continue;
      try {
        await editor.addConnection(
          new GraphConnection(
            src,
            conn.srcOutput,
            tgt,
            conn.tgtInput,
          ) as SolenoidConnection,
        );
      } catch {
      }
    }
    // The copied cables already carry the splice, so re-docking only registers the dock.
    for (const { clone } of toAdd) {
      const fc = clone as unknown as { hostNodeId?: string; dockSelf?: (e: typeof editor) => void };
      if (fc.hostNodeId && typeof fc.dockSelf === "function") fc.dockSelf(editor);
    }
  } finally {
    scope.end();
  }
  await scope.settle(new Set(toAdd.map((b) => b.clone.id)));
}
