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

// ─── Graph persistence ─────────────────────────────────────────────────────────
// Serialize the whole graph to plain JSON and rebuild it. The save format mirrors
// copy/paste's reconstruction path: each node is { type, init } where `type` is
// the class name (kept stable in prod by esbuild `keepNames`) and `init` is the
// constructor-arg snapshot from extractInit. On load we remap node ids (so reopen
// never collides with live ids) and rewrite FC host references through that map.

export interface SavedNode {
  id: string;
  type: string;                              // node class name
  // Stable, user-editable, unique-per-document name (the addressable model —
  // docs/subsystem-invariants.md "Addressable model"). Separate from `id`, which
  // stays rete's random, regenerated-on-load key. Optional in the TYPE only for
  // older saves that predate this field (rebuildGraph assigns a default via
  // nodeNameStore.claim when absent) — every node written by serializeGraph has
  // one.
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
  // Save-format version (= CURRENT_SAVE_VERSION). On load a file claiming a
  // HIGHER version is refused rather than opened lossily. Pre-alpha: there is no
  // backward migration — older saves load best-effort (an unknown or since-
  // renamed node type is skipped, see CLAUDE.md "Pre-alpha").
  v: number;
  nodes: SavedNode[];
  connections: SavedConnection[];
  // Arrangement constraints (optional — absent in older saves).
  standoffs?: SavedStandoff[];
  // Pinned value chips (optional — absent in older saves).
  pins?: Pin[];
  // Node-anchored comment threads (optional — absent in older saves).
  comments?: SavedCommentData[];
  // Per-column frame FORMAT annotations (optional — absent in older saves).
  frameFormats?: FrameColumnFormat[];
  // Which seed the dropdown should show after this graph is restored ("custom"
  // for an edited / non-seed working graph). Optional: hand-authored seed files
  // omit it, and seed loads set their selection from the filename instead.
  seedId?: SeedSelection;
  // Optional per-document palette declaration: an alternate base palette name
  // and/or per-slot hex overrides, layered over the app-wide palette choice when
  // this doc is open (see paletteStore). Absent on docs that follow the app palette.
  palette?: { base?: string; overrides?: Record<string, string> };
  // Optional REPORT/EXPORT-only palette declaration (bundle 13 #52) — scoped to
  // report/export rendering surfaces (the static HTML export), never the editing
  // canvas. Same shape as `palette`, same "no editor UI yet — hand/seed-authored"
  // precedent (see reportPaletteStore).
  reportPalette?: { base?: string; overrides?: Record<string, string> };
  // Optional per-document metadata (F-2): author + tags, edited in Document
  // Properties. The document TITLE is the documentStore name, not carried here.
  meta?: { author?: string; tags?: string[] };
  // Pack provenance: the pack ids active when this graph was saved. A breadcrumb
  // for the dormant-pack story — it lets a future load tell the user which packs a
  // graph expects (e.g. when a node loads as a placeholder because its pack is off).
  // Best-effort: it's the active SET, not a per-node dependency list (a formula-pack
  // node serializes as a core ExpressionNode, so its pack identity isn't on the node
  // yet). Recorded now; not consumed on load until dormant packs ship.
  packs?: string[];
}

// ─── Serialize ──────────────────────────────────────────────────────────────────
// serializeGraph extracts the live editor into a SavedGraph, then round-trips it
// through the text form (textForm.ts) before returning — so the JSON save is
// GENERATED from the text form, not hand-maintained in parallel (the addressable
// model's risk-containment move, docs/subsystem-invariants.md "Addressable
// model"). This also normalizes ids to names (rebuildGraph already remaps every
// saved id to a fresh live id regardless of its shape) and canonicalizes node/
// field order — a save file's node order becomes topological, not draw order.

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
    // A placeholder re-emits as the ORIGINAL (still-unregistered) type so the
    // round-trip is lossless — it never collapses to "PlaceholderNode", and
    // reopening in a build that HAS the type restores the real node.
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
      // Layout coords are sub-pixel floats off the area transform; integer
      // pixels are plenty and keep the saved JSON small and readable.
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
  // Pack provenance breadcrumb: the packs active at save time (see SavedGraph.packs).
  const packs = allPacks().filter((p) => packsStore.isActive(p.id)).map((p) => p.id);
  if (packs.length > 0) g.packs = packs;
  return g;
}

// ─── Deserialize ────────────────────────────────────────────────────────────────

// Saved-id → live-id remap from the most recent rebuildGraph. Tooling only (the
// seed-tune harness reads geometry back out by SAVED id — see seedTune.ts);
// nothing in the app itself consumes it.
let _lastLoadIdMap: ReadonlyMap<string, string> = new Map();
export function getLastLoadIdMap(): ReadonlyMap<string, string> {
  return _lastLoadIdMap;
}

/** Returns true if the graph was loaded, false if it was refused or rolled back
 *  (in which case the existing graph is left intact). `animate` plays the
 *  cinematic build → reveal (startup + File → Open only; doc switches snap). */
export async function loadGraph(g: SavedGraph, opts?: { animate?: boolean }): Promise<boolean> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return false;
  // Only animate when there's something worth watching build in — and honor
  // prefers-reduced-motion by snapping (the same instant path doc switches use).
  const animate = Boolean(opts?.animate) && (g.nodes?.length ?? 0) > 0 && !prefersReducedMotion();

  // Structural gate BEFORE the destructive clear: a malformed file (a node with
  // no type, a connection with a numeric endpoint) would otherwise throw partway
  // through the rebuild, after the user's graph was already gone.
  const valid = validateSavedGraph(g);
  if (!valid.ok) {
    pushNotice(`Couldn't open this graph: ${valid.reason}. Your current work is unchanged.`, "error", 0);
    return false;
  }

  // Version ceiling: a file from a FUTURE save format would otherwise load as
  // the current version with its new fields silently dropped — and the next
  // autosave would then overwrite the slot with the lossy result. Refuse before
  // touching anything. (A sticky notice, not window.alert, which is unreliable
  // in the Tauri WebView — same reason confirmStore replaced window.confirm.)
  if ((g.v ?? 1) > CURRENT_SAVE_VERSION) {
    pushNotice(
      `This file was saved by a newer version of Solenoid (format v${g.v}) and can't be opened here. Update the app to load it.`,
      "error",
      0,
    );
    return false;
  }

  // Snapshot the live graph so a mid-rebuild failure can roll back to it. The
  // old code cleared first and had no way back: one throwing constructor and the
  // user's work was gone, then the next autosave persisted the wreckage.
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
        // The canvas is wrecked and the notice tells the user to reload to
        // recover the last autosave — so autosave must NOT fire again and
        // overwrite that good copy with the wreckage. Deliberately unbalanced
        // suspend: it holds until the reload the notice asks for.
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
    // Always return the canvas to its normal (fully shown) state — a failed or
    // rolled-back load must never leave nodes/cables stuck hidden.
    loadRevealStore.finish();
    endGraphRebuild();
    resumeAutosave();
    // The rebuild (and any rollback) just recorded ~2(N+E) add/remove actions
    // in the history plugin. Left in place, Ctrl+Z after a load would unwind
    // the load itself — resurrecting the PREVIOUS document's node objects into
    // this canvas, which autosave then persists (audit P0-5). It also pinned
    // every removed node instance (frames, image dataUrls) in memory forever
    // (audit finding 20). Undo history is per-document-session: drop it.
    clearHistory();
  }
}

// Clear the editor and rebuild it from a saved graph. Assumes the graph has
// already passed validateSavedGraph and that the caller owns the autosave-
// suspend / beginGraphRebuild scope (so it can be called a second time for
// rollback). Returns the list of node types that had no registered constructor
// and were skipped. Throws if the rebuild itself fails — loadGraph catches and
// rolls back.
async function rebuildGraph(
  g: SavedGraph,
  editor: NonNullable<ReturnType<typeof getEditor>>,
  area: NonNullable<ReturnType<typeof getArea>>,
  animate = false,
): Promise<{ placeholdered: string[] }> {
  // Enter build mode FIRST (cables render hidden, the progress overlay covers the
  // canvas) so the node-by-node construction below is never seen. The old graph is
  // detached during the clear regardless, so hiding it early is harmless.
  if (animate) loadRevealStore.begin();
  // Accurate progress: nodes + connections are the build's countable work.
  const buildTotal = Math.max(1, (g.nodes?.length ?? 0) + (g.connections?.length ?? 0));
  let buildDone = 0;
  const bump = () => { if (animate) loadRevealStore.setProgress((buildDone += 1) / buildTotal * 0.9); };
  // Clear the current graph. removeNode fires `noderemoved`, which undocks any
  // FC (clearing its annotation + dockedNodeStore entry), so no extra cleanup.
  //
  // Optimistic instant-swap: tearing a big graph down means unmounting hundreds
  // of node/connection/socket React roots, which is slow (the dominant cost of
  // deleting/switching the Personal Finance doc). So (1) detach the canvas
  // content holder in ONE DOM op — the old graph vanishes immediately rather
  // than node-by-node — and (2) run the removals in yielding chunks so the main
  // thread stays responsive (the menu closes, the blank canvas paints) instead
  // of freezing for the whole teardown. Disposal happens off-screen (detached →
  // no per-removal reflow/repaint). The holder is re-attached (still EMPTY) for
  // the rebuild below, since new nodes must be laid out to measure their sockets
  // and cables. content.remove() is guarded by holder.contains(), so removals
  // against the detached holder are safe no-ops on the visible tree.
  const holder = (area as unknown as { area?: { content?: { holder?: HTMLElement } } })
    .area?.content?.holder;
  const holderParent = holder?.parentElement ?? null;
  const detach = Boolean(holder && holderParent && editor.getNodes().length > 0);
  if (detach && holder) holder.remove();
  try {
    let n = 0;
    const yieldEvery = 24; // unblock the main thread roughly every 24 removals
    for (const c of [...editor.getConnections()]) {
      await editor.removeConnection(c.id);
      if (detach && ++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
    for (const node of [...editor.getNodes()]) {
      await editor.removeNode(node.id);
      if (detach && ++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    if (detach && holder && holderParent && !holder.parentElement) holderParent.appendChild(holder);
  }
  // Bulk-reset every node-keyed store in one pass. The per-node `noderemoved`
  // handler skips `forgetNode` while rebuilding (isGraphRebuilding), because
  // some stores scan their whole map per forget — over a big graph that's
  // O(nodes × entries) and was the main cost of clearing the current graph
  // (e.g. when deleting/switching the open Personal Finance doc).
  forgetAllNodes();
  nodeSizeStore.clear(); // drop sizes keyed to the now-removed ids
  standoffStore.clear(); // ditto for arrangement constraints
  collapseStore.clear(); // ditto for per-node collapse
  pinStore.clear();      // ditto for pinned value chips
  nodeNameStore.clear(); // ditto for stable node names
  // Overlay singletons keyed to a node id from the OUTGOING graph: a docked
  // report would otherwise keep the `sol-report-docked` canvas squeeze (and a
  // running presentation its chrome-hide) across a document switch. The
  // per-node `noderemoved` cleanup in Canvas covers interactive deletes; this
  // covers any bulk path explicitly (same belt-and-braces as the store list).
  reportStore.close();
  presentationStore.stop();
  // A drill-in open across a load would keep rendering a CompositeNode that no
  // longer belongs to any live graph (closing also unmounts its internal views
  // — see CompositeEditorOverlay's cleanup — so their timers die with it).
  compositeEditorStore.close();
  // Apply (or clear) the document's palette declaration BEFORE rebuilding, so every
  // node/group color resolves through the right palette as it's created.
  paletteStore.setDocPalette(g.palette ?? null);
  reportPaletteStore.setReportPalette(g.reportPalette ?? null);
  docMetaStore.setDocMeta(g.meta ?? null);

  const reg = ctorRegistry();
  const idMap = new Map<string, string>(); // saved id → fresh id
  _lastLoadIdMap = idMap; // published for tooling (see getLastLoadIdMap)
  const created: ClassicPreset.Node[] = [];
  const placeholdered: string[] = [];

  // Unknown-type nodes (pack off, or a since-renamed type) become PLACEHOLDERS
  // that keep their wiring + state instead of being dropped. Synthesize each
  // one's sockets from the saved connections that reference it, so the cables
  // (which use `any` on the placeholder end) re-link.
  const unknownIds = new Set(g.nodes.filter((sn) => !reg.has(sn.type)).map((sn) => sn.id));
  const phSockets = deriveMissingNodeSockets(unknownIds, g.connections ?? []);

  // Construct every node synchronously (id remap + per-instance state restore),
  // THEN add + position them concurrently. The old per-node `await addNode` +
  // `await translate` was ~2N sequential microtask hops, each gated on the prior
  // node's DOM layout settling before the next — the dominant load cost. addNode
  // and translate are independent per node, so Promise.all collapses the 2N-deep
  // await chain into one barrier. Each node still goes straight to its final spot
  // (its own add→translate runs in order), so there's no stack-at-origin flash.
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
      // Restore mutable per-instance maps the constructor reset to defaults.
      if (sn.literals) anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
    }
    idMap.set(sn.id, node.id);
    nodeNameStore.claim(node.id, sn.name, sn.type);
    if (sn.size) nodeSizeStore.set(node.id, { ...sn.size });
    if (sn.collapsed) collapseStore.set(node.id, true);
    created.push(node); // synchronous push keeps `created` in saved order
    toBuild.push({ node, x: sn.x ?? 0, y: sn.y ?? 0 });
  }
  await Promise.all(toBuild.map(async ({ node, x, y }) => {
    await editor.addNode(node as SolenoidNode);
    await area.translate(node.id, { x, y });
    bump();
  }));

  // Rewrite node-id references through the remap (the saved ids no longer
  // exist): FC host sockets, and Group member lists.
  for (const node of created) {
    const anyNode = node as unknown as { hostNodeId?: string; members?: string[]; steps?: Array<{ nodeIds?: string[] }> };
    if (typeof anyNode.hostNodeId === "string" && anyNode.hostNodeId) {
      const mapped = idMap.get(anyNode.hostNodeId);
      if (mapped) anyNode.hostNodeId = mapped;
    }
    if (Array.isArray(anyNode.members)) {
      anyNode.members = anyNode.members.map((m) => idMap.get(m) ?? m).filter((m) => editor.getNode(m));
    }
    // Presentation steps' node-id sets were written as names (textForm.ts) — remap
    // them to fresh live ids, dropping any whose node vanished, so the slideshow
    // still flies to the right nodes after reload.
    if (Array.isArray(anyNode.steps)) {
      for (const step of anyNode.steps) {
        if (Array.isArray(step.nodeIds)) {
          step.nodeIds = step.nodeIds.map((m) => idMap.get(m) ?? m).filter((m) => editor.getNode(m));
        }
      }
    }
  }

  // Recreate connections (remapped). Each fires the editor's connectioncreated
  // pipe, which re-derives FC annotations + Convert arrows from the wiring.
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

  // Register each FC's positional dock now that its host + cables exist.
  for (const node of created) {
    if (node instanceof FormatControllerNode) node.dockSelf(editor);
  }
  // A Composite's internal subgraph is serialized independently of the outer
  // graph (see nodes/composite.ts) — hydrate it now that this node exists,
  // using the SAME class registry as the outer rebuild.
  for (const node of created) {
    if (node instanceof CompositeNode) await node.hydrate(reg);
  }
  // Derived socket types settle BEFORE the FC refresh below — Conduit lanes and
  // trueany placeholder ports adopt the types feeding them, so an FC downstream
  // of either resolves against the real type, not the wildcard.
  settleWildcardTypes(editor);
  // Final settle pass (wiring is the source of truth for both).
  for (const node of editor.getNodes()) {
    if (node instanceof ConvertNode) node.syncUnitArrows(editor);
  }
  for (const node of editor.getNodes()) {
    if (node instanceof FormatControllerNode) node.refreshAnnotation(editor);
  }

  // Re-link standoffs through the id remap, dropping any whose ends vanished.
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

  // Re-link pinned value chips through the id remap, dropping any whose node
  // vanished (e.g. an unknown type that was skipped).
  pinStore.load(
    (g.pins ?? [])
      .map((p) => ({ nodeId: idMap.get(p.nodeId) ?? "", outputKey: p.outputKey }))
      .filter((p) => p.nodeId && editor.getNode(p.nodeId)),
  );

  // Re-link comment threads through the id remap, dropping any whose node vanished.
  commentStore.load(
    (g.comments ?? [])
      .map((c) => ({ ...c, nodeId: idMap.get(c.nodeId) ?? "" }))
      .filter((c) => c.nodeId && editor.getNode(c.nodeId)),
  );

  // Re-link per-column frame formats through the id remap, dropping orphans.
  frameFormatStore.load(
    (g.frameFormats ?? [])
      .map((f) => ({ ...f, nodeId: idMap.get(f.nodeId) ?? "" }))
      .filter((f) => f.nodeId && editor.getNode(f.nodeId)),
  );

  rebuildGroupMembership(editor);

  if (animate) {
    // Frame the camera and settle collapsed groups while still hidden behind the
    // overlay, THEN play the staged reveal, and only compute/show results once
    // everything is drawn (deferring processGraph keeps every value box blank
    // until the end — exactly "don't display results til everything is drawn").
    if (editor.getNodes().length > 0) await AreaExtensions.zoomAt(area, editor.getNodes());
    syncGroupCollapse(editor, area);
    await runReveal(editor, area);
    await processGraph();
  } else {
    await processGraph();
    // zoomAt over an empty node set produces a NaN transform — a New/blank document
    // legitimately has no nodes, so only fit when there's something to fit to.
    if (editor.getNodes().length > 0) await AreaExtensions.zoomAt(area, editor.getNodes());
    syncGroupCollapse(editor, area); // restore any collapsed groups' hidden members
  }

  // Snap docked FCs onto their sockets once heights have settled (two RAFs,
  // same reason as the seed loader: a Decimal chip lays out a frame late).
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

// The staged reveal (animate path only). The graph is fully built and framed but
// hidden behind the fading overlay; we now fade the nodes in wave by wave (rough
// input → output order) and draw each node's incoming cables on as it appears.
// Nodes reveal via their area-view element's opacity — NOT transform, which would
// clobber rete's position translate (the documented async-translate gotcha). The
// finally guarantees every node is left visible even if something throws.
async function runReveal(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  area: NonNullable<ReturnType<typeof getArea>>,
): Promise<void> {
  const nodeIds = editor.getNodes().map((n) => n.id);
  const elOf = (id: string) => area.nodeViews.get(id)?.element;
  // Respect prefers-reduced-motion: skip the staged wave-by-wave fade/draw and
  // just reveal everything at once (the overlay itself still fades — that's a
  // one-shot opacity transition, not the repeating motion this setting targets).
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    loadRevealStore.startReveal();
    for (const c of editor.getConnections()) loadRevealStore.revealConn(c.id);
    for (const id of nodeIds) { const el = elOf(id); if (el) el.style.opacity = "1"; }
    return;
  }
  try {
    // Hide every node instantly (no transition), then arm the fade transition.
    for (const id of nodeIds) {
      const el = elOf(id);
      if (el) { el.style.transition = "none"; el.style.opacity = "0"; }
    }
    // Commit the hidden state before we start transitioning opacity back in.
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
    // Cap the whole reveal so a big graph plays in waves, not one-by-one forever.
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
    // Return nodes to default styling (visible). Cables follow when the store
    // flips back to idle in loadGraph's finally.
    for (const id of nodeIds) {
      const el = elOf(id);
      if (el) { el.style.opacity = ""; el.style.transition = ""; }
    }
  }
}

// ─── Autosave ─────────────────────────────────────────────────────────────────
// The live graph is persisted shortly after any change. The actual storage is
// the documents library (documentStore): autosave just serializes the live graph
// into the CURRENT document. This module keeps the debounce + suspend gate that
// every caller already drives via scheduleAutosave(); restore/migration and the
// localStorage slots live in documentStore.

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

// Flush a pending (debounced) autosave when the window/tab goes away — without
// this, closing within ~700 ms of the last edit silently dropped it (audit
// finding 36). captureCurrent is synchronous (a localStorage write), so it's
// safe in pagehide; it no-ops while suspended/rebuilding, same as the timer.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (_timer === null || _suspend > 0) return;
    clearTimeout(_timer);
    _timer = null;
    documentStore.captureCurrent();
  });
}

// Disk save/open moved to fileSession.ts (native dialogs on desktop, download/
// upload in the browser). serializeGraph + loadGraph above are its building blocks.
