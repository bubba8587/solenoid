import { ClassicPreset } from "rete";
import { AreaExtensions } from "rete-area-plugin";
import type { SolenoidNode, SolenoidConnection } from "./schemes";
import { getEditor, getArea, processGraph, repositionDockedNodes, beginGraphRebuild, endGraphRebuild, getCurrentSeedId, clearHistory } from "./process";
import type { SeedSelection } from "./process";
import { extractInit } from "./copyPaste";
import { ctorRegistry } from "./nodeCtorRegistry";
import { FormatControllerNode, ConvertNode, PlaceholderNode, CompositeNode } from "./rete-nodes";
import { settleWildcardTypes } from "./trueAnyAdopt";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse } from "./groupCollapse";
import { nodeSizeStore } from "./nodeSizeStore";
import { forgetAllNodes } from "./nodeStoreRegistry";
import { collapseStore } from "./collapseStore";
import { standoffStore, type StandoffEnd } from "./standoffs";
import { nodeNameStore } from "./nodeNameStore";
import { writeTextForm, readTextForm } from "./textForm";
import { validateSavedGraph, CURRENT_SAVE_VERSION, deriveMissingNodeSockets } from "./persistenceCore";
import { packsStore, allPacks } from "./packs";
import { pushNotice } from "./noticeStore";
import { documentStore } from "./documentStore";
import { pinStore, type Pin } from "./pinStore";
import { reportStore } from "./reportStore";
import { presentationStore } from "./presentationStore";
import { compositeEditorStore } from "./compositeEditorStore";
import { commentStore, type SavedCommentData } from "./commentStore";
import { frameFormatStore, type FrameColumnFormat } from "./frameFormatStore";
import { paletteStore, reportPaletteStore } from "./palette";
import { docMetaStore } from "./docMetaStore";
import { loadRevealStore, revealWaves } from "./loadReveal";
import { prefersReducedMotion } from "./coarse";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Curtain threshold in nodes+connections across BOTH sides, so a small doc swaps
 *  with no flash. */
const SWITCH_CURTAIN_MIN_WORK = 60;

// A node serializes as { type, init } where `type` is the CLASS NAME — production
// depends on esbuild `keepNames` to keep it stable.

export interface SavedNode {
  id: string;
  type: string;                              // node class name
  // The addressable name — separate from `id`, which stays rete's regenerated key.
  // Optional in the TYPE only for older saves; serializeGraph always writes one.
  name?: string;
  x: number;
  y: number;
  init: Record<string, unknown>;             // constructor args (extractInit)
  literals?: Record<string, number>;         // inline numeric inputs
  stringLiterals?: Record<string, string>;   // inline text inputs
  size?: { w: number; h: number };           // manual resize (resizable nodes)
  collapsed?: boolean;                       // per-node body collapse (collapseStore —
                                             // distinct from init.collapsed, the Group field)
}

export interface SavedConnection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface SavedStandoff {
  a: StandoffEnd;
  b: StandoffEnd;
  min: number;
  max: number;
  locked?: boolean;
}

export interface SavedGraph {
  // A file claiming a HIGHER version is refused rather than opened lossily; there
  // is no backward migration (pre-alpha).
  v: number;
  nodes: SavedNode[];
  connections: SavedConnection[];
  standoffs?: SavedStandoff[];
  pins?: Pin[];
  comments?: SavedCommentData[];
  frameFormats?: FrameColumnFormat[];
  // Which seed the dropdown shows after restore ("custom" once edited); seed files
  // omit it and set the selection from their filename.
  seedId?: SeedSelection;
  // Layered over the app-wide palette choice while this doc is open.
  palette?: { base?: string; overrides?: Record<string, string> };
  // Scoped to report/export rendering surfaces, never the editing canvas.
  reportPalette?: { base?: string; overrides?: Record<string, string> };
  // Author + tags; the document TITLE is the documentStore name, not carried here.
  meta?: { author?: string; tags?: string[] };
  // Pack provenance breadcrumb: the ACTIVE SET at save time, not a per-node
  // dependency list. Recorded now, not consumed on load until dormant packs ship.
  packs?: string[];
}

// The JSON save is GENERATED from the text form, never maintained in parallel — the
// round trip also canonicalizes ids to names and node order to topological.

export function serializeGraph(): SavedGraph | null {
  const raw = buildRawSavedGraph();
  if (!raw) return null;
  return readTextForm(writeTextForm(raw));
}

function buildRawSavedGraph(): SavedGraph | null {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return null;

  const nodes: SavedNode[] = editor.getNodes().map((n) => {
    const pos = area.nodeViews.get(n.id)?.position ?? { x: 0, y: 0 };
    // A placeholder re-emits its ORIGINAL type, never "PlaceholderNode", so a build
    // that has the type restores the real node.
    if (n instanceof PlaceholderNode) {
      const sn: SavedNode = {
        id: n.id,
        type: n.missingType,
        name: nodeNameStore.ensure(n.id, n.missingType),
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        init: { ...n.savedInit },
      };
      if (n.savedLiterals) sn.literals = { ...n.savedLiterals };
      if (n.savedStringLiterals) sn.stringLiterals = { ...n.savedStringLiterals };
      const sz = nodeSizeStore.get(n.id);
      if (sz) sn.size = { w: Math.round(sz.w), h: Math.round(sz.h) };
      if (collapseStore.get(n.id)) sn.collapsed = true;
      return sn;
    }
    const anyN = n as unknown as Record<string, unknown>;
    const sn: SavedNode = {
      id: n.id,
      type: n.constructor.name,
      name: nodeNameStore.ensure(n.id, n.constructor.name),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      init: extractInit(n),
    };
    if (anyN.literals && typeof anyN.literals === "object") {
      sn.literals = { ...(anyN.literals as Record<string, number>) };
    }
    if (anyN.stringLiterals && typeof anyN.stringLiterals === "object") {
      sn.stringLiterals = { ...(anyN.stringLiterals as Record<string, string>) };
    }
    const sz = nodeSizeStore.get(n.id);
    if (sz) sn.size = { w: Math.round(sz.w), h: Math.round(sz.h) };
    if (collapseStore.get(n.id)) sn.collapsed = true;
    return sn;
  });

  const connections: SavedConnection[] = editor.getConnections().map((c) => ({
    source: c.source,
    sourceOutput: c.sourceOutput,
    target: c.target,
    targetInput: c.targetInput,
  }));

  const standoffs: SavedStandoff[] = standoffStore.all().map((s) => ({
    a: { ...s.a },
    b: { ...s.b },
    min: Math.round(s.min),
    max: Math.round(s.max),
    ...(s.locked ? { locked: true } : {}),
  }));

  const g: SavedGraph = { v: 2, nodes, connections, seedId: getCurrentSeedId() };
  if (standoffs.length > 0) g.standoffs = standoffs;
  const pins = pinStore.serialize();
  if (pins.length > 0) g.pins = pins;
  const comments = commentStore.serialize();
  if (comments.length > 0) g.comments = comments;
  const frameFormats = frameFormatStore.serialize();
  if (frameFormats.length > 0) g.frameFormats = frameFormats;
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

// Tooling only (seedTune.ts reads geometry back by SAVED id); the app never reads it.
let _lastLoadIdMap: ReadonlyMap<string, string> = new Map();
export function getLastLoadIdMap(): ReadonlyMap<string, string> {
  return _lastLoadIdMap;
}

/** False = refused or rolled back, with the existing graph left intact. `animate`
 *  plays the cinematic reveal (startup + File → Open only). */
export async function loadGraph(g: SavedGraph, opts?: { animate?: boolean }): Promise<boolean> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return false;
  const animate = Boolean(opts?.animate) && (g.nodes?.length ?? 0) > 0 && !prefersReducedMotion();

  // Structural gate BEFORE the destructive clear — a malformed file would otherwise
  // throw partway through the rebuild, after the user's graph was gone.
  const valid = validateSavedGraph(g);
  if (!valid.ok) {
    pushNotice(`Couldn't open this graph: ${valid.reason}. Your current work is unchanged.`, "error", 0);
    return false;
  }

  // Refuse a FUTURE format before touching anything: it would load with its new
  // fields dropped, and the next autosave would overwrite the slot with the loss.
  if ((g.v ?? 1) > CURRENT_SAVE_VERSION) {
    pushNotice(
      `This file was saved by a newer version of Solenoid (format v${g.v}) and can't be opened here. Update the app to load it.`,
      "error",
      0,
    );
    return false;
  }

  // Snapshot the live graph so a mid-rebuild failure can roll back to it.
  const snapshot = serializeGraph();

  suspendAutosave();
  beginGraphRebuild(); // suppress live-creation behaviors (group absorb) while loading
  try {
    const { placeholdered } = await rebuildGraph(g, editor, area, animate);
    if (placeholdered.length > 0) {
      const types = [...new Set(placeholdered)].join(", ");
      pushNotice(
        `${placeholdered.length} node${placeholdered.length === 1 ? "" : "s"} (type: ${types}) couldn't be loaded here; placeholders keep your wiring and data intact. Turn the matching pack on, or open the file in a build that has them, to restore.`,
        "warn",
      );
    }
    return true;
  } catch (err) {
    console.error("[solenoid] graph load failed; rolling back to the previous graph", err);
    if (snapshot) {
      try {
        await rebuildGraph(snapshot, editor, area);
        pushNotice("That graph couldn't be loaded, so your previous work was restored.", "error");
      } catch (err2) {
        console.error("[solenoid] rollback also failed", err2);
        // Deliberately unbalanced suspend: autosave must never overwrite the good
        // copy with the wreckage before the reload the notice asks for.
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
    // A failed or rolled-back load must never leave nodes/cables stuck hidden.
    loadRevealStore.finish();
    endGraphRebuild();
    resumeAutosave();
    // Undo history is per-document-session: left in place, Ctrl+Z would unwind the
    // load itself, resurrecting the previous document's nodes and pinning them.
    clearHistory();
  }
}

// Assumes the graph passed validateSavedGraph and that the caller owns the autosave-
// suspend / beginGraphRebuild scope, since rollback calls this a second time.
async function rebuildGraph(
  g: SavedGraph,
  editor: NonNullable<ReturnType<typeof getEditor>>,
  area: NonNullable<ReturnType<typeof getArea>>,
  animate = false,
): Promise<{ placeholdered: string[] }> {
  // Build mode must be entered FIRST so the node-by-node construction is never seen;
  // a doc switch gets the same overlay as a plain curtain over teardown + rebuild.
  const oldWork = editor.getNodes().length + editor.getConnections().length;
  const newWork = (g.nodes?.length ?? 0) + (g.connections?.length ?? 0);
  const curtain = !animate && oldWork + newWork > SWITCH_CURTAIN_MIN_WORK;
  if (animate || curtain) loadRevealStore.begin();
  // The curtain also counts teardown, which dominates when leaving a big doc.
  const buildTotal = Math.max(1, curtain ? oldWork + newWork : newWork);
  let buildDone = 0;
  const bump = () => { if (animate || curtain) loadRevealStore.setProgress((buildDone += 1) / buildTotal * (animate ? 0.9 : 1)); };
  // removeNode fires `noderemoved`, which undocks any FC, so no extra cleanup here.
  // Teardown detaches the content holder in ONE DOM op and removes in yielding
  // chunks — unmounting hundreds of React roots in place froze the main thread.
  const holder = (area as unknown as { area?: { content?: { holder?: HTMLElement } } })
    .area?.content?.holder;
  const holderParent = holder?.parentElement ?? null;
  const detach = Boolean(holder && holderParent && editor.getNodes().length > 0);
  if (detach && holder) holder.remove();
  try {
    let n = 0;
    const yieldEvery = 24;
    for (const c of [...editor.getConnections()]) {
      await editor.removeConnection(c.id);
      if (curtain) bump();
      if (detach && ++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
    for (const node of [...editor.getNodes()]) {
      await editor.removeNode(node.id);
      if (curtain) bump();
      if (detach && ++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    if (detach && holder && holderParent && !holder.parentElement) holderParent.appendChild(holder);
  }
  // The per-node `noderemoved` handler skips `forgetNode` while rebuilding: some
  // stores scan their whole map per forget, which is O(nodes × entries).
  forgetAllNodes();
  // Overlay singletons keyed to an OUTGOING node id would otherwise keep their
  // chrome (the docked-report canvas squeeze) across a document switch.
  reportStore.close();
  presentationStore.stop();
  // A drill-in left open would keep rendering a CompositeNode belonging to no live
  // graph; closing also unmounts its internal views, killing their timers.
  compositeEditorStore.close();
  // BEFORE rebuilding, so every node/group color resolves through the right palette.
  paletteStore.setDocPalette(g.palette ?? null);
  reportPaletteStore.setReportPalette(g.reportPalette ?? null);
  docMetaStore.setDocMeta(g.meta ?? null);

  const reg = ctorRegistry();
  const idMap = new Map<string, string>(); // saved id → fresh id
  _lastLoadIdMap = idMap;
  const created: ClassicPreset.Node[] = [];
  const placeholdered: string[] = [];

  // Unknown-type nodes become PLACEHOLDERS keeping wiring + state; their sockets are
  // synthesized from the saved connections so the cables re-link.
  const unknownIds = new Set(g.nodes.filter((sn) => !reg.has(sn.type)).map((sn) => sn.id));
  const phSockets = deriveMissingNodeSockets(unknownIds, g.connections ?? []);

  // Construct synchronously, THEN add + position concurrently: a per-node await
  // chain is ~2N layout-gated hops and was the dominant load cost.
  const toBuild: Array<{ node: ClassicPreset.Node; x: number; y: number }> = [];
  for (const sn of g.nodes) {
    const Ctor = reg.get(sn.type);
    let node: ClassicPreset.Node;
    if (!Ctor) {
      const sockets = phSockets.get(sn.id);
      const initLabel = sn.init?.label;
      node = new PlaceholderNode({
        missingType: sn.type,
        savedInit: sn.init,
        savedLiterals: sn.literals,
        savedStringLiterals: sn.stringLiterals,
        inputKeys: sockets?.inputs,
        outputKeys: sockets?.outputs,
        label: typeof initLabel === "string" ? initLabel : sn.type,
      });
      placeholdered.push(sn.type);
    } else {
      node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.literals && typeof anyNode.literals === "object") anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals && typeof anyNode.stringLiterals === "object") anyNode.stringLiterals = { ...sn.stringLiterals };
    }
    idMap.set(sn.id, node.id);
    nodeNameStore.claim(node.id, sn.name, sn.type);
    if (sn.size) nodeSizeStore.set(node.id, { ...sn.size });
    if (sn.collapsed) collapseStore.set(node.id, true);
    created.push(node);
    toBuild.push({ node, x: sn.x ?? 0, y: sn.y ?? 0 });
  }
  await Promise.all(toBuild.map(async ({ node, x, y }) => {
    await editor.addNode(node as SolenoidNode);
    await area.translate(node.id, { x, y });
    bump();
  }));

  // Rewrite node-id references through the remap: FC hosts and Group member lists.
  for (const node of created) {
    const anyNode = node as unknown as { hostNodeId?: string; members?: string[]; steps?: Array<{ nodeIds?: string[] }> };
    if (typeof anyNode.hostNodeId === "string" && anyNode.hostNodeId) {
      const mapped = idMap.get(anyNode.hostNodeId);
      if (mapped) anyNode.hostNodeId = mapped;
    }
    if (Array.isArray(anyNode.members)) {
      anyNode.members = anyNode.members.map((m) => idMap.get(m) ?? m).filter((m) => editor.getNode(m));
    }
    // Presentation steps' node ids were written as names, so they remap too.
    if (Array.isArray(anyNode.steps)) {
      for (const step of anyNode.steps) {
        if (Array.isArray(step.nodeIds)) {
          step.nodeIds = step.nodeIds.map((m) => idMap.get(m) ?? m).filter((m) => editor.getNode(m));
        }
      }
    }
  }

  // Each fires `connectioncreated`, re-deriving FC annotations + Convert arrows.
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
      // Skip incompatible/duplicate connections.
    }
    bump();
  }

  // A Composite's subgraph serializes independently; hydrate it with the SAME
  // class registry as the outer rebuild.
  for (const node of created) {
    if (node instanceof CompositeNode) await node.hydrate(reg);
  }
  // ORDER MATTERS: derived socket types must settle before dockSelf and the FC
  // refresh, or an FC resolves against the wildcard instead of the real type.
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

  for (const ss of g.standoffs ?? []) {
    const aId = idMap.get(ss.a.nodeId);
    const bId = idMap.get(ss.b.nodeId);
    if (!aId || !bId || aId === bId) continue;
    standoffStore.add(
      { nodeId: aId, anchor: ss.a.anchor },
      { nodeId: bId, anchor: ss.b.anchor },
      ss.min,
      ss.max,
      ss.locked ?? false,
    );
  }

  pinStore.load(
    (g.pins ?? [])
      .map((p) => ({ nodeId: idMap.get(p.nodeId) ?? "", outputKey: p.outputKey }))
      .filter((p) => p.nodeId && editor.getNode(p.nodeId)),
  );

  commentStore.load(
    (g.comments ?? [])
      .map((c) => ({ ...c, nodeId: idMap.get(c.nodeId) ?? "" }))
      .filter((c) => c.nodeId && editor.getNode(c.nodeId)),
  );

  frameFormatStore.load(
    (g.frameFormats ?? [])
      .map((f) => ({ ...f, nodeId: idMap.get(f.nodeId) ?? "" }))
      .filter((f) => f.nodeId && editor.getNode(f.nodeId)),
  );

  rebuildGroupMembership(editor);

  if (animate) {
    // Frame and settle while still hidden, and defer processGraph to the end so no
    // value box shows a result before everything is drawn.
    if (editor.getNodes().length > 0) await AreaExtensions.zoomAt(area, editor.getNodes());
    syncGroupCollapse(editor, area);
    await runReveal(editor, area);
    await processGraph();
  } else {
    await processGraph();
    // zoomAt over an empty node set produces a NaN transform.
    if (editor.getNodes().length > 0) await AreaExtensions.zoomAt(area, editor.getNodes());
    syncGroupCollapse(editor, area); // restore any collapsed groups' hidden members
  }

  // Two RAFs: docked FCs can only snap once heights settle (a Decimal chip lays
  // out a frame late).
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

// The staged reveal: waves of nodes fade in over the lifting overlay. Reveal via
// opacity ONLY — a transform would clobber rete's position translate.
async function runReveal(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  area: NonNullable<ReturnType<typeof getArea>>,
): Promise<void> {
  const nodeIds = editor.getNodes().map((n) => n.id);
  const elOf = (id: string) => area.nodeViews.get(id)?.element;
  // prefers-reduced-motion skips the staged waves; the overlay's own one-shot fade
  // is not the repeating motion the setting targets.
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    loadRevealStore.startReveal();
    for (const c of editor.getConnections()) loadRevealStore.revealConn(c.id);
    for (const id of nodeIds) { const el = elOf(id); if (el) el.style.opacity = "1"; }
    return;
  }
  try {
    for (const id of nodeIds) {
      const el = elOf(id);
      if (el) { el.style.transition = "none"; el.style.opacity = "0"; }
    }
    // Commit the hidden state before transitioning opacity back in.
    if (nodeIds.length > 0) void elOf(nodeIds[0])?.offsetHeight;
    for (const id of nodeIds) { const el = elOf(id); if (el) el.style.transition = "opacity 360ms ease"; }

    loadRevealStore.startReveal(); // overlay fades out
    await sleep(80);               // frame boundary + let the curtain begin lifting

    const conns = editor.getConnections();
    const incoming = new Map<string, string[]>();
    for (const c of conns) {
      const arr = incoming.get(c.target) ?? [];
      arr.push(c.id);
      incoming.set(c.target, arr);
    }
    const waves = revealWaves(nodeIds, conns.map((c) => ({ source: c.source, target: c.target })));
    const totalMs = Math.min(1500, Math.max(450, nodeIds.length * 26));
    const perWave = waves.length > 1 ? totalMs / waves.length : 0;

    for (const wave of waves) {
      for (const id of wave) {
        const el = elOf(id);
        if (el) el.style.opacity = "1";
        for (const cid of incoming.get(id) ?? []) loadRevealStore.revealConn(cid);
      }
      if (perWave > 0) await sleep(perWave);
    }
    await sleep(460); // let the last cables finish drawing before results appear
  } finally {
    // Cables follow when the store flips back to idle in loadGraph's finally.
    for (const id of nodeIds) {
      const el = elOf(id);
      if (el) { el.style.opacity = ""; el.style.transition = ""; }
    }
  }
}

// Autosave keeps only the debounce + suspend gate; the storage itself (slots,
// restore, migration) lives in documentStore.

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
    documentStore.captureCurrent();
  }, AUTOSAVE_DELAY);
}

// Flush a pending autosave on pagehide, or closing within the debounce window drops
// the last edit; captureCurrent is a synchronous localStorage write, so it is safe.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (_timer === null || _suspend > 0) return;
    clearTimeout(_timer);
    _timer = null;
    documentStore.captureCurrent();
  });
}

// Disk save/open lives in fileSession.ts (native dialogs on desktop, download/
// upload in the browser). serializeGraph + loadGraph above are its building blocks.
