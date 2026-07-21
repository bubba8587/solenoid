// Tidy (auto-arrange) + Cleanup — the ELK layout engine behind the NavMenu
// buttons, T/C shortcuts and the group Tidy button. Extracted from Canvas.tsx:
// the factories close over the per-mount editor/area the same way the init
// effect did. Invariants live in docs/subsystem-invariants.md "Auto-arrange /
// Tidy": SYMMETRIC port preset, left+centre anchor, fixed-height pins dropped
// after the size restores, standoff clusters as rigid ELK super-nodes.
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import type { AutoArrangePlugin } from "rete-auto-arrange-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { requestConfirm } from "./confirmStore";
import { settingsStore } from "./settingsStore";
import { cableSelectionStore } from "./cableState";
import { ConduitNode, FormatControllerNode, GroupNode } from "./rete-nodes";
import { autofitGroupBox, GROUP_PAD, GROUP_HEADER } from "./groupLogic";
import { measuredBox } from "./nodeSize";
import { nodeSizeStore } from "./nodeSizeStore";
import { pushForGrownGroups } from "./groupPush";
import { standoffStore, standoffClusters, settleStandoffs } from "./standoffs";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse, settleCollapse } from "./groupCollapse";
import { fitAll } from "./NavMenu";
import { dockedNodeStore } from "./dockedNodeStore";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";
import { scheduleAutosave } from "./persistence";
import {
  unselectAllNodes as unselectAllNodesFromProcess,
  selectNode as selectNodeFromProcess,
} from "./process";

// Tidy (auto-arrange) asks for confirmation before rearranging more
// than this many nodes — it's a large, hard-to-undo visual change.
const TIDY_CONFIRM_THRESHOLD = 12;

export interface TidyDeps {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  container: HTMLElement;
  ensureArrange: () => Promise<AutoArrangePlugin<Schemes> | null>;
  /** Snap every FC docked to `hostId` back onto its socket (defined in the init effect). */
  repositionDockedTo: (hostId: string) => void;
  /** The mount's destroyed flag — deferred rAF work must bail after unmount. */
  isDestroyed: () => boolean;
}

export type ArrangeFn = (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => Promise<void>;

// Port positions drive ELK's vertical node alignment (it lines up connected
// ports). The stock `classic` preset puts OUTPUT ports at the node TOP and
// INPUT ports at the BOTTOM, which staircases every chain upward — wrong for
// our nodes. We place ports SYMMETRICALLY (same offset for in/out) so two
// connected nodes line up, and read the Tidy-alignment setting per layout:
//   "center" → ports at the node's vertical centre → node CENTRES align;
//   "top"    → ports near the node's top → node TOP edges align.
// Exported so the headless tidy test drives ELK with the REAL preset.
export function symmetricPortPreset() {
  return {
    port(data: { side: "input" | "output"; index: number; ports: number; width: number; height: number }) {
      const spacing = 16;
      const y = settingsStore.get("tidyAlign") === "top"
        ? 20 + data.index * spacing
        : data.height / 2 + (data.index - (data.ports - 1) / 2) * spacing;
      return { x: 0, y, width: 15, height: 15, side: data.side === "output" ? "EAST" : "WEST" } as const;
    },
  };
}

// ELK (rete-auto-arrange-plugin + its elkjs dependency) is a heavy chunk that
// only Tidy needs, so it's LAZY: imported and wired on the first arrange, not
// at Canvas init (recharts/KaTeX are lazy the same way). The returned
// `ensureArrange` dynamically imports the plugin, builds it once, registers it
// on the area, and memoizes; every later Tidy reuses the same instance. Until
// then ELK stays out of the main bundle.
export function makeEnsureArrange(
  area: AreaPlugin<Schemes, AreaExtra>,
  isDestroyed: () => boolean,
): () => Promise<AutoArrangePlugin<Schemes> | null> {
  let arrange: AutoArrangePlugin<Schemes> | null = null;
  let arrangeLoading: Promise<AutoArrangePlugin<Schemes> | null> | null = null;
  return () => {
    if (arrange) return Promise.resolve(arrange);
    if (arrangeLoading) return arrangeLoading;
    arrangeLoading = (async () => {
      const { AutoArrangePlugin } = await import("rete-auto-arrange-plugin");
      // A doc switch / unmount can destroy the area during the dynamic import.
      if (isDestroyed()) return null;
      const plugin = new AutoArrangePlugin<Schemes>();
      plugin.addPreset(symmetricPortPreset);
      area.use(plugin);
      arrange = plugin;
      return plugin;
    })();
    return arrangeLoading;
  };
}

// The auto-arrange behind the nav-menu "tidy" button (and T / the group Tidy
// button). The Conduit declares all its lanes up-front, which would make ELK
// treat it as a tall multi-port node and shove it far away from its
// neighbours. We hand ELK a Proxy that exposes only the *in-use* ports, so the
// Conduit lays out as the small node it visually is. The Proxy preserves `id`,
// so the applier still translates the real node.
export function makeArrangeFn(deps: TidyDeps): ArrangeFn {
  const { editor, area, container, ensureArrange, repositionDockedTo, isDestroyed } = deps;
  return async (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => {
    // Scope: selected nodes if any are selected, otherwise the whole
    // graph. Tidy is a big, hard-to-undo visual change, so past a
    // threshold we confirm before rearranging.
    const all = editor.getNodes();
    const selected = all.filter((n) => (n as { selected?: boolean }).selected);

    // Group-aware Tidy. Build member→group for every group.
    const allGroups = all.filter((n): n is GroupNode => n instanceof GroupNode);
    const memberOf = new Map<string, GroupNode>();
    for (const g of allGroups) for (const m of g.members) memberOf.set(m, g);

    // A group's own Tidy button (opts.groupId): lay out exactly that group's
    // members within its box, regardless of the current selection. Same flow
    // as Case A below, just forced and unconditional.
    const forcedGroup = opts?.groupId
      ? allGroups.find((g) => g.id === opts.groupId) ?? null
      : null;

    const targets = forcedGroup
      ? forcedGroup.members.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n)
      : (selected.length > 0 ? selected : all);
    if (targets.length === 0) return;

    // Case A — selection is entirely members of one group: lay them out
    // WITHIN the box (and autogrow it). It runs through the same flow below
    // (so docked-FC footprint reservation + edge bridging still apply); only
    // the re-anchor target and the post-layout box-grow differ.
    let withinGroup: GroupNode | null = forcedGroup;
    let tidyNodes: Schemes["Node"][] = targets;
    if (!forcedGroup && selected.length > 0 && selected.every((n) => memberOf.has(n.id))) {
      const grp = memberOf.get(selected[0].id)!;
      if (selected.every((n) => memberOf.get(n.id) === grp)) {
        withinGroup = grp;
        tidyNodes = grp.members.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n);
      }
    }

    if (!withinGroup) {
      // Count what Tidy actually arranges: layout UNITS, not raw nodes. A
      // global tidy positions each group as one rigid unit (its members move
      // with it rather than being laid out individually) and skips docked
      // FCs — so a collapsed group with many hidden members still counts as
      // one. This mirrors layoutTargets' predicate below, keeping the dialog
      // honest about the scope of the change.
      const arrangedCount = targets.filter(
        (n) => !(n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id)) && !memberOf.has(n.id),
      ).length;
      if (!opts?.skipConfirm && arrangedCount > TIDY_CONFIRM_THRESHOLD) {
        const scope = selected.length > 0 ? `${arrangedCount} selected` : `all ${arrangedCount}`;
        const ok = await requestConfirm({
          message: `Tidy will rearrange ${scope} nodes. Continue?`,
          confirmLabel: "Tidy",
        });
        if (!ok) return;
      }
    }

    // Clear the selection for the duration of the layout. A selected
    // node's translate triggers the selector's group-follow (it moves
    // every other selected node by the same delta to keep the group
    // together — the multi-drag mechanism), which compounds across the
    // applier's per-node placement and corrupts the result. Drop the
    // selection, lay out, then restore it.
    const selectedIds = selected.map((n) => n.id);
    if (selectedIds.length > 0) unselectAllNodesFromProcess();

    const conns = editor.getConnections();
    // Docked FCs are positional adornments on their hosts, not standalone
    // graph nodes. Exclude them from the layout and bridge their inline
    // edges (host → FC → consumer becomes host → consumer for ELK), so the
    // real graph lays out; the FCs are snapped back onto their hosts after.
    const dockedFcIds = new Set(
      tidyNodes
        .filter((n) => n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id))
        .map((n) => n.id),
    );
    // Exclude docked FCs (positional adornments). For a global tidy also
    // exclude groups + their members (they tidy together via Case A, not
    // loose in the layout); for a within-group tidy, lay out exactly that
    // group's members.
    // Global tidy: keep GROUPS in the layout (positioned as rigid units),
    // exclude their members (they move with the group afterward). Within-group
    // tidy: keep exactly that group's members.
    const memberIds = new Set(memberOf.keys());
    const layoutTargets = tidyNodes.filter(
      (n) => !dockedFcIds.has(n.id) && (withinGroup ? true : !memberIds.has(n.id)),
    );

    // ── Standoff clusters lay out as ONE rigid block ──────────────────
    // ELK has no idea two standoffed nodes must stay together, so it
    // scatters them and the post-pass settle then yanks one onto the other
    // (overlaps). Collapse each fully-loose cluster into a leader: ELK sees
    // one bbox-sized node, and the members are re-placed at their stored
    // offsets afterward. All maps stay empty when there are no qualifying
    // clusters, so a graph without standoffs lays out exactly as before.
    const looseTargetIds = new Set(layoutTargets.map((n) => n.id));
    const clusterLeaderOf = new Map<string, string>();    // member -> leader
    const clusterMembersOf = new Map<string, string[]>(); // leader -> members
    const clusterMemberOffset = new Map<string, { dx: number; dy: number }>();
    const clusterLeaderSize = new Map<string, { w: number; h: number }>();
    // The leader's REAL size, restored after ELK (the applier resizes proxy
    // nodes to their reported size — here the whole-cluster bbox — so without
    // this the leader node grows to the block's footprint, like realHostSize).
    const clusterLeaderRealSize = new Map<string, { w: number; h: number }>();
    const clusterFollowers = new Set<string>();
    if (!standoffStore.isEmpty()) {
      // measuredBox: same size chokepoint as align/autofit — live size first,
      // collapse-aware stored fallback, guaranteed non-zero.
      const boxOf = (id: string) => measuredBox(area, id, editor);
      for (const cluster of standoffClusters(standoffStore.all())) {
        // Every member must be a loose layout target. A group qualifies — it
        // lays out as one rectangle, so a (group, note) pair is one block.
        // Anything excluded from the loose layout falls back to the settle.
        if (!cluster.every((id) => looseTargetIds.has(id))) continue;
        const boxes = cluster
          .map((id) => [id, boxOf(id)] as const)
          .filter((e): e is [string, NonNullable<ReturnType<typeof boxOf>>] => !!e[1]);
        if (boxes.length < 2) continue;
        const ox = Math.min(...boxes.map(([, b]) => b.x));
        const oy = Math.min(...boxes.map(([, b]) => b.y));
        const ex = Math.max(...boxes.map(([, b]) => b.x + b.w));
        const ey = Math.max(...boxes.map(([, b]) => b.y + b.h));
        // Leader = top-left-most member, preferring a non-group (a plain node
        // is a simpler ELK stand-in than a group, which carries its own
        // member-edge remapping).
        const leader = boxes.slice().sort((a, b) => {
          const ga = editor.getNode(a[0]) instanceof GroupNode ? 1 : 0;
          const gb = editor.getNode(b[0]) instanceof GroupNode ? 1 : 0;
          return ga !== gb ? ga - gb : (a[1].x + a[1].y) - (b[1].x + b[1].y);
        })[0][0];
        const leaderBox = boxes.find(([id]) => id === leader)![1];
        clusterLeaderRealSize.set(leader, { w: leaderBox.w, h: leaderBox.h });
        clusterMembersOf.set(leader, boxes.map(([id]) => id));
        clusterLeaderSize.set(leader, { w: ex - ox, h: ey - oy });
        for (const [id, b] of boxes) {
          clusterLeaderOf.set(id, leader);
          clusterMemberOffset.set(id, { dx: b.x - ox, dy: b.y - oy });
          if (id !== leader) clusterFollowers.add(id);
        }
      }
    }
    // Map a node to its ELK stand-in: a cluster follower/leader → its leader.
    const elkId = (id: string) => clusterLeaderOf.get(id) ?? id;

    const bridges: Schemes["Connection"][] = [];
    for (const fcId of dockedFcIds) {
      const ins  = conns.filter((c) => c.target === fcId && c.targetInput === "in");
      const outs = conns.filter((c) => c.source === fcId && c.sourceOutput === "out");
      for (const i of ins) for (const o of outs) {
        bridges.push({
          id: `tidy-bridge-${i.id}-${o.id}`,
          source: i.source, sourceOutput: i.sourceOutput,
          target: o.target, targetInput: o.targetInput,
        } as unknown as Schemes["Connection"]);
      }
    }
    // A group lays out as one node; remap any cable touching a member to the
    // group, so ELK positions the group by its real connections. The group
    // endpoint uses an EMPTY socket key → the plugin makes it a node-level
    // edge (no port to match). (Skipped for a within-group tidy.)
    if (!withinGroup) {
      for (const c of conns) {
        const sg = memberOf.get(c.source);
        const tg = memberOf.get(c.target);
        if (!sg && !tg) continue;
        const sId = sg ? sg.id : c.source;
        const tId = tg ? tg.id : c.target;
        if (sId === tId) continue; // internal to one group
        bridges.push({
          id: `tidy-gbridge-${c.id}`,
          source: sId, sourceOutput: sg ? "" : c.sourceOutput,
          target: tId, targetInput: tg ? "" : c.targetInput,
        } as unknown as Schemes["Connection"]);
      }
    }
    // When arranging a subset, only feed ELK the edges whose BOTH
    // endpoints are in the subset. An edge pointing at an excluded
    // node makes ELK throw → the layout silently fails and nothing
    // moves. (For the whole-graph case this keeps every edge.)
    // ELK sees one node per cluster (the leader); followers are excluded and
    // their edges remap to the leader as node-level edges (empty port key),
    // exactly like the group remap above. Identity when there are no clusters.
    const elkVisible = new Set(
      layoutTargets.filter((n) => !clusterFollowers.has(n.id)).map((n) => n.id),
    );
    const subsetConns = [...conns, ...bridges].flatMap((c) => {
      const s = elkId(c.source);
      const t = elkId(c.target);
      if (s === t || !elkVisible.has(s) || !elkVisible.has(t)) return [];
      return [{
        ...c,
        source: s, sourceOutput: s !== c.source ? "" : c.sourceOutput,
        target: t, targetInput: t !== c.target ? "" : c.targetInput,
      } as unknown as Schemes["Connection"]];
    });
    // Reserve each host's docked-FC area so ELK doesn't pack a neighbor into
    // it. ELK nodes are rectangles, so we feed it the bounding box of the
    // host + its output-docked FC: the host stays at the box's top-left and
    // the FC extends right (and down, from where its socket actually sits).
    // ONLY hosts that are actually IN the layout: a host that's a group
    // MEMBER (global tidy lays out the group as one unit, not its members)
    // gets no proxy, so reserving it did nothing — but the "restore" below
    // still ran area.resize on it, stamping a fixed inline height on a card
    // the pin-drop loop (which walks layoutTargets) never clears. That froze
    // the member's card height after every global Tidy (and, with a stale
    // width/height mirror, visibly resized it).
    const layoutTargetIds = new Set(layoutTargets.map((n) => n.id));
    const hostFootprint = new Map<string, { w: number; h: number }>();
    const realHostSize = new Map<string, { w: number; h: number }>();
    for (const fcId of dockedFcIds) {
      const fc = editor.getNode(fcId);
      if (!(fc instanceof FormatControllerNode) || fc.side !== "output") continue;
      if (!layoutTargetIds.has(fc.hostNodeId)) continue;
      const host = editor.getNode(fc.hostNodeId);
      const hostView = area.nodeViews.get(fc.hostNodeId);
      if (!host || !hostView) continue;
      // measuredBox for both boxes: the live rendered size, not the possibly
      // pre-paint constructor estimate on node.width/height.
      const hostBox = measuredBox(area, fc.hostNodeId, editor) ?? { w: host.width, h: host.height };
      const fcBox = measuredBox(area, fcId, editor) ?? { w: fc.width, h: fc.height };
      const sc = getSocketScreenCenter(area, fc.hostNodeId, fc.socketKey, "output");
      const socketLocalY = sc
        ? screenToCanvas(area, container, sc.x, sc.y).y - hostView.position.y
        : hostBox.h / 2;
      const prev = hostFootprint.get(fc.hostNodeId) ?? { w: hostBox.w, h: hostBox.h };
      hostFootprint.set(fc.hostNodeId, {
        w: prev.w + fcBox.w + 8,
        h: Math.max(prev.h, socketLocalY + fcBox.h / 2),
      });
      if (!realHostSize.has(fc.hostNodeId)) realHostSize.set(fc.hostNodeId, { w: hostBox.w, h: hostBox.h });
    }

    const proxyNodes = layoutTargets.filter((n) => !clusterFollowers.has(n.id)).map((n) => {
      // A non-group standoff-cluster leader lays out as a single rectangle
      // sized to the whole cluster's bounding box, so ELK reserves room for
      // the block (its own ports stay, carrying real + remapped edges).
      const clusterSize = clusterLeaderSize.get(n.id);
      if (clusterSize && !(n instanceof GroupNode)) {
        return new Proxy(n, {
          get(target, prop) {
            if (prop === "width") return clusterSize.w;
            if (prop === "height") return clusterSize.h;
            return Reflect.get(target, prop);
          },
        });
      }
      // A group lays out as a single rectangle (its rendered box, or the
      // cluster bbox when it's a cluster leader) with no ports — edges to it
      // are node-level (see the gbridge above).
      if (n instanceof GroupNode) {
        const gb = measuredBox(area, n.id, editor);
        const gw = clusterSize?.w ?? (gb?.w || n.width);
        const gh = clusterSize?.h ?? (gb?.h || n.height);
        return new Proxy(n, {
          get(target, prop) {
            if (prop === "width") return gw;
            if (prop === "height") return gh;
            if (prop === "inputs")  return {};
            if (prop === "outputs") return {};
            return Reflect.get(target, prop);
          },
        });
      }
      const fp = hostFootprint.get(n.id);
      // The Conduit declares all its lanes up front, which would make ELK
      // treat it as a tall multi-port node. Expose only the in-use ports
      // (or one, when nothing is wired) so it lays out small.
      const isBundler = n instanceof ConduitNode;
      if (!fp && !isBundler) return n;
      let filteredInputs:  Record<string, unknown> | undefined;
      let filteredOutputs: Record<string, unknown> | undefined;
      if (isBundler) {
        const usedInputs = new Set<string>();
        const usedOutputs = new Set<string>();
        for (const c of conns) {
          if (c.target === n.id && typeof c.targetInput === "string") usedInputs.add(c.targetInput);
          if (c.source === n.id && typeof c.sourceOutput === "string") usedOutputs.add(c.sourceOutput);
        }
        // If nothing is wired yet, expose a single in / out so ELK still has
        // something to anchor to.
        if (usedInputs.size  === 0) usedInputs.add(Object.keys(n.inputs)[0]);
        if (usedOutputs.size === 0) usedOutputs.add(Object.keys(n.outputs)[0]);
        filteredInputs = {}; filteredOutputs = {};
        for (const k of usedInputs)  filteredInputs[k]  = (n.inputs  as Record<string, unknown>)[k];
        for (const k of usedOutputs) filteredOutputs[k] = (n.outputs as Record<string, unknown>)[k];
      }
      return new Proxy(n, {
        get(target, prop) {
          if (fp && prop === "width")  return fp.w;
          if (fp && prop === "height") return fp.h;
          if (filteredInputs  && prop === "inputs")  return filteredInputs;
          if (filteredOutputs && prop === "outputs") return filteredOutputs;
          return Reflect.get(target, prop);
        },
      });
    });
    // Anchor target. ELK lays out from origin (0,0); we shift the result back.
    // HORIZONTALLY we keep the LEFT edge (graphs flow left→right from where they
    // started). VERTICALLY we keep the CENTER, NOT the top: ELK routinely
    // flattens a tall / vertically-stacked cluster into a compact row, and
    // top-aligning that row drops the whole thing to the top of the old
    // footprint — the "tidy floats nodes up" bug. For a within-group tidy the
    // references are the box interior's left and vertical center. Both are
    // deterministic, so a tidy→autofit cycle in Cleanup stays a fixed point
    // (after autofit the interior wraps the members, so the centre is unchanged).
    let origMinX = Infinity;   // left edge to preserve
    let targetCy = 0;          // vertical centre to preserve
    if (withinGroup) {
      const gv = area.nodeViews.get(withinGroup.id);
      if (gv) {
        origMinX = gv.position.x + GROUP_PAD;
        const top = gv.position.y + GROUP_HEADER + GROUP_PAD;
        const bottom = gv.position.y + withinGroup.height - GROUP_PAD;
        targetCy = (top + bottom) / 2;
      }
    } else {
      let oldTop = Infinity, oldBottom = -Infinity;
      for (const n of layoutTargets) {
        const b = measuredBox(area, n.id, editor);
        if (!b) continue;
        origMinX = Math.min(origMinX, b.x);
        oldTop = Math.min(oldTop, b.y);
        oldBottom = Math.max(oldBottom, b.y + b.h);
      }
      targetCy = (oldTop + oldBottom) / 2;
    }

    // Remember each laid-out group's pre-move position so we can carry its
    // members along by the same delta afterward (members aren't in the layout).
    const groupOrigPos = new Map<string, { x: number; y: number }>();
    for (const n of layoutTargets) {
      if (n instanceof GroupNode) {
        const v = area.nodeViews.get(n.id);
        if (v) groupOrigPos.set(n.id, { x: v.position.x, y: v.position.y });
      }
    }

    // First Tidy pays the one-time ELK import here; later ones resolve instantly.
    // Null only if the area was destroyed mid-import — nothing left to lay out.
    const arrangePlugin = await ensureArrange();
    if (!arrangePlugin) return;
    await arrangePlugin.layout({
      nodes: proxyNodes as Schemes["Node"][],
      connections: subsetConns,
      // ELK spacing (the preset's `spacing` is only port placement). Widen
      // the gaps Tidy leaves so nodes — and their docked-FC footprints — get
      // breathing room: between layers (columns) and within a layer (rows).
      options: {
        "elk.layered.spacing.nodeNodeBetweenLayers": "55",
        "elk.spacing.nodeNode": "38",
      },
    });

    // Place each standoff cluster's members relative to where ELK put the
    // leader — which now occupies the cluster's bounding box top-left — so the
    // block keeps its internal layout. Done before the anchor calc so the
    // members' fresh positions feed it (followers weren't in the ELK pass).
    for (const [leader, members] of clusterMembersOf) {
      const lv = area.nodeViews.get(leader);
      if (!lv) continue;
      const baseX = lv.position.x;
      const baseY = lv.position.y;
      for (const mid of members) {
        const off = clusterMemberOffset.get(mid)!;
        await area.translate(mid, { x: baseX + off.dx, y: baseY + off.dy });
      }
    }

    // Restore the real size of any host we enlarged for the layout — the
    // applier resized it to the reserved footprint; the FC occupies the rest.
    // BEFORE the anchor measurement below: the pre-layout anchor read real
    // sizes, so measuring the new extent off a still-inflated host/leader
    // would skew the preserved vertical centre by half the inflation.
    for (const [id, sz] of realHostSize) {
      await area.resize(id, sz.w, sz.h);
    }
    // Same for standoff-cluster leaders, which were sized to the cluster bbox
    // for the ELK pass — restore each to its real node size.
    for (const [id, sz] of clusterLeaderRealSize) {
      await area.resize(id, sz.w, sz.h);
    }

    // Shift the laid-out nodes: left edge → anchor left, vertical centre →
    // anchor centre.
    let newMinX = Infinity, newTop = Infinity, newBottom = -Infinity;
    for (const n of layoutTargets) {
      const b = measuredBox(area, n.id, editor);
      if (!b) continue;
      newMinX = Math.min(newMinX, b.x);
      newTop = Math.min(newTop, b.y);
      newBottom = Math.max(newBottom, b.y + b.h);
    }
    const dx = origMinX - newMinX;
    let dy = targetCy - (newTop + newBottom) / 2;
    // Within a group, never let centring lift members above the box header.
    if (withinGroup) {
      const gv = area.nodeViews.get(withinGroup.id);
      if (gv) {
        const interiorTop = gv.position.y + GROUP_HEADER + GROUP_PAD;
        if (newTop + dy < interiorTop) dy = interiorTop - newTop;
      }
    }
    if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
      for (const n of layoutTargets) {
        const v = area.nodeViews.get(n.id);
        if (!v) continue;
        await area.translate(n.id, { x: v.position.x + dx, y: v.position.y + dy });
      }
    }

    // Carry each group's members rigidly by the group's net move (members
    // were held out of the layout, so they keep their relative positions).
    for (const [gid, orig] of groupOrigPos) {
      const gv = area.nodeViews.get(gid);
      const grp = editor.getNode(gid);
      if (!gv || !(grp instanceof GroupNode)) continue;
      const gdx = gv.position.x - orig.x;
      const gdy = gv.position.y - orig.y;
      if (gdx === 0 && gdy === 0) continue;
      for (const mid of grp.members) {
        const mv = area.nodeViews.get(mid);
        if (!mv) continue;
        await area.translate(mid, { x: mv.position.x + gdx, y: mv.position.y + gdy });
      }
    }

    // Drop the inline `height` AND `width` the applier / footprint restore stamped
    // on every arranged card. area.resize (the applier's reserve-footprint trick,
    // and the realHostSize/clusterLeaderRealSize restores above) writes FIXED inline
    // dims on the card. The height pin freezes the card so the body can't shrink on
    // collapse or grow when a taller value lands (the reason clearPinnedHeight exists).
    // The width pin is WORSE than redundant: the restore stamps measuredBox().w —
    // which is offsetWidth (border-box, so it INCLUDES the 1px border) — as
    // style.width on the content-box `.solenoid-node` card, so each Tidy grows the
    // card (and any group autofitting around it) by the border width. It compounds
    // only when a footprint restore runs, i.e. when an FC is docked to the host —
    // exactly the "num → Display + Format Controller widens on every Tidy" repro.
    // Clearing both returns every node to its content/CSS/React-driven size; positions
    // are already applied via translate. A manually-resized Display carries its width
    // in nodeSizeStore (React sets it from the `style` prop, which the imperative pin
    // overwrote and React won't re-diff), so re-apply that width instead of dropping
    // it. Groups are skipped — their box is sized from React width/height props.
    for (const n of layoutTargets) {
      if (n instanceof GroupNode) continue;
      const card = area.nodeViews.get(n.id)?.element.querySelector<HTMLElement>("*:not(span):not([fragment])");
      if (!card) continue;
      card.style.removeProperty("height");
      const manual = nodeSizeStore.get(n.id);
      if (manual) card.style.width = `${Math.round(manual.w)}px`;
      else card.style.removeProperty("width");
    }

    // Within-group tidy: autogrow the box around the freshly-laid-out
    // members, then refresh membership/collapse. Don't reframe the viewport.
    if (withinGroup) {
      let maxX = -Infinity, maxY = -Infinity;
      for (const n of layoutTargets) {
        // measuredBox, not raw offsetWidth: an unpainted member measured 0 and
        // silently under-grew the box.
        const b = measuredBox(area, n.id, editor);
        if (!b) continue;
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const gv = area.nodeViews.get(withinGroup.id);
      const preW = withinGroup.width, preH = withinGroup.height;
      if (gv && Number.isFinite(maxX)) {
        // Integer dims, same rule as every other group resize source (creation,
        // autofit, the grips — see 8622a72): ELK positions are fractional, and a
        // fractional width puts the box edge on a half-pixel (selection-ring blur).
        withinGroup.width = Math.round(Math.max(withinGroup.width, (maxX - gv.position.x) + GROUP_PAD));
        withinGroup.height = Math.round(Math.max(withinGroup.height, (maxY - gv.position.y) + GROUP_PAD));
        await area.update("node", withinGroup.id);
      }
      rebuildGroupMembership(editor);
      syncGroupCollapse(editor, area);
      // A within-group Tidy can autogrow the box; if it did, push the
      // neighbouring nodes/groups off the grown edges (recording it so a
      // later collapse restores them) — the same engine as the expand push.
      // Cleanup skips this: it manages its own collapse/restore + re-tidy.
      if (!opts?.skipPush && (withinGroup.width > preW + 0.5 || withinGroup.height > preH + 0.5)) {
        pushForGrownGroups(editor, area, [withinGroup], new Map([[withinGroup.id, { w: preW, h: preH }]]));
      }
    }

    // Persist the new layout. Tidy moves every node via area.translate, but
    // nothing else schedules a save — so a whole-canvas or selection tidy was
    // lost on reload (only the within-group branch used to call this). The
    // 700ms autosave debounce reads positions at flush time, so the deferred
    // standoff/FC settle below is still captured.
    scheduleAutosave();

    // Restore the selection we cleared above.
    selectedIds.forEach((id, i) => selectNodeFromProcess(id, i > 0));

    // A SELECTION tidy frames just the arranged nodes, right away.
    if (!withinGroup && selectedIds.length > 0) await AreaExtensions.zoomAt(area, targets);

    // ELK lays out docked FCs as ordinary chain nodes; snap each back onto
    // its host once the hosts have settled. Deferred a frame so the sockets
    // render at the new host positions before we measure them.
    requestAnimationFrame(async () => {
      if (isDestroyed()) return;
      const hosts = new Set<string>();
      for (const n of editor.getNodes()) {
        if (n instanceof FormatControllerNode && n.hostNodeId) hosts.add(n.hostNodeId);
      }
      for (const h of hosts) repositionDockedTo(h);
      // Standoffs re-settle around wherever ELK put things (the layered
      // layout doesn't know about them; the network does the last word).
      // forceLock so a standoff-connected cluster is pulled back together as
      // a rigid block, not just band-satisfied.
      settleStandoffs(undefined, { forceLock: true });
      // A WHOLE-CANVAS tidy fits AFTER the FCs settle, using the same chrome-
      // and collapse-aware fit as the navmenu / Cleanup — a raw zoomAt would
      // center in the full container and land content under the docked panels.
      if (!withinGroup && selectedIds.length === 0) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (!isDestroyed()) await fitAll();
      }
    });
  };
}

// One-shot "Cleanup": clear selection → tidy each group's members + shrink its
// box to fit → collapse all groups → tidy the top level → fit the view.
// Members are laid out inside their boxes first, then the collapsed groups +
// loose nodes are arranged as units, so nothing is tidied twice. Confirms past
// the same threshold as Tidy (it's a bigger, harder-to-undo change), counting
// layout UNITS the same way.
export function makeCleanupFn(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  arrangeFn: ArrangeFn,
): () => Promise<void> {
  return async () => {
    const allNodes = editor.getNodes();
    const groupsForCount = allNodes.filter((n): n is GroupNode => n instanceof GroupNode);
    const memberIds = new Set<string>();
    for (const g of groupsForCount) for (const m of g.members) memberIds.add(m);
    const unitCount = allNodes.filter(
      (n) => !(n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id)) && !memberIds.has(n.id),
    ).length;
    if (unitCount > TIDY_CONFIRM_THRESHOLD) {
      const ok = await requestConfirm({
        message: `Cleanup will tidy, collapse, and re-fit all ${unitCount} items. Continue?`,
        confirmLabel: "Cleanup",
      });
      if (!ok) return;
    }

    unselectAllNodesFromProcess();
    cableSelectionStore.set(null);

    const groupsNow = () =>
      editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);

    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    // 1. Tidy every group's members first. The within-group tidy snaps docked
    //    FCs back onto their hosts in a DEFERRED rAF, so a docked FC (a group
    //    member) is momentarily at its ELK chain position out to the right.
    const groups = groupsNow();
    for (const g of groups) await arrangeFn({ groupId: g.id, skipPush: true });
    // Let those deferred FC snap-backs (and their async translates) land
    // before measuring, or autofit would wrap the stale far-right FC spots
    // and pad the box on the right (the bug that didn't repro on a manual,
    // already-settled grip double-click). Two frames: one for the rAF to
    // fire, one for the translate guard to apply.
    await nextFrame(); await nextFrame();
    // Now shrink/grow each box to wrap its settled members.
    for (const g of groups) await autofitGroupBox(editor, area, g);

    // 2. Collapse every still-expanded group.
    const toCollapse = groupsNow().filter((g) => !g.collapsed);
    if (toCollapse.length) {
      for (const g of toCollapse) g.collapsed = true;
      syncGroupCollapse(editor, area);
      for (const g of toCollapse) {
        await area.update("node", g.id);
        settleCollapse(editor, area, g.id, g.members, false);
      }
    }

    // 3. Tidy the top level (groups as rigid collapsed units), no confirm.
    await arrangeFn({ skipConfirm: true });

    // 4. Fit — reuse the navmenu's chrome-aware fitAll (drops hidden
    // members, sizes collapsed groups to their compact box, frames into the
    // free rectangle between the docked panels). A raw zoomAt here centered
    // content in the full container, so it landed under the panels and
    // scaled off. Wait a frame first so step-3's translates + the collapse
    // settle before fitAll measures.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await fitAll();

    scheduleAutosave();
  };
}
