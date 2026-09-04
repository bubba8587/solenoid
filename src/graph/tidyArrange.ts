import type { View } from "./view";
import { zoomAt } from "./zoomAt";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { requestConfirm } from "./confirmStore";
import { settingsStore } from "./settingsStore";
import { cableSelectionStore } from "./cableState";
import { ConduitNode, FormatControllerNode, GroupNode } from "./rete-nodes";
import { autofitGroupBox, GROUP_PAD, GROUP_HEADER } from "./groupLogic";
import { measuredBox } from "./nodeSize";
import { nodeSizeStore } from "./nodeSizeStore";
import { pushForGrownGroups } from "./groupPush";
import { separateOverlaps, PUSH_GAP, type PushBox } from "./groupPushCore";
import { socketFlipStore } from "./socketFlipStore";
import { collapseStore } from "./collapseStore";
import { standoffStore, standoffClusters, settleStandoffs } from "./standoffs";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse, settleCollapse } from "./groupCollapse";
import { fitAll } from "./NavMenu";
import { dockedNodeStore } from "./dockedNodeStore";
import { getSocketScreenCenter, screenToCanvas } from "./canvasGeometry";
import { scheduleAutosave } from "./persistence";
import { unselectAllNodes as unselectAllNodesFromProcess, selectNode as selectNodeFromProcess } from "./canvasCommands";
const TIDY_CONFIRM_THRESHOLD = 12;

export interface TidyDeps {
  editor: NodeEditor<Schemes>;
  view: View;
  container: HTMLElement;
  ensureElk: () => Promise<Elk | null>;
  /** Snap every FC docked to `hostId` back onto its socket (defined in the init effect). */
  repositionDockedTo: (hostId: string) => void;
  /** The mount's destroyed flag — deferred rAF work must bail after unmount. */
  isDestroyed: () => boolean;
}

export type ArrangeFn = (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => Promise<void>;

// Ports placed SYMMETRICALLY (same offset for in/out) so two connected nodes line
// up — do NOT fall back to the plugin's `classic` preset. A factory over the layout
// DIRECTION: RIGHT puts inputs WEST / outputs EAST and spaces them down the card's
// height; DOWN transposes to NORTH / SOUTH, spaced across the card's width.
// A width cap wraps a fat layer into sublayers via ELK's per-node layerUnzipping.
// `layerSplit` is the sublayer COUNT and lives per-node; the arrange fn stamps it here
// from the layout's node count just before `layout()` (the preset factory re-runs per
// layout, so this closure reads the fresh value). 0 = uncapped.
let tidyLayerSplit = 0;

export function symmetricPortPreset(direction: TidyDirection) {
  const down = direction === "down";
  return {
    port(data: { side: "input" | "output"; index: number; ports: number; width: number; height: number }) {
      const spacing = 16;
      // The align axis follows the flow: RIGHT levels vertically, DOWN horizontally.
      const extent = down ? data.width : data.height;
      const along = settingsStore.get("tidyAlign") === "top"
        ? 20 + data.index * spacing
        : extent / 2 + (data.index - (data.ports - 1) / 2) * spacing;
      return down
        ? { x: along, y: 0, width: 15, height: 15, side: data.side === "output" ? "SOUTH" : "NORTH" } as const
        : { x: 0, y: along, width: 15, height: 15, side: data.side === "output" ? "EAST" : "WEST" } as const;
    },
    // layerSplit is per-node; stamp the same sublayer count on every card so the fat
    // layer wraps. Empty when uncapped so ELK keeps one layer per depth.
    options(_id: string): Record<string, string | number | boolean> {
      return tidyLayerSplit > 0
        ? { "elk.layered.layerUnzipping.layerSplit": String(tidyLayerSplit) }
        : {};
    },
  };
}

/** The Tidy knobs read from settings as an ELK option map — the app-facing wrapper over
 *  `tidyLayoutOptions`, used by both ELK call sites. */
export function tidyOptionsFromSettings(): Record<string, string> {
  const cap = settingsStore.get("tidyWidthCap");
  return tidyLayoutOptions({
    direction: settingsStore.get("tidyDirection"),
    density: settingsStore.get("tidyDensity"),
    widthCap: cap === "off" ? 0 : (Number(cap) as TidyWidthCap),
  });
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

/** The root ELK options every Tidy layout runs under — the one home, spread by
 *  `elkTidyLayout` and consumed verbatim by the integration test so the two
 *  cannot drift (per declareOnce). */
export const ELK_ROOT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "POLYLINE",
} as const;

/** Within-layer ordering lever, added ONLY when the layout holds a flipped node.
 *  `elkTidyLayout` emits flipped nodes LAST in the children array; forcing model order
 *  through crossing minimization then sorts them to the trailing edge of their layer
 *  (BELOW under RIGHT), so a flipped node lands down-and-left of its neighbor instead of
 *  up-and-left. ELK wants `considerModelOrder.strategy` set alongside the force flag —
 *  the flag assumes model order already survived into crossing minimization.
 *  With no flipped node these options are absent, so ordinary layouts are unchanged. */
export const FLIPPED_MODEL_ORDER_OPTIONS = {
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
} as const;

/** The ELK layout options for the three Tidy knobs, read at layout time by BOTH call
 *  sites (main canvas + composite drill-in). `elk.algorithm`/`hierarchyHandling`/
 *  `edgeRouting` come from `ELK_ROOT_OPTIONS`; this only sets what
 *  the knobs drive. A width cap turns ELK's layerUnzipping on (global switch here; the
 *  per-node sublayer count is stamped by the port preset from the node count). */
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
    opts["elk.layered.layerUnzipping.strategy"] = "ALTERNATING";
  }
  return opts;
}

/** Sublayer count for a width cap of "at most `cap` per row": ceil(count / cap), floored
 *  at 1. `count` is the WHOLE layout's node count — per-layer widths aren't known before
 *  ELK runs, so a graph with nodes outside the fat layer over-splits slightly. That errs
 *  SAFE: the widest layer holds W ≤ count, so W / ceil(count/cap) ≤ cap — never exceeds the
 *  cap. Shared by the arrange fn and the integration test so the two can't drift. */
export function tidyLayerSplitFor(nodeCount: number, widthCap: TidyWidthCap): number {
  return widthCap > 0 ? Math.max(1, Math.ceil(nodeCount / widthCap)) : 0;
}

// The layout engine, called DIRECTLY (rete-auto-arrange died with the rete
// surface; its ELK graph construction lives on in elkTidyLayout below).
export type Elk = { layout(graph: unknown): Promise<ElkResult> };
type ElkResult = { children?: Array<{ id?: string; x?: number; y?: number }> };

// ELK is a heavy chunk only Tidy needs — load it on first arrange, never at init.
export function makeEnsureElk(isDestroyed: () => boolean): () => Promise<Elk | null> {
  let elk: Elk | null = null;
  let loading: Promise<Elk | null> | null = null;
  return () => {
    if (elk) return Promise.resolve(elk);
    if (loading) return loading;
    loading = (async () => {
      const { default: ELK } = await import("elkjs");
      // A doc switch / unmount can destroy the surface during the dynamic import.
      if (isDestroyed()) return null;
      elk = new ELK() as unknown as Elk;
      return elk;
    })();
    // A failed fetch must not stick: clear the cached promise so the next Tidy retries.
    loading.catch(() => { loading = null; });
    return loading;
  };
}

/** The exact ELK graph rete-auto-arrange built (root layered/INCLUDE_CHILDREN/
 *  POLYLINE defaults, sorted FIXED_POS ports from symmetricPortPreset, port-id
 *  edges), run directly and applied through the given translate. */
export async function elkTidyLayout(
  elk: Elk,
  args: {
    nodes: ReadonlyArray<Schemes["Node"]>;
    connections: ReadonlyArray<{
      id: string; source: string; sourceOutput: string; target: string; targetInput: string;
    }>;
    options: Record<string, string>;
    translate: (id: string, x: number, y: number) => Promise<unknown> | unknown;
  },
): Promise<void> {
  const preset = symmetricPortPreset(settingsStore.get("tidyDirection"));
  const portId = (id: string, key: string, side: string) => [id, key, side].join("_");
  const byIndex = (rec: Record<string, { index?: number } | undefined>) =>
    Object.entries(rec).sort((a, b) => (a[1]?.index ?? 0) - (b[1]?.index ?? 0));
  // Flipped nodes go LAST so ELK's forced model order drops them to the trailing edge
  // of their layer; the order is otherwise untouched (see FLIPPED_MODEL_ORDER_OPTIONS).
  const isFlipped = (n: Schemes["Node"]) => socketFlipStore.get(n.id);
  const anyFlipped = args.nodes.some(isFlipped);
  const ordered = anyFlipped
    ? [...args.nodes.filter((n) => !isFlipped(n)), ...args.nodes.filter(isFlipped)]
    : args.nodes;
  const children = ordered.map((n) => {
    const node = n as unknown as {
      id: string; width: number; height: number;
      inputs?: Record<string, { index?: number } | undefined>;
      outputs?: Record<string, { index?: number } | undefined>;
    };
    const mk = (side: "input" | "output", entries: Array<[string, unknown]>) =>
      entries.map(([key], index) => {
        const p = preset.port({
          side, index, ports: entries.length, width: node.width, height: node.height,
        });
        return {
          id: portId(node.id, key, side),
          width: p.width, height: p.height, x: p.x, y: p.y,
          properties: { side: p.side },
        };
      });
    return {
      id: node.id,
      width: node.width,
      height: node.height,
      ports: [...mk("input", byIndex(node.inputs ?? {})), ...mk("output", byIndex(node.outputs ?? {}))],
      layoutOptions: { ...preset.options(node.id), portConstraints: "FIXED_POS" },
    };
  });
  const edges = args.connections.map((c) => ({
    id: c.id,
    sources: [c.sourceOutput ? portId(c.source, c.sourceOutput, "output") : c.source],
    targets: [c.targetInput ? portId(c.target, c.targetInput, "input") : c.target],
  }));
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      ...ELK_ROOT_OPTIONS,
      ...args.options,
      ...(anyFlipped ? FLIPPED_MODEL_ORDER_OPTIONS : {}),
    },
    children,
    edges,
  });
  for (const c of result.children ?? []) {
    if (!c.id || typeof c.x === "undefined" || typeof c.y === "undefined") continue;
    await args.translate(c.id, c.x, c.y);
  }
}

// Nodes are handed to ELK as Proxies; a Proxy preserves `id`, so the applier
// still translates the real node.
export function makeArrangeFn(deps: TidyDeps): ArrangeFn {
  const { editor, view, container, ensureElk, repositionDockedTo, isDestroyed } = deps;
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
    // A position-locked group (and its members) sits out global tidy entirely — it
    // stays exactly where the user pinned it. Within-group tidy is that group's own
    // Tidy button, which still arranges its members.
    const layoutTargets = tidyNodes.filter(
      (n) =>
        !dockedFcIds.has(n.id) &&
        (withinGroup ? true : !memberIds.has(n.id) && !(n instanceof GroupNode && n.lockedPosition)),
    );

    // Standoff clusters lay out as ONE rigid block: collapse each fully-loose
    // cluster into a bbox-sized leader, re-placing members at stored offsets after.
    const looseTargetIds = new Set(layoutTargets.map((n) => n.id));
    const clusterLeaderOf = new Map<string, string>();    // member -> leader
    const clusterMembersOf = new Map<string, string[]>(); // leader -> members
    const clusterMemberOffset = new Map<string, { dx: number; dy: number }>();
    const clusterLeaderSize = new Map<string, { w: number; h: number }>();
    const clusterFollowers = new Set<string>();
    if (!standoffStore.isEmpty()) {
      const boxOf = (id: string) => measuredBox(view, id, editor);
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
    // elkTidyLayout makes it a node-level edge (no port to match).
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
      // A flipped node reads from its right and emits to its left, so for the layout
      // it "acts as a predecessor" — its neighbor should sit one layer the other way.
      // Reverse the ELK edge direction when either end is flipped, and drop the ports
      // (node-level edge) so the mirrored side never fights the symmetric port preset.
      // (Grouped members remap to their group, which is never flipped — so this reads
      // the ELK-visible id, not the raw endpoint.)
      const flipEdge = socketFlipStore.get(s) || socketFlipStore.get(t);
      if (flipEdge) {
        return [{
          ...c,
          source: t, sourceOutput: "",
          target: s, targetInput: "",
        } as unknown as Schemes["Connection"]];
      }
      return [{
        ...c,
        source: s, sourceOutput: s !== c.source ? "" : c.sourceOutput,
        target: t, targetInput: t !== c.target ? "" : c.targetInput,
      } as unknown as Schemes["Connection"]];
    });
    // Reserve each host's docked-FC view (the host + FC bounding box) so ELK doesn't
    // pack a neighbor into it — ONLY for hosts actually IN the layout, else the
    // restore below stamps a fixed inline height the pin-drop loop never clears.
    const layoutTargetIds = new Set(layoutTargets.map((n) => n.id));
    const hostFootprint = new Map<string, { w: number; h: number }>();
    for (const fcId of dockedFcIds) {
      const fc = editor.getNode(fcId);
      if (!(fc instanceof FormatControllerNode) || fc.side !== "output") continue;
      if (!layoutTargetIds.has(fc.hostNodeId)) continue;
      const host = editor.getNode(fc.hostNodeId);
      const hostPos = view.position(fc.hostNodeId);
      if (!host || !hostPos) continue;
      // measuredBox: the live rendered size, not the pre-paint constructor estimate.
      const hostBox = measuredBox(view, fc.hostNodeId, editor) ?? { w: host.width, h: host.height };
      const fcBox = measuredBox(view, fcId, editor) ?? { w: fc.width, h: fc.height };
      const sc = getSocketScreenCenter(view, fc.hostNodeId, fc.socketKey, "output");
      const socketLocalY = sc
        ? screenToCanvas(view, container, sc.x, sc.y).y - hostPos.y
        : hostBox.h / 2;
      const prev = hostFootprint.get(fc.hostNodeId) ?? { w: hostBox.w, h: hostBox.h };
      hostFootprint.set(fc.hostNodeId, {
        w: prev.w + fcBox.w + 8,
        h: Math.max(prev.h, socketLocalY + fcBox.h / 2),
      });
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
        const gb = measuredBox(view, n.id, editor);
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
    // ELK lays out from origin; shift the result back keeping the flow's LEADING EDGE and
    // the CROSS-AXIS CENTER, so a tidy→autofit cycle stays a fixed point. RIGHT keeps the
    // LEFT edge + vertical center; DOWN transposes to the TOP edge + horizontal center.
    const down = settingsStore.get("tidyDirection") === "down";
    let origMinX = Infinity, origMinY = Infinity;
    let targetCx = 0, targetCy = 0;
    if (withinGroup) {
      const gv = view.position(withinGroup.id);
      if (gv) {
        const left = gv.x + GROUP_PAD;
        const right = gv.x + withinGroup.width - GROUP_PAD;
        const top = gv.y + GROUP_HEADER + GROUP_PAD;
        const bottom = gv.y + withinGroup.height - GROUP_PAD;
        origMinX = left; origMinY = top;
        targetCx = (left + right) / 2;
        targetCy = (top + bottom) / 2;
      }
    } else {
      let oldLeft = Infinity, oldRight = -Infinity, oldTop = Infinity, oldBottom = -Infinity;
      for (const n of layoutTargets) {
        const b = measuredBox(view, n.id, editor);
        if (!b) continue;
        oldLeft = Math.min(oldLeft, b.x); oldRight = Math.max(oldRight, b.x + b.w);
        oldTop = Math.min(oldTop, b.y); oldBottom = Math.max(oldBottom, b.y + b.h);
      }
      origMinX = oldLeft; origMinY = oldTop;
      targetCx = (oldLeft + oldRight) / 2;
      targetCy = (oldTop + oldBottom) / 2;
    }

    // Members aren't in the layout, so carry them by the group's own delta after.
    const groupOrigPos = new Map<string, { x: number; y: number }>();
    for (const n of layoutTargets) {
      if (n instanceof GroupNode) {
        const p = view.position(n.id);
        if (p) groupOrigPos.set(n.id, { x: p.x, y: p.y });
      }
    }

    // Null only if the surface was destroyed mid-import — nothing left to lay out.
    const elk = await ensureElk();
    if (!elk) return;

    // widthCap is "at most N per row"; layerUnzipping wants the sublayer COUNT. Read here
    // (from the layout's node count) so the preset's per-node hook stamps the same value.
    const capSetting = settingsStore.get("tidyWidthCap");
    const widthCap = (capSetting === "off" ? 0 : Number(capSetting)) as TidyWidthCap;
    tidyLayerSplit = tidyLayerSplitFor(proxyNodes.length, widthCap);

    await elkTidyLayout(elk, {
      nodes: proxyNodes as Schemes["Node"][],
      connections: subsetConns,
      // ELK spacing + direction + width cap from the Tidy knobs (the preset's `spacing`
      // is only port placement).
      options: tidyOptionsFromSettings(),
      translate: (id, x, y) => view.moveNode(id, { x, y }),
    });

    // Place cluster members relative to the leader's new position, BEFORE the anchor
    // calc so their fresh positions feed it.
    for (const [leader, members] of clusterMembersOf) {
      const lv = view.position(leader);
      if (!lv) continue;
      const baseX = lv.x;
      const baseY = lv.y;
      for (const mid of members) {
        const off = clusterMemberOffset.get(mid)!;
        await view.moveNode(mid, { x: baseX + off.dx, y: baseY + off.dy });
      }
    }

    let newLeft = Infinity, newRight = -Infinity, newTop = Infinity, newBottom = -Infinity;
    for (const n of layoutTargets) {
      const b = measuredBox(view, n.id, editor);
      if (!b) continue;
      newLeft = Math.min(newLeft, b.x); newRight = Math.max(newRight, b.x + b.w);
      newTop = Math.min(newTop, b.y); newBottom = Math.max(newBottom, b.y + b.h);
    }
    // DOWN preserves the TOP edge + horizontal center; RIGHT the LEFT edge + vertical center.
    let dx: number, dy: number;
    if (down) {
      dy = origMinY - newTop;
      dx = targetCx - (newLeft + newRight) / 2;
    } else {
      dx = origMinX - newLeft;
      dy = targetCy - (newTop + newBottom) / 2;
    }
    // Within a group, never let centering push members past the box's leading interior
    // edge — the header (top) under RIGHT, the left pad under DOWN.
    if (withinGroup) {
      const gv = view.position(withinGroup.id);
      if (gv) {
        if (down) {
          const interiorLeft = gv.x + GROUP_PAD;
          if (newLeft + dx < interiorLeft) dx = interiorLeft - newLeft;
        } else {
          const interiorTop = gv.y + GROUP_HEADER + GROUP_PAD;
          if (newTop + dy < interiorTop) dy = interiorTop - newTop;
        }
      }
    }
    if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
      for (const n of layoutTargets) {
        const p = view.position(n.id);
        if (!p) continue;
        await view.moveNode(n.id, { x: p.x + dx, y: p.y + dy });
      }
    }

    // Members were held out of the layout, so carry them rigidly by the net move.
    for (const [gid, orig] of groupOrigPos) {
      const gv = view.position(gid);
      const grp = editor.getNode(gid);
      if (!gv || !(grp instanceof GroupNode)) continue;
      const gdx = gv.x - orig.x;
      const gdy = gv.y - orig.y;
      if (gdx === 0 && gdy === 0) continue;
      for (const mid of grp.members) {
        const mp = view.position(mid);
        if (!mp) continue;
        await view.moveNode(mid, { x: mp.x + gdx, y: mp.y + gdy });
      }
    }

    // Position-locked groups sat OUT of the layout (fixed), so the fresh arrangement
    // can land on top of one. Treat each as a pinned obstacle and separate any node
    // that overlaps it (monotonic +x/+y, so it terminates and — once clear — stays a
    // fixed point on re-run). A pushed group carries its members. Global tidy only:
    // a within-group tidy never touches external groups.
    if (!withinGroup) {
      const lockedBoxes: PushBox[] = [];
      for (const n of editor.getNodes()) {
        if (n instanceof GroupNode && n.lockedPosition) {
          const b = measuredBox(view, n.id, editor);
          if (b) lockedBoxes.push({ id: n.id, x: b.x, y: b.y, w: b.w, h: b.h });
        }
      }
      if (lockedBoxes.length > 0) {
        const freeBoxes: PushBox[] = [];
        for (const n of layoutTargets) {
          const b = measuredBox(view, n.id, editor);
          if (b) freeBoxes.push({ id: n.id, x: b.x, y: b.y, w: b.w, h: b.h });
        }
        const pinned = new Set(lockedBoxes.map((b) => b.id));
        const disp = separateOverlaps([...lockedBoxes, ...freeBoxes], undefined, PUSH_GAP, pinned);
        for (const [id, d] of disp) {
          const p = view.position(id);
          if (!p) continue;
          await view.moveNode(id, { x: p.x + d.dx, y: p.y + d.dy });
          const grp = editor.getNode(id);
          if (grp instanceof GroupNode) {
            for (const mid of grp.members) {
              const mp = view.position(mid);
              if (mp) await view.moveNode(mid, { x: mp.x + d.dx, y: mp.y + d.dy });
            }
          }
        }
      }
    }

    // Drop the inline height/width the applier stamped, re-applying a manually-sized
    // width from nodeSizeStore (React won't re-diff what the imperative pin wrote).
    // ONLY `.solenoid-node` roots — every other root sets its inline size from React's
    // `style` prop, which removeProperty would strip with no re-stamp.
    for (const n of layoutTargets) {
      const card = view.nodeElement(n.id)?.querySelector<HTMLElement>("*:not(span):not([fragment])");
      if (!card || !card.classList.contains("solenoid-node")) continue;
      card.style.removeProperty("height");
      // A collapsed card owns its own (compact) width — re-stamping the manual
      // expanded width here stretched a collapsed, resized node (NodeCard drops the
      // manual size while collapsed for the same reason).
      const manual = collapseStore.get(n.id) ? undefined : nodeSizeStore.get(n.id);
      if (manual) card.style.width = `${Math.round(manual.w)}px`;
      else card.style.removeProperty("width");
    }

    if (withinGroup) {
      let maxX = -Infinity, maxY = -Infinity;
      for (const n of layoutTargets) {
        // measuredBox, not offsetWidth: an unpainted member measures 0 and under-grows.
        const b = measuredBox(view, n.id, editor);
        if (!b) continue;
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const gv = view.position(withinGroup.id);
      const preW = withinGroup.width, preH = withinGroup.height;
      if (gv && Number.isFinite(maxX)) {
        // Integer dims: a fractional width puts the box edge on a half-pixel (blur).
        withinGroup.width = Math.round(Math.max(withinGroup.width, (maxX - gv.x) + GROUP_PAD));
        withinGroup.height = Math.round(Math.max(withinGroup.height, (maxY - gv.y) + GROUP_PAD));
        await view.rerenderNode(withinGroup.id);
      }
      rebuildGroupMembership(editor);
      syncGroupCollapse(editor, view);
      // An autogrown box pushes its neighbours off the grown edges; Cleanup skips
      // this, managing its own collapse/restore + re-tidy.
      if (!opts?.skipPush && (withinGroup.width > preW + 0.5 || withinGroup.height > preH + 0.5)) {
        pushForGrownGroups(editor, view, [withinGroup], new Map([[withinGroup.id, { w: preW, h: preH }]]));
      }
    }

    // view.translate schedules nothing; the autosave debounce reads positions at
    // flush time, so the deferred settle below is still captured.
    scheduleAutosave();

    selectedIds.forEach((id, i) => selectNodeFromProcess(id, i > 0));

    if (!withinGroup && selectedIds.length > 0) await zoomAt(view, targets);

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
  view: View,
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

    // 1. Tidy every group's members. Locked groups are left untouched: no member
    //    tidy, no autofit, no collapse below — they stay exactly as pinned.
    const groups = groupsNow().filter((g) => !g.lockedPosition);
    for (const g of groups) await arrangeFn({ groupId: g.id, skipPush: true });
    // Two frames (rAF fire, then translate guard) so the within-group tidy's deferred
    // FC snap-backs land — else autofit pads the box around stale far-right FC spots.
    await nextFrame(); await nextFrame();
    for (const g of groups) await autofitGroupBox(editor, view, g);

    // 2. Collapse every still-expanded group.
    const toCollapse = groupsNow().filter((g) => !g.collapsed && !g.lockedPosition);
    if (toCollapse.length) {
      for (const g of toCollapse) g.collapsed = true;
      syncGroupCollapse(editor, view);
      for (const g of toCollapse) {
        await view.rerenderNode(g.id);
        settleCollapse(view, g.id, g.members, false);
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
