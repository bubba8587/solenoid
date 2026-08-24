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

// Ports placed SYMMETRICALLY (same offset for in/out) so two connected nodes line
// up — do NOT fall back to the plugin's `classic` preset.
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

export type TidyDirection = "right" | "down";
export type TidyDensity = "compact" | "normal" | "airy";
export type TidyWidthCap = 0 | 2 | 3 | 4;

// Between-layers / within-layer node spacing per density. `normal` is today's 55/38.
const TIDY_DENSITY_SPACING: Record<TidyDensity, readonly [number, number]> = {
  compact: [36, 24],
  normal:  [55, 38],
  airy:    [80, 56],
};

/** The ELK layout options for the three Tidy knobs, read at layout time by BOTH call
 *  sites (main canvas + composite drill-in). `elk.algorithm`/`hierarchyHandling`/
 *  `edgeRouting` still come from the arrange plugin's root defaults; this only sets what
 *  the knobs drive. A width cap needs COFFMAN_GRAHAM — `layerBound` is inert otherwise. */
export function tidyLayoutOptions(s: {
  direction: TidyDirection;
  density: TidyDensity;
  widthCap: TidyWidthCap;
}): Record<string, string> {
  const [betweenLayers, nodeNode] = TIDY_DENSITY_SPACING[s.density];
  const opts: Record<string, string> = {
    "elk.direction": s.direction === "down" ? "DOWN" : "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": String(betweenLayers),
    "elk.spacing.nodeNode": String(nodeNode),
  };
  if (s.widthCap > 0) {
    opts["elk.layered.layering.strategy"] = "COFFMAN_GRAHAM";
    opts["elk.layered.layering.coffmanGraham.layerBound"] = String(s.widthCap);
  }
  return opts;
}

// ELK is a heavy chunk only Tidy needs — wire it on first arrange, never at init.
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

// Nodes are handed to ELK as Proxies; a Proxy preserves `id`, so the applier
// still translates the real node.
export function makeArrangeFn(deps: TidyDeps): ArrangeFn {
  const { editor, area, container, ensureArrange, repositionDockedTo, isDestroyed } = deps;
  return async (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => {
    const all = editor.getNodes();
    const selected = all.filter((n) => (n as { selected?: boolean }).selected);

    const allGroups = all.filter((n): n is GroupNode => n instanceof GroupNode);
    const memberOf = new Map<string, GroupNode>();
    for (const g of allGroups) for (const m of g.members) memberOf.set(m, g);

    const forcedGroup = opts?.groupId
      ? allGroups.find((g) => g.id === opts.groupId) ?? null
      : null;

    const targets = forcedGroup
      ? forcedGroup.members.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n)
      : (selected.length > 0 ? selected : all);
    if (targets.length === 0) return;

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
      // Count layout UNITS, mirroring layoutTargets' predicate below, or the
      // dialog misstates the scope of the change.
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

    // A selected node's translate triggers the selector's group-follow, which
    // would compound across the applier's per-node placement.
    const selectedIds = selected.map((n) => n.id);
    if (selectedIds.length > 0) unselectAllNodesFromProcess();

    const conns = editor.getConnections();
    // Docked FCs are adornments, not graph nodes: exclude them and bridge their
    // inline edges (host → FC → consumer becomes host → consumer) so the real
    // graph lays out; they are snapped back onto their hosts after.
    const dockedFcIds = new Set(
      tidyNodes
        .filter((n) => n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id))
        .map((n) => n.id),
    );
    // Global tidy keeps GROUPS as rigid units and excludes their members;
    // within-group tidy keeps exactly that group's members.
    const memberIds = new Set(memberOf.keys());
    const layoutTargets = tidyNodes.filter(
      (n) => !dockedFcIds.has(n.id) && (withinGroup ? true : !memberIds.has(n.id)),
    );

    // Standoff clusters lay out as ONE rigid block: collapse each fully-loose
    // cluster into a bbox-sized leader, re-placing members at stored offsets after.
    const looseTargetIds = new Set(layoutTargets.map((n) => n.id));
    const clusterLeaderOf = new Map<string, string>();    // member -> leader
    const clusterMembersOf = new Map<string, string[]>(); // leader -> members
    const clusterMemberOffset = new Map<string, { dx: number; dy: number }>();
    const clusterLeaderSize = new Map<string, { w: number; h: number }>();
    // The leader's REAL size, restored after ELK — the applier resizes a proxy node
    // to its reported size, here the whole-cluster bbox.
    const clusterLeaderRealSize = new Map<string, { w: number; h: number }>();
    const clusterFollowers = new Set<string>();
    if (!standoffStore.isEmpty()) {
      const boxOf = (id: string) => measuredBox(area, id, editor);
      for (const cluster of standoffClusters(standoffStore.all())) {
        // Every member must be a loose layout target; anything excluded from the
        // loose layout falls back to the settle.
        if (!cluster.every((id) => looseTargetIds.has(id))) continue;
        const boxes = cluster
          .map((id) => [id, boxOf(id)] as const)
          .filter((e): e is [string, NonNullable<ReturnType<typeof boxOf>>] => !!e[1]);
        if (boxes.length < 2) continue;
        const ox = Math.min(...boxes.map(([, b]) => b.x));
        const oy = Math.min(...boxes.map(([, b]) => b.y));
        const ex = Math.max(...boxes.map(([, b]) => b.x + b.w));
        const ey = Math.max(...boxes.map(([, b]) => b.y + b.h));
        // Leader = top-left-most member, preferring a non-group (a group carries
        // its own member-edge remapping).
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
    // Remap any cable touching a member to the group, with an EMPTY socket key so
    // the plugin makes it a node-level edge (no port to match).
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
    // Feed ELK only edges with BOTH endpoints visible — an edge pointing at an
    // excluded node makes ELK throw and the layout silently fails; follower edges
    // remap onto the cluster leader as node-level edges.
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
    // Reserve each host's docked-FC area (the host + FC bounding box) so ELK doesn't
    // pack a neighbor into it — ONLY for hosts actually IN the layout, else the
    // restore below stamps a fixed inline height the pin-drop loop never clears.
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
      // measuredBox: the live rendered size, not the pre-paint constructor estimate.
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
      // A non-group cluster leader lays out as one rectangle sized to the cluster
      // bbox, so ELK reserves room for the whole block.
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
      // A group lays out as a single portless rectangle — edges to it are node-level.
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
      // The Conduit declares all its lanes up front; expose only the in-use ports
      // so ELK doesn't treat it as a tall multi-port node.
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
        // Nothing wired yet: expose a single in/out so ELK still has an anchor.
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
    // ELK lays out from origin; shift the result back keeping the LEFT edge and the
    // vertical CENTER (never the top), so a tidy→autofit cycle stays a fixed point.
    let origMinX = Infinity;
    let targetCy = 0;
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

    // Members aren't in the layout, so carry them by the group's own delta after.
    const groupOrigPos = new Map<string, { x: number; y: number }>();
    for (const n of layoutTargets) {
      if (n instanceof GroupNode) {
        const v = area.nodeViews.get(n.id);
        if (v) groupOrigPos.set(n.id, { x: v.position.x, y: v.position.y });
      }
    }

    // Null only if the area was destroyed mid-import — nothing left to lay out.
    const arrangePlugin = await ensureArrange();
    if (!arrangePlugin) return;
    await arrangePlugin.layout({
      nodes: proxyNodes as Schemes["Node"][],
      connections: subsetConns,
      // ELK spacing (the preset's `spacing` is only port placement).
      options: {
        "elk.layered.spacing.nodeNodeBetweenLayers": "55",
        "elk.spacing.nodeNode": "38",
      },
    });

    // Place cluster members relative to the leader's new position, BEFORE the anchor
    // calc so their fresh positions feed it.
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

    // Restore hosts inflated for the layout BEFORE the anchor measurement, or
    // the preserved vertical center skews by half the inflation.
    for (const [id, sz] of realHostSize) {
      await area.resize(id, sz.w, sz.h);
    }
    // Same for cluster leaders, sized to the cluster bbox for the ELK pass.
    for (const [id, sz] of clusterLeaderRealSize) {
      await area.resize(id, sz.w, sz.h);
    }

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
    // Within a group, never let centering lift members above the box header.
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

    // Members were held out of the layout, so carry them rigidly by the net move.
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

    // Drop the inline height/width the applier stamped, re-applying a manually-sized
    // width from nodeSizeStore (React won't re-diff what the imperative pin wrote).
    // ONLY `.solenoid-node` roots — every other root sets its inline size from React's
    // `style` prop, which removeProperty would strip with no re-stamp.
    for (const n of layoutTargets) {
      const card = area.nodeViews.get(n.id)?.element.querySelector<HTMLElement>("*:not(span):not([fragment])");
      if (!card || !card.classList.contains("solenoid-node")) continue;
      card.style.removeProperty("height");
      const manual = nodeSizeStore.get(n.id);
      if (manual) card.style.width = `${Math.round(manual.w)}px`;
      else card.style.removeProperty("width");
    }

    if (withinGroup) {
      let maxX = -Infinity, maxY = -Infinity;
      for (const n of layoutTargets) {
        // measuredBox, not offsetWidth: an unpainted member measures 0 and under-grows.
        const b = measuredBox(area, n.id, editor);
        if (!b) continue;
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const gv = area.nodeViews.get(withinGroup.id);
      const preW = withinGroup.width, preH = withinGroup.height;
      if (gv && Number.isFinite(maxX)) {
        // Integer dims: a fractional width puts the box edge on a half-pixel (blur).
        withinGroup.width = Math.round(Math.max(withinGroup.width, (maxX - gv.position.x) + GROUP_PAD));
        withinGroup.height = Math.round(Math.max(withinGroup.height, (maxY - gv.position.y) + GROUP_PAD));
        await area.update("node", withinGroup.id);
      }
      rebuildGroupMembership(editor);
      syncGroupCollapse(editor, area);
      // An autogrown box pushes its neighbours off the grown edges; Cleanup skips
      // this, managing its own collapse/restore + re-tidy.
      if (!opts?.skipPush && (withinGroup.width > preW + 0.5 || withinGroup.height > preH + 0.5)) {
        pushForGrownGroups(editor, area, [withinGroup], new Map([[withinGroup.id, { w: preW, h: preH }]]));
      }
    }

    // area.translate schedules nothing; the autosave debounce reads positions at
    // flush time, so the deferred settle below is still captured.
    scheduleAutosave();

    selectedIds.forEach((id, i) => selectNodeFromProcess(id, i > 0));

    if (!withinGroup && selectedIds.length > 0) await AreaExtensions.zoomAt(area, targets);

    // Snap docked FCs back onto their hosts, deferred a frame so the sockets render
    // at the new host positions before we measure them.
    requestAnimationFrame(async () => {
      if (isDestroyed()) return;
      const hosts = new Set<string>();
      for (const n of editor.getNodes()) {
        if (n instanceof FormatControllerNode && n.hostNodeId) hosts.add(n.hostNodeId);
      }
      for (const h of hosts) repositionDockedTo(h);
      // forceLock so a standoff cluster is pulled back together as a rigid block,
      // not merely band-satisfied.
      settleStandoffs(undefined, { forceLock: true });
      // fitAll, never a raw zoomAt: zoomAt centers in the full container and lands
      // content under the docked panels.
      if (!withinGroup && selectedIds.length === 0) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (!isDestroyed()) await fitAll();
      }
    });
  };
}

// Members are laid out inside their boxes first, then the collapsed groups + loose
// nodes are arranged as units, so nothing is tidied twice.
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

    // 1. Tidy every group's members.
    const groups = groupsNow();
    for (const g of groups) await arrangeFn({ groupId: g.id, skipPush: true });
    // Two frames (rAF fire, then translate guard) so the within-group tidy's deferred
    // FC snap-backs land — else autofit pads the box around stale far-right FC spots.
    await nextFrame(); await nextFrame();
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

    // 4. Fit. Wait a frame so step-3's translates and the collapse settle first.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await fitAll();

    scheduleAutosave();
  };
}
