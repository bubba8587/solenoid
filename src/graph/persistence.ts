// [[B12]] losslessSaves
import { flushDrafts } from "./draftFlush";
import { isDesktop } from "./fileBridge";
import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "./schemes";
import { getEditor, getView, processGraph, beginGraphRebuild, endGraphRebuild } from "./process";
import { repositionDockedNodes, clearHistory } from "./canvasCommands";
import { savedNodeBody, restoreNodeState, savedSideTables, restoreSideTables, type SavedNodeBody, type SavedStandoff, type SideTables } from "./savedNodeBody";
import { ctorRegistry } from "./nodeCtorRegistry";
import { FormatControllerNode, ConvertNode, PlaceholderNode, CompositeNode, placeholderFor } from "./rete-nodes";
import { settleWildcardTypes } from "./trueAnyAdopt";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse } from "./groupCollapse";
import { forgetAllNodes } from "./nodeStoreRegistry";
import { drawnCableStore, type SavedDrawnCable } from "./drawnCables";
import { nodeNameStore } from "./nodeNameStore";
import { writeTextForm, readTextForm } from "./textForm";
import { validateSavedGraph, CURRENT_SAVE_VERSION, deriveMissingNodeSockets, remapNodeRefs, type NodeRefs } from "./persistenceCore";
import { packsStore, allPacks } from "./packs";
import { pushNotice } from "./noticeStore";
import { documentStore } from "./documentStore";
import { reportStore } from "./reportStore";
import { presentationStore } from "./presentationStore";
import { compositeEditorStore } from "./compositeEditorStore";
import { paletteStore, reportPaletteStore } from "./palette";
import { docMetaStore } from "./docMetaStore";
import { loadRevealStore } from "./loadReveal";
import { zoomAt } from "./zoomAt";


const SWITCH_CURTAIN_MIN_WORK = 300;


export interface SavedNode extends SavedNodeBody {
  id: string;
  name?: string;
  x: number;
  y: number;
}

export interface SavedConnection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export type { SavedStandoff };

export interface SavedGraph extends SideTables {
  v: number;
  nodes: SavedNode[];
  connections: SavedConnection[];
  drawnCables?: SavedDrawnCable[];
  palette?: { base?: string; overrides?: Record<string, string> };
  reportPalette?: { base?: string; overrides?: Record<string, string> };
  meta?: { author?: string; tags?: string[]; foreign?: boolean; networkAllowed?: boolean };
  savedAt?: number;
  packs?: string[];
}


export function serializeGraph(): SavedGraph | null {
  const raw = buildRawSavedGraph();
  if (!raw) return null;
  return readTextForm(writeTextForm(raw));
}

function buildRawSavedGraph(): SavedGraph | null {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return null;

  const nodes: SavedNode[] = editor.getNodes().map((n) => {
    const pos = view.position(n.id) ?? { x: 0, y: 0 };
    const body = savedNodeBody(n);
    return {
      id: n.id,
      name: nodeNameStore.ensure(n.id, body.type),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      ...body,
    };
  });

  const connections: SavedConnection[] = editor.getConnections().map((c) => ({
    source: c.source,
    sourceOutput: c.sourceOutput,
    target: c.target,
    targetInput: c.targetInput,
  }));

  const g: SavedGraph = { v: CURRENT_SAVE_VERSION, nodes, connections, ...savedSideTables((id) => !!editor.getNode(id)) };
  const drawnCables = drawnCableStore.serialize();
  if (drawnCables.length > 0) g.drawnCables = drawnCables;
  const palette = paletteStore.docPalette();
  if (palette) g.palette = palette;
  const reportPalette = reportPaletteStore.reportPalette();
  if (reportPalette) g.reportPalette = reportPalette;
  const meta = docMetaStore.docMeta();
  if (meta) g.meta = meta;
  const packs = allPacks().filter((p) => packsStore.isActive(p.id)).map((p) => p.id);
  if (packs.length > 0) g.packs = packs;
  return g;
}

let _lastLoadIdMap: ReadonlyMap<string, string> = new Map();
export function getLastLoadIdMap(): ReadonlyMap<string, string> {
  return _lastLoadIdMap;
}

/** The notice a load would refuse this graph with (the structural gate, then the version gate), or null when it loads. */
export function loadRefusal(g: SavedGraph): string | null {
  const valid = validateSavedGraph(g);
  if (!valid.ok) return `Couldn't open this graph: ${valid.reason}. Your current work is unchanged.`;
  if (g.v !== CURRENT_SAVE_VERSION) {
    return g.v > CURRENT_SAVE_VERSION
      ? `This file was saved by a newer version of Solenoid (format v${g.v}) and can't be opened here. Update the app to load it.`
      : `This file uses an old save format (v${g.v}) that this build no longer opens.`;
  }
  return null;
}

export async function loadGraph(g: SavedGraph, opts?: { curtain?: boolean }): Promise<boolean> {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return false;

  const refusal = loadRefusal(g);
  if (refusal) {
    pushNotice(refusal, "error", 0);
    return false;
  }

  const snapshot = serializeGraph();

  suspendAutosave();
  beginGraphRebuild();
  try {
    const { placeholdered } = await rebuildGraph(g, editor, view, opts?.curtain ?? true);
    if (placeholdered.length > 0) {
      const types = [...new Set(placeholdered)].join(", ");
      pushNotice(
        `${placeholdered.length} node${placeholdered.length === 1 ? "" : "s"} (type: ${types}) couldn't be loaded here. Placeholders keep your wiring and data intact. Turn the matching pack on, or open the file in a build that has them, to restore.`,
        "warn",
      );
    }
    return true;
  } catch (err) {
    console.error("[solenoid] graph load failed; rolling back to the previous graph", err);
    if (snapshot) {
      try {
        await rebuildGraph(snapshot, editor, view);
        pushNotice("That graph couldn't be loaded, so your previous work was restored.", "error");
      } catch (err2) {
        console.error("[solenoid] rollback also failed", err2);
        // Deliberately unbalanced: autosave must never write the wreckage over the good copy.
        suspendAutosave();
        pushNotice(
          "That graph couldn't be loaded and the previous graph couldn't be restored. Reload the app to recover your last autosave.",
          "error",
          0,
        );
      }
    } else {
      pushNotice("That graph couldn't be loaded.", "error");
    }
    return false;
  } finally {
    loadRevealStore.finish();
    endGraphRebuild();
    resumeAutosave();
    clearHistory();
  }
}

async function rebuildGraph(
  g: SavedGraph,
  editor: NonNullable<ReturnType<typeof getEditor>>,
  view: NonNullable<ReturnType<typeof getView>>,
  allowCurtain = true,
): Promise<{ placeholdered: string[] }> {
  const oldWork = editor.getNodes().length + editor.getConnections().length;
  const newWork = (g.nodes?.length ?? 0) + (g.connections?.length ?? 0);
  const curtain = allowCurtain && oldWork + newWork > SWITCH_CURTAIN_MIN_WORK;
  // rAF then a task: the build yields only to microtasks, so without a real paint the curtain never shows.
  const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  if (curtain) { loadRevealStore.begin(); await paint(); }
  const buildTotal = Math.max(1, curtain ? oldWork + newWork : newWork);
  let buildDone = 0;
  const bump = () => { if (curtain) loadRevealStore.setProgress((buildDone += 1) / buildTotal); };
  const yieldEvery = 24;
  let n = 0;
  const chunkYield = async () => { if (curtain && ++n % yieldEvery === 0) await paint(); };
  for (const c of [...editor.getConnections()]) {
    await editor.removeConnection(c.id);
    if (curtain) bump();
    await chunkYield();
  }
  for (const node of [...editor.getNodes()]) {
    await editor.removeNode(node.id);
    if (curtain) bump();
    await chunkYield();
  }
  forgetAllNodes();
  reportStore.close();
  presentationStore.stop();
  compositeEditorStore.close();
  paletteStore.setDocPalette(g.palette ?? null);
  reportPaletteStore.setReportPalette(g.reportPalette ?? null);
  docMetaStore.setDocMeta(g.meta ?? null);

  const reg = ctorRegistry();
  const idMap = new Map<string, string>();
  _lastLoadIdMap = idMap;
  const created: ClassicPreset.Node[] = [];
  const placeholdered: string[] = [];

  const unknownIds = new Set(g.nodes.filter((sn) => !reg.has(sn.type)).map((sn) => sn.id));
  const phSockets = deriveMissingNodeSockets(unknownIds, g.connections ?? []);

  const toBuild: Array<{ node: ClassicPreset.Node; x: number; y: number }> = [];
  for (const sn of g.nodes) {
    const Ctor = reg.get(sn.type);
    let node: ClassicPreset.Node;
    if (!Ctor) {
      node = placeholderFor(sn, phSockets.get(sn.id));
      placeholdered.push(sn.type);
    } else {
      node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.literals && typeof anyNode.literals === "object") anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals && typeof anyNode.stringLiterals === "object") anyNode.stringLiterals = { ...sn.stringLiterals };
    }
    idMap.set(sn.id, node.id);
    nodeNameStore.claim(node.id, sn.name, sn.type);
    restoreNodeState(node.id, sn);
    created.push(node);
    toBuild.push({ node, x: sn.x ?? 0, y: sn.y ?? 0 });
  }
  for (let i = 0; i < toBuild.length; i += yieldEvery) {
    await Promise.all(toBuild.slice(i, i + yieldEvery).map(async ({ node, x, y }) => {
      await editor.addNode(node as SolenoidNode);
      await view.moveNode(node.id, { x, y });
      bump();
    }));
    if (curtain) await paint();
  }

  const isLive = (id: string) => !!editor.getNode(id);
  for (const node of created) {
    remapNodeRefs(node as unknown as NodeRefs, idMap, isLive);
    if (node instanceof PlaceholderNode) remapNodeRefs(node.savedInit, idMap, isLive);
  }

  for (const sc of g.connections) {
    const s = idMap.get(sc.source);
    const t = idMap.get(sc.target);
    if (!s || !t) continue;
    const src = editor.getNode(s);
    const tgt = editor.getNode(t);
    if (!src || !tgt) continue;
    try {
      await editor.addConnection(
        new ClassicPreset.Connection(src, sc.sourceOutput, tgt, sc.targetInput) as SolenoidConnection,
      );
    } catch {
    }
    bump();
  }

  restoreSideTables(g, (id) => {
    const live = idMap.get(id);
    return live && editor.getNode(live) ? live : undefined;
  });

  for (const node of created) {
    if (node instanceof CompositeNode) await node.hydrate(reg);
  }
  // Wildcard types must settle before dockSelf and refreshAnnotation, or an FC resolves against the wildcard.
  settleWildcardTypes(editor);
  for (const node of created) {
    if (node instanceof FormatControllerNode) node.dockSelf(editor);
  }
  for (const node of editor.getNodes()) {
    if (node instanceof ConvertNode) node.syncUnitArrows(editor);
  }
  for (const node of editor.getNodes()) {
    if (node instanceof FormatControllerNode) node.refreshAnnotation(editor);
  }

  drawnCableStore.load(g.drawnCables ?? []);

  rebuildGroupMembership(editor);

  await processGraph();
  // zoomAt over an empty node set yields a NaN transform.
  if (editor.getNodes().length > 0) await zoomAt(view, editor.getNodes());
  syncGroupCollapse(editor, view);

  // Two frames: a Decimal chip lays out late, so docked FCs can snap only once heights settle.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const hosts = new Set<string>();
    for (const n of editor.getNodes()) {
      const h = (n as { hostNodeId?: string }).hostNodeId;
      if (n instanceof FormatControllerNode && h) hosts.add(h);
    }
    for (const h of hosts) repositionDockedNodes(h);
  }));

  return { placeholdered };
}


const AUTOSAVE_DELAY = 700;

let _suspend = 0;
let _timer: ReturnType<typeof setTimeout> | null = null;

export function suspendAutosave() { _suspend++; }
export function resumeAutosave() { _suspend = Math.max(0, _suspend - 1); }

export function scheduleAutosave(): void {
  if (_suspend > 0) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    if (_suspend > 0) return;
    documentStore.captureCurrent({ keepDrafts: true });
  }, AUTOSAVE_DELAY);
}

function flushOnExit(): void {
  if (_suspend > 0) return;
  const flushed = flushDrafts();
  if (_timer === null && !flushed) return;
  if (_timer) clearTimeout(_timer);
  _timer = null;
  documentStore.captureCurrent();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushOnExit);
  // Closing the desktop window has no guaranteed pagehide; a throwing handler would keep the window open.
  if (isDesktop()) {
    void import("@tauri-apps/api/window").then((m) =>
      m.getCurrentWindow().onCloseRequested(() => { try { flushOnExit(); } catch (e) { console.error("[solenoid] close flush failed", e); } }));
  }
}

