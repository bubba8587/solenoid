// [[save-format#A save loses nothing quietly]], [[A1]] visualGraphCalculator (the snapshot history), [[react-flow-surface-contract#Undo history]]
// Undo and redo move the live canvas to a saved graph by changing only what differs: the cards whose saved body
// changed are rebuilt, moved cards move, cables come and go, and one pass recomputes what
// those changes reach. Everything else keeps its node, its caches and its view.
import { GraphConnection, type GraphNode } from "./graphModel";
import type { SolenoidNode, SolenoidConnection } from "./schemes";
import type { SavedGraph, SavedNode, SavedConnection } from "./persistence";
import { serializeGraph } from "./persistence";
import { getEditor, getView, getEngine, processGraph, withGraphRebuild } from "./process";
import { restoreNodeState, restoreSideTables, type SideTables } from "./savedNodeBody";
import { ctorRegistry } from "./nodeCtorRegistry";
import { FormatControllerNode, CompositeNode } from "./nodeClasses";
import { remapNodeRefs, type NodeRefs } from "./persistenceCore";
import { restoreLiterals } from "./literalFields";
import { nodeNameStore } from "./nodeNameStore";
import { forgetNodeDeep } from "./nodeStoreRegistry";
import { nodeSizeStore } from "./nodeSizeStore";
import { collapseStore } from "./collapseStore";
import { socketFlipStore } from "./socketFlipStore";
import { sectionFoldStore } from "./sectionFoldStore";
import { standoffStore } from "./standoffs";
import { pinStore } from "./pinStore";
import { commentStore } from "./commentStore";
import { frameFormatStore } from "./frameFormatStore";
import { drawnCableStore } from "./drawnCables";
import { paletteStore, reportPaletteStore } from "./palette";
import { docMetaStore } from "./docMetaStore";
import { compositeEditorStore } from "./compositeEditorStore";
import { rebuildGroupMembership, dropFromGroups } from "./groupMembership";
import { syncGroupCollapse } from "./groupCollapse";
import { settleCableChange } from "./cableSettle";
import { reconcileTypesAfterEdit } from "./fcReconcile";
import { repositionDockedNodes } from "./canvasCommands";
import { perfEnabled } from "./perfProbe";
import { sameLanding, USER_SIZED, withoutSettled } from "./flow/flowHistoryDigest";

const SIDE_KINDS = ["standoffs", "pins", "comments", "frameFormats"] as const;
type SideKind = (typeof SIDE_KINDS)[number];

/** What moves a live graph saved as `from` to `to`, keyed by the cards' saved ids (their names in the text form). */
export interface GraphDelta {
  /** Saved ids gone from `to`. */
  removed: string[];
  /** Cards new in `to`, in its order. */
  added: SavedNode[];
  /** Cards in both whose type, init, literals or trust changed beyond what `patched` takes: rebuilt from `to`. */
  rebuilt: SavedNode[];
  /** Cards in both whose only change is a typed value (`IN_PLACE`): set on the live card, as the edit set it. */
  patched: SavedNode[];
  /** Cards whose size, fold, flip or sections changed and nothing a pass reads. */
  restyled: SavedNode[];
  /** Cards whose position changed. */
  moved: SavedNode[];
  cablesRemoved: SavedConnection[];
  cablesAdded: SavedConnection[];
  /** The side tables to replace whole from `to`. */
  sides: SideKind[];
  drawnCables: boolean;
  palette: boolean;
  reportPalette: boolean;
  meta: boolean;
  /** The saved stacking order of the cards in both differs, or a card is new. */
  order: boolean;
}

const connKey = (c: SavedConnection): string => `${c.source}\u0000${c.sourceOutput}\u0000${c.target}\u0000${c.targetInput}`;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The init a pass reads: a measured width or height is re-stamped after every restore, and a settled type is the
 *  type settle's (`SETTLED_INIT`), so neither is an edit. */
function initKey(n: SavedNode): string {
  const init = withoutSettled(n.type, n.init);
  if (USER_SIZED.has(n.type)) return JSON.stringify(init);
  const { width: _w, height: _h, ...rest } = init;
  return JSON.stringify(rest);
}

const filled = (m: object | undefined) => (m && Object.keys(m).length > 0 ? m : null);
const bodyKey = (n: SavedNode): string =>
  JSON.stringify([n.type, n.name ?? null, filled(n.literals), filled(n.stringLiterals), n.foreign ?? null]) + initKey(n);
/** The fields a card's own edit sets by plain assignment before it reruns (a typed field, the title, a table's
 *  text), so an undo sets them the same way on the live card rather than building a new one. Every card's inline
 *  fields (`literals`, `stringLiterals`, `literalKinds`) and title, and per type its typed value. */
const IN_PLACE: Readonly<Record<string, readonly string[]>> = {
  "*": ["label", "literalKinds"],
  ValueInputNode: ["value"],
  SliderInputNode: ["value"],
  AngleDialNode: ["value"],
  FrameInputNode: ["frameText"],
  TableInputNode: ["tableText"],
  GridPainterNode: ["tableText"],
  // Saved by name, so set as live ids (below), as a load remaps them.
  GroupNode: ["members"],
};

const inPlaceKeys = (type: string): ReadonlySet<string> => new Set([...IN_PLACE["*"], ...(IN_PLACE[type] ?? [])]);

/** The init without its measures and settled types, as `initKey` compares it. */
function readInit(n: SavedNode): Record<string, unknown> {
  const init = withoutSettled(n.type, n.init);
  if (USER_SIZED.has(n.type)) return init;
  const { width: _w, height: _h, ...rest } = init;
  return rest;
}

/** Whether `p` becomes `n` by setting typed values alone: the same type, name and trust, no literal map appearing,
 *  and every other differing init field one `IN_PLACE` names and `n` holds. */
function patchable(p: SavedNode, n: SavedNode): boolean {
  if (p.type !== n.type || (p.name ?? null) !== (n.name ?? null) || !same(p.foreign, n.foreign)) return false;
  // An emptied map lands as `{}`, which no comparison counts; a map appearing on a card that never had one can't be set.
  if ((filled(n.literals) && p.literals === undefined) || (filled(n.stringLiterals) && p.stringLiterals === undefined)) return false;
  const a = readInit(p), b = readInit(n);
  const keys = inPlaceKeys(n.type);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (same(a[k], b[k])) continue;
    if (!keys.has(k) || !(k in b)) return false;
  }
  return true;
}

const styleKey = (n: SavedNode): string =>
  JSON.stringify([n.size ?? null, n.collapsed ?? false, n.flipped ?? false, n.sections ?? null]);

/** The delta from `from` to `to`, or null when only a whole load gets there (another save format, another pack set). */
export function diffGraphs(from: SavedGraph, to: SavedGraph): GraphDelta | null {
  if (from.v !== to.v || !same(from.packs, to.packs)) return null;
  const fromById = new Map(from.nodes.map((n) => [n.id, n]));
  const toById = new Map(to.nodes.map((n) => [n.id, n]));
  if (fromById.size !== from.nodes.length || toById.size !== to.nodes.length) return null;

  const removed = from.nodes.filter((n) => !toById.has(n.id)).map((n) => n.id);
  const added: SavedNode[] = [];
  const rebuilt: SavedNode[] = [];
  const patched: SavedNode[] = [];
  const restyled: SavedNode[] = [];
  const moved: SavedNode[] = [];
  for (const n of to.nodes) {
    const p = fromById.get(n.id);
    if (!p) { added.push(n); continue; }
    if (bodyKey(p) !== bodyKey(n)) {
      if (!patchable(p, n)) { rebuilt.push(n); continue; }
      patched.push(n);
    }
    if (styleKey(p) !== styleKey(n)) restyled.push(n);
    if (p.x !== n.x || p.y !== n.y) moved.push(n);
  }

  // A rebuilt or removed card's cables go with it, and a rebuilt or added one's come back from `to`.
  const fresh = new Set([...removed, ...rebuilt.map((n) => n.id), ...added.map((n) => n.id)]);
  const toKeys = new Set(to.connections.map(connKey));
  const fromKeys = new Set(from.connections.map(connKey));
  const touches = (c: SavedConnection) => fresh.has(c.source) || fresh.has(c.target);
  const cablesRemoved = from.connections.filter((c) => touches(c) || !toKeys.has(connKey(c)));
  const cablesAdded = to.connections.filter((c) => touches(c) || !fromKeys.has(connKey(c)));

  // A side table is replaced when it differs, or when it holds an entry for a card built afresh (whose entries went
  // with its old node). A removed card's entries go with it, as `to` has them gone.
  const built = new Set([...rebuilt.map((n) => n.id), ...added.map((n) => n.id)]);
  const names = (k: SideKind): string[] => (to[k] ?? []).flatMap((e) =>
    "a" in e ? [(e as { a: { nodeId: string }; b: { nodeId: string } }).a.nodeId, (e as { b: { nodeId: string } }).b.nodeId]
      : [(e as { nodeId: string }).nodeId]);
  const sides = SIDE_KINDS.filter((k) => !same(from[k], to[k]) || names(k).some((id) => built.has(id)));

  const kept = from.nodes.filter((n) => toById.has(n.id)).map((n) => n.id);
  const keptInTo = to.nodes.filter((n) => fromById.has(n.id)).map((n) => n.id);
  const order = added.length > 0 || kept.join("\u0000") !== keptInTo.join("\u0000");

  return {
    removed, added, rebuilt, patched, restyled, moved, cablesRemoved, cablesAdded, sides,
    drawnCables: !same(from.drawnCables ?? [], to.drawnCables ?? []),
    palette: !same(from.palette, to.palette),
    reportPalette: !same(from.reportPalette, to.reportPalette),
    meta: !same(from.meta, to.meta),
    order,
  };
}

/** Whether the delta changes anything at all. */
export function isEmptyDelta(d: GraphDelta): boolean {
  return !d.removed.length && !d.added.length && !d.rebuilt.length && !d.patched.length && !d.restyled.length && !d.moved.length &&
    !d.cablesRemoved.length && !d.cablesAdded.length && !d.sides.length && !d.drawnCables && !d.palette &&
    !d.reportPalette && !d.meta && !d.order;
}

/** Moves the live main canvas to `target` by its delta, and answers the canvas's save as it landed (the read-back, so
 *  the history keeps it without serializing again). `null`, with nothing changed, when only a whole load gets there:
 *  no canvas, a card type this build lacks, a save the delta can't express; and `null` after the apply when the
 *  read-back isn't `target`, which the caller answers with a whole load, so undo never lands somewhere else. */
export async function applyGraphDelta(target: SavedGraph): Promise<SavedGraph | null> {
  const editor = getEditor();
  const view = getView();
  const engine = getEngine();
  if (!editor || !view || !engine) return null;
  const perf = perfEnabled();
  const t0 = perf ? performance.now() : 0;
  const current = serializeGraph();
  if (!current) return null;
  const t1 = perf ? performance.now() : 0;
  const delta = diffGraphs(current, target);
  if (!delta) return null;
  if (isEmptyDelta(delta)) return current;
  const reg = ctorRegistry();
  if ([...delta.added, ...delta.rebuilt].some((n) => !reg.has(n.type))) return null;

  // Saved id (a name) → live id; every card the save holds has one.
  const live = new Map<string, string>();
  for (const n of editor.getNodes()) {
    const name = nodeNameStore.get(n.id);
    if (name) live.set(name, n.id);
  }
  if (current.nodes.some((n) => !live.has(n.id))) return null;

  const gone = new Set([...delta.removed, ...delta.rebuilt.map((n) => n.id)].map((id) => live.get(id)!));
  if (compositeEditorStore.stack().some((c) => gone.has(c.id))) compositeEditorStore.close();

  const dirty = new Set<string>();
  const created: GraphNode[] = [];
  let cablesChanged = delta.cablesAdded.length + delta.cablesRemoved.length > 0;

  await withGraphRebuild(async () => {
    const liveCables = new Map(editor.getConnections().map((c) => [
      `${c.source}\u0000${c.sourceOutput}\u0000${c.target}\u0000${c.targetInput}`, c,
    ]));
    for (const sc of delta.cablesRemoved) {
      const s = live.get(sc.source), t = live.get(sc.target);
      const c = s && t ? liveCables.get(`${s}\u0000${sc.sourceOutput}\u0000${t}\u0000${sc.targetInput}`) : undefined;
      if (!c) continue;
      await editor.removeConnection(c.id);
      if (!gone.has(c.target)) dirty.add(c.target);
    }

    // A rebuilt card takes a fresh live id, as a load gives it, so its view mounts afresh rather than keeping the old
    // card's drafts; what refers to the old id is pointed at the new one below.
    const oldId = new Map(delta.rebuilt.map((sn) => [sn.id, live.get(sn.id)!]));
    // A selected card stays selected through its rebuild.
    const wasSelected = new Set(delta.rebuilt
      .filter((sn) => (editor.getNode(live.get(sn.id)!) as { selected?: boolean } | undefined)?.selected === true)
      .map((sn) => sn.id));
    const swapped = new Map<string, string>();
    // Every cable on a card that goes, found in one walk ([[engineering#Table work grows with the rows, never with rows squared, and drawing stops at the screen]]), removed before the cards.
    for (const c of editor.getConnections().filter((c) => gone.has(c.source) || gone.has(c.target))) {
      await editor.removeConnection(c.id);
      if (!gone.has(c.target)) dirty.add(c.target);
      cablesChanged = true;
    }
    for (const id of gone) {
      const node = editor.getNode(id);
      if (!node) continue;
      await editor.removeNode(id);
      // The rebuild gate holds back the delete settle, which would also take a relocation for a delete.
      forgetNodeDeep(node as SolenoidNode);
    }
    dropFromGroups(editor, new Set(delta.removed.map((id) => live.get(id)!)));
    for (const id of delta.removed) live.delete(id);

    for (const sn of [...delta.rebuilt, ...delta.added]) {
      const Ctor = reg.get(sn.type)!;
      const node = new Ctor({ ...sn.init });
      const was = oldId.get(sn.id);
      if (was) swapped.set(was, node.id);
      if (wasSelected.has(sn.id)) (node as { selected?: boolean }).selected = true;
      restoreLiterals(node, sn);
      nodeNameStore.claim(node.id, sn.name ?? sn.id, sn.type);
      restoreNodeState(node.id, sn);
      await editor.addNode(node as SolenoidNode);
      await view.moveNode(node.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
      live.set(sn.id, node.id);
      created.push(node);
      dirty.add(node.id);
    }
    const isLive = (id: string) => !!editor.getNode(id);
    for (const node of created) remapNodeRefs(node as unknown as NodeRefs, live, isLive);
    const fresh = new Set(created);
    if (swapped.size) for (const node of editor.getNodes()) if (!fresh.has(node)) remapNodeRefs(node as unknown as NodeRefs, swapped, isLive);

    for (const sc of delta.cablesAdded) {
      const s = live.get(sc.source), t = live.get(sc.target);
      const src = s ? editor.getNode(s) : undefined;
      const tgt = t ? editor.getNode(t) : undefined;
      if (!src || !tgt) continue;
      try {
        await editor.addConnection(new GraphConnection(src, sc.sourceOutput, tgt, sc.targetInput) as SolenoidConnection);
        dirty.add(tgt.id);
      } catch { /* a socket the card no longer has: a whole load drops the same cable */ }
    }

    // A typed value set on the live card, as its edit set it: the card keeps its node, its view and its drafts.
    for (const sn of delta.patched) {
      const node = editor.getNode(live.get(sn.id)!) as unknown as Record<string, unknown> & GraphNode;
      const init = sn.init ?? {};
      for (const k of inPlaceKeys(sn.type)) if (k in init && !same(node[k], init[k])) node[k] = structuredClone(init[k]);
      if (typeof node.literals === "object") node.literals = { ...(sn.literals ?? {}) };
      if (typeof node.stringLiterals === "object") node.stringLiterals = { ...(sn.stringLiterals ?? {}) };
      if ("members" in init) remapNodeRefs(node as unknown as NodeRefs, live, isLive);
      editor.named(node.id);
      dirty.add(node.id);
    }

    for (const sn of delta.restyled) {
      const id = live.get(sn.id)!;
      nodeSizeStore.set(id, sn.size ? { ...sn.size } : undefined);
      collapseStore.set(id, sn.collapsed === true);
      socketFlipStore.set(id, sn.flipped === true);
      sectionFoldStore.setAll(id, sn.sections ?? {});
    }
    for (const sn of delta.moved) await view.moveNode(live.get(sn.id)!, { x: sn.x, y: sn.y });

    if (delta.sides.length) {
      const mainIds = editor.getNodes().map((n) => n.id);
      const clear: Record<SideKind, (id: string) => void> = {
        standoffs: (id) => standoffStore.removeForNode(id),
        pins: (id) => pinStore.remove(id),
        comments: (id) => commentStore.removeForNode(id),
        frameFormats: (id) => frameFormatStore.removeForNode(id),
      };
      const sides: SideTables = {};
      for (const k of delta.sides) {
        for (const id of mainIds) clear[k](id);
        (sides as Record<string, unknown>)[k] = target[k];
      }
      restoreSideTables(sides, (id) => {
        const l = live.get(id);
        return l && editor.getNode(l) ? l : undefined;
      });
    }

    for (const node of created) if (node instanceof CompositeNode) await node.hydrate(reg);
    for (const node of editor.getNodes()) if (node instanceof FormatControllerNode) node.dockSelf(editor);

    // A rebuilt card was added again on top, so the stacking order is compared live, not only where the save moved it.
    const order = target.nodes.map((n) => live.get(n.id)!);
    if (order.join("\u0000") !== editor.getNodes().map((n) => n.id).join("\u0000")) editor.reorderNodes(order);
    if (delta.drawnCables) drawnCableStore.load(target.drawnCables ?? []);
    if (delta.palette) paletteStore.setDocPalette(target.palette ?? null);
    if (delta.reportPalette) reportPaletteStore.setReportPalette(target.reportPalette ?? null);
    if (delta.meta) docMetaStore.setDocMeta(target.meta ?? null);

    rebuildGroupMembership(editor);
    settleCableChange(editor, view);
    // A typed value can move a derived socket type with no cable event, as its edit settles it ([[B11]] maximalMerge).
    if (delta.patched.length) reconcileTypesAfterEdit(editor, view);
    syncGroupCollapse(editor, view);

    // One pass over what the changes reach: each changed card's reach is cleared, everything else keeps its caches.
    // Inside the scope, as a load's pass is, so an undo computes in Manual too, as the whole load it replaces did.
    if (dirty.size > 0) {
      const reach = new Set<string>();
      for (const id of dirty) {
        if (!editor.getNode(id) || reach.has(id)) continue;
        engine.reset(id);
        for (const r of engine.downstreamClosure(id)) reach.add(r);
      }
      await processGraph(undefined, reach, { topology: cablesChanged || created.length > 0 });
    }
  }, { settled: true });
  const hosts = new Set<string>();
  for (const n of editor.getNodes()) {
    const h = (n as { hostNodeId?: string }).hostNodeId;
    if (n instanceof FormatControllerNode && h) hosts.add(h);
  }
  if (hosts.size) requestAnimationFrame(() => requestAnimationFrame(() => { for (const h of hosts) repositionDockedNodes(h); }));

  const t2 = perf ? performance.now() : 0;
  const landed = serializeGraph();
  const hit = !!landed && sameLanding(landed, target);
  if (perf) {
    const t3 = performance.now();
    console.log(`[perf] undo delta  patched=${delta.patched.length} rebuilt=${delta.rebuilt.length}${delta.rebuilt.length ? ` (${delta.rebuilt.slice(0, 3).map((n) => n.type).join(", ")})` : ""} added=${delta.added.length} removed=${delta.removed.length} ` +
      `moved=${delta.moved.length} cables=${delta.cablesAdded.length}+/${delta.cablesRemoved.length}-  serialize=${(t1 - t0).toFixed(1)}ms ` +
      `apply+pass=${(t2 - t1).toFixed(1)}ms  check=${(t3 - t2).toFixed(1)}ms${hit ? "" : "  MISSED"}`);
  }
  if (hit) return landed;
  if (import.meta.env?.DEV && landed) {
    const want = new Map(target.nodes.map((n) => [n.id, JSON.stringify(n)]));
    const off = landed.nodes.filter((n) => want.get(n.id) !== JSON.stringify(n)).map((n) => ({ got: n, want: want.get(n.id) }));
    const fields = [...new Set([...Object.keys(landed), ...Object.keys(target)])]
      .filter((k) => k !== "nodes" && k !== "connections" && !same((landed as never)[k], (target as never)[k]));
    const gotCables = new Set(landed.connections.map(connKey));
    const wantCables = new Set(target.connections.map(connKey));
    const cables = {
      missing: target.connections.filter((c) => !gotCables.has(connKey(c))),
      extra: landed.connections.filter((c) => !wantCables.has(connKey(c))),
    };
    const order = landed.nodes.map((n) => n.id).join() === target.nodes.map((n) => n.id).join() ? "same" : "differs";
    const cableOrder = landed.connections.map(connKey).join() === target.connections.map(connKey).join() ? "same"
      : landed.connections.map(connKey).map((k, i) => k === connKey(target.connections[i]) ? "" : `${i}: ${k} / ${connKey(target.connections[i])}`).filter(Boolean).slice(0, 4);
    console.warn("[solenoid] undo delta missed its target; loading it whole", JSON.stringify({ fields, cables, cableOrder, order, off }).slice(0, 4000));
  }
  return null;
}
