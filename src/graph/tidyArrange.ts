// [[B10]] reactFlowView, [[D63]] lockedGroupIsObstacle, [[C89]] standoffsSolveLast, [[C112]] noOverlapsEver.
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
import { pushForGrownGroups, settleOverlaps } from "./groupPush";
import { socketFlipStore } from "./socketFlipStore";
import { presentSocketKeys } from "./presentSocketStore";
import { collapseStore } from "./collapseStore";
import { standoffStore, standoffClusters, settleStandoffs, liveStandoffs } from "./standoffs";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse, settleCollapse, groupCollapseStore } from "./groupCollapse";
import { fitAll } from "./NavMenu";
import { dockedNodeStore } from "./dockedNodeStore";
import { socketLocalCenter } from "./canvasGeometry";
import { scheduleAutosave } from "./persistence";
import { unselectAllNodes as unselectAllNodesFromProcess, selectNode as selectNodeFromProcess } from "./canvasCommands";
const TIDY_CONFIRM_THRESHOLD = 12;

export interface TidyDeps {
  editor: NodeEditor<Schemes>;
  view: View;
  ensureElk: () => Promise<Elk | null>;
  repositionDockedTo: (hostId: string) => void;
  isDestroyed: () => boolean;
}

export type ArrangeFn = (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => Promise<void>;

export function symmetricPortPreset(direction: TidyDirection, layerSplit = 0) {
  const down = direction === "down";
  return {
    port(data: { side: "input" | "output"; index: number; ports: number; width: number; height: number }) {
      const spacing = 16;
      const extent = down ? data.width : data.height;
      const along = settingsStore.get("tidyAlign") === "top"
        ? 20 + data.index * spacing
        : extent / 2 + (data.index - (data.ports - 1) / 2) * spacing;
      return down
        ? { x: along, y: 0, width: 15, height: 15, side: data.side === "output" ? "SOUTH" : "NORTH" } as const
        : { x: 0, y: along, width: 15, height: 15, side: data.side === "output" ? "EAST" : "WEST" } as const;
    },
    options(_id: string): Record<string, string | number | boolean> {
      return layerSplit > 0
        ? { "elk.layered.layerUnzipping.layerSplit": String(layerSplit) }
        : {};
    },
  };
}

function widthCapFromSettings(): TidyWidthCap {
  const cap = settingsStore.get("tidyWidthCap");
  return cap === "off" ? 0 : (Number(cap) as TidyWidthCap);
}

export function tidyOptionsFromSettings(): Record<string, string> {
  return tidyLayoutOptions({
    direction: settingsStore.get("tidyDirection"),
    density: settingsStore.get("tidyDensity"),
    widthCap: widthCapFromSettings(),
  });
}

const isDockedFc = (n: Schemes["Node"]) => n instanceof FormatControllerNode && !!dockedNodeStore.get(n.id);

/** The cards a top-level Tidy places: no docked FC, no group member. The confirmation counts with it, or the dialog misstates the scope. */
function countLayoutUnits(nodes: readonly Schemes["Node"][], memberIds: ReadonlySet<string>): number {
  return nodes.filter((n) => !isDockedFc(n) && !memberIds.has(n.id)).length;
}

type Box = { x: number; y: number; w: number; h: number };
function unionBox(boxes: Iterable<Box>): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x); top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.w); bottom = Math.max(bottom, b.y + b.h);
  }
  return { left, top, right, bottom };
}

/** The node as ELK should see it: a reserved size, and for a Conduit only its wired lanes. Nothing is written to the card. */
function asLaidOut(n: Schemes["Node"], o: { w?: number; h?: number; inputs?: object; outputs?: object }): Schemes["Node"] {
  return new Proxy(n, {
    get(target, prop) {
      if (prop === "width" && o.w !== undefined) return o.w;
      if (prop === "height" && o.h !== undefined) return o.h;
      if (prop === "inputs" && o.inputs) return o.inputs;
      if (prop === "outputs" && o.outputs) return o.outputs;
      return Reflect.get(target, prop);
    },
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export type TidyDirection = "right" | "down";
export type TidyDensity = "compact" | "normal" | "airy";
export type TidyWidthCap = 0 | 2 | 3 | 4;

const TIDY_DENSITY_SPACING: Record<TidyDensity, readonly [number, number]> = {
  compact: [36, 24],
  normal:  [55, 38],
  airy:    [80, 56],
};

export const ELK_ROOT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.edgeRouting": "POLYLINE",
} as const;

// Forced model order puts a flipped card last in its layer only under INCLUDE_CHILDREN (pinned by the flipped-sink
// test), and INCLUDE_CHILDREN turns off component packing, so only a layout with a flipped card pays that price.
export const FLIPPED_MODEL_ORDER_OPTIONS = {
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
} as const;

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

export function tidyLayerSplitFor(nodeCount: number, widthCap: TidyWidthCap): number {
  return widthCap > 0 ? Math.max(1, Math.ceil(nodeCount / widthCap)) : 0;
}

export type Elk = { layout(graph: unknown): Promise<ElkResult> };
type ElkResult = { children?: Array<{ id?: string; x?: number; y?: number }> };

export function makeEnsureElk(isDestroyed: () => boolean): () => Promise<Elk | null> {
  let elk: Elk | null = null;
  let loading: Promise<Elk | null> | null = null;
  return () => {
    if (elk) return Promise.resolve(elk);
    if (loading) return loading;
    loading = (async () => {
      const { default: ELK } = await import("elkjs");
      if (isDestroyed()) return null;
      elk = new ELK() as unknown as Elk;
      return elk;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  };
}

export async function elkTidyLayout(
  elk: Elk,
  args: {
    nodes: ReadonlyArray<Schemes["Node"]>;
    connections: ReadonlyArray<{
      id: string; source: string; sourceOutput: string; target: string; targetInput: string;
    }>;
    options: Record<string, string>;
    translate: (id: string, x: number, y: number) => Promise<unknown> | unknown;
    socketAt?: (nodeId: string, key: string, side: "input" | "output") => { x: number; y: number } | null;
  },
): Promise<void> {
  const preset = symmetricPortPreset(settingsStore.get("tidyDirection"), tidyLayerSplitFor(args.nodes.length, widthCapFromSettings()));
  const portId = (id: string, key: string, side: string) => [id, key, side].join("_");
  const byIndex = (rec: Record<string, { index?: number } | undefined>) =>
    Object.entries(rec).sort((a, b) => (a[1]?.index ?? 0) - (b[1]?.index ?? 0));
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
        // A card's sockets sit on its left and right edges, so their real heights serve a left-to-right layout only;
        // there, level ports make level cables. Top-to-bottom, and for an undrawn socket, the spaced ports stand.
        const across = p.side === "EAST" || p.side === "WEST";
        const real = across && settingsStore.get("tidyAlign") === "sockets" ? args.socketAt?.(node.id, key, side) : null;
        return {
          id: portId(node.id, key, side),
          width: p.width, height: p.height,
          x: p.x,
          y: real ? real.y - p.height / 2 : p.y,
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

export function makeArrangeFn(deps: TidyDeps): ArrangeFn {
  const { editor, view, ensureElk, repositionDockedTo, isDestroyed } = deps;
  const nodesOf = (ids: readonly string[]) => ids.map((id) => editor.getNode(id)).filter((n): n is Schemes["Node"] => !!n);
  return async (opts?: { groupId?: string; skipConfirm?: boolean; skipPush?: boolean }) => {
    const all = editor.getNodes();
    const selected = all.filter((n) => (n as { selected?: boolean }).selected);
    const allGroups = all.filter((n): n is GroupNode => n instanceof GroupNode);
    const memberOf = new Map<string, GroupNode>();
    for (const g of allGroups) for (const m of g.members) memberOf.set(m, g);

    // The scope: one group's members (forced, or a selection wholly inside one group), else the selection, else all.
    const forcedGroup = opts?.groupId ? allGroups.find((g) => g.id === opts.groupId) ?? null : null;
    const selectionGroup = !forcedGroup && selected.length > 0 && selected.every((n) => memberOf.get(n.id) === memberOf.get(selected[0].id))
      ? memberOf.get(selected[0].id) ?? null : null;
    const withinGroup = forcedGroup ?? selectionGroup;
    const targets = forcedGroup ? nodesOf(forcedGroup.members) : selected.length > 0 ? selected : all;
    if (targets.length === 0) return;
    const tidyNodes = withinGroup ? nodesOf(withinGroup.members) : targets;

    if (!withinGroup && !opts?.skipConfirm) {
      const count = countLayoutUnits(targets, new Set(memberOf.keys()));
      if (count > TIDY_CONFIRM_THRESHOLD) {
        const scope = selected.length > 0 ? `${count} selected` : `all ${count}`;
        if (!await requestConfirm({ message: `Tidy will rearrange ${scope} nodes. Continue?`, confirmLabel: "Tidy" })) return;
      }
    }

    // A selected node's translate triggers the selector's group-follow, which would compound per placement.
    const selectedIds = selected.map((n) => n.id);
    if (selectedIds.length > 0) unselectAllNodesFromProcess();

    const conns = editor.getConnections();
    const dockedFcIds = new Set(tidyNodes.filter(isDockedFc).map((n) => n.id));
    const layoutTargets = tidyNodes.filter((n) =>
      !dockedFcIds.has(n.id) && (withinGroup || (!memberOf.has(n.id) && !(n instanceof GroupNode && n.lockedPosition))));

    // Standoff clusters whose cards are all being laid out move as one block, reserved by its leader.
    const looseTargetIds = new Set(layoutTargets.map((n) => n.id));
    const clusterLeaderOf = new Map<string, string>();
    const clusterMembersOf = new Map<string, string[]>();
    const clusterBox = new Map<string, Box>();
    const clusterMemberOffset = new Map<string, { dx: number; dy: number }>();
    if (!standoffStore.isEmpty()) {
      for (const cluster of standoffClusters(liveStandoffs(groupCollapseStore.isNodeHidden))) {
        if (!cluster.every((id) => looseTargetIds.has(id))) continue;
        const boxes = cluster
          .map((id) => [id, measuredBox(view, id, editor)] as const)
          .filter((e): e is [string, Box] => !!e[1]);
        if (boxes.length < 2) continue;
        const u = unionBox(boxes.map(([, b]) => b));
        const leader = boxes.slice().sort((a, b) => {
          const ga = editor.getNode(a[0]) instanceof GroupNode ? 1 : 0;
          const gb = editor.getNode(b[0]) instanceof GroupNode ? 1 : 0;
          return ga !== gb ? ga - gb : (a[1].x + a[1].y) - (b[1].x + b[1].y);
        })[0][0];
        clusterMembersOf.set(leader, boxes.map(([id]) => id));
        clusterBox.set(leader, { x: u.left, y: u.top, w: u.right - u.left, h: u.bottom - u.top });
        for (const [id, b] of boxes) {
          clusterLeaderOf.set(id, leader);
          clusterMemberOffset.set(id, { dx: b.x - u.left, dy: b.y - u.top });
        }
      }
    }
    const elkId = (id: string) => clusterLeaderOf.get(id) ?? id;
    const elkNodes = layoutTargets.filter((n) => elkId(n.id) === n.id);
    const elkVisible = new Set(elkNodes.map((n) => n.id));

    // Edges ELK can see: docked FCs bridged out, edges into a group's members moved onto the group, into a follower onto its leader.
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
    if (!withinGroup) {
      for (const c of conns) {
        const sg = memberOf.get(c.source);
        const tg = memberOf.get(c.target);
        if (!sg && !tg) continue;
        const sId = sg ? sg.id : c.source;
        const tId = tg ? tg.id : c.target;
        if (sId === tId) continue;
        bridges.push({
          id: `tidy-gbridge-${c.id}`,
          source: sId, sourceOutput: sg ? "" : c.sourceOutput,
          target: tId, targetInput: tg ? "" : c.targetInput,
        } as unknown as Schemes["Connection"]);
      }
    }
    const elkConns = [...conns, ...bridges].flatMap((c) => {
      const s = elkId(c.source);
      const t = elkId(c.target);
      if (s === t || !elkVisible.has(s) || !elkVisible.has(t)) return [];
      if (socketFlipStore.get(s) || socketFlipStore.get(t)) {
        return [{ ...c, source: t, sourceOutput: "", target: s, targetInput: "" } as unknown as Schemes["Connection"]];
      }
      return [{
        ...c,
        source: s, sourceOutput: s !== c.source ? "" : c.sourceOutput,
        target: t, targetInput: t !== c.target ? "" : c.targetInput,
      } as unknown as Schemes["Connection"]];
    });

    // A host with a docked output FC reserves the FC's area too, so no neighbor packs into it.
    const hostFootprint = new Map<string, { w: number; h: number }>();
    for (const fcId of dockedFcIds) {
      const fc = editor.getNode(fcId);
      if (!(fc instanceof FormatControllerNode) || fc.side !== "output" || !looseTargetIds.has(fc.hostNodeId)) continue;
      const host = editor.getNode(fc.hostNodeId);
      if (!host) continue;
      const hostBox = measuredBox(view, fc.hostNodeId, editor) ?? { w: host.width, h: host.height };
      const fcBox = measuredBox(view, fcId, editor) ?? { w: fc.width, h: fc.height };
      const socketLocalY = socketLocalCenter(view, fc.hostNodeId, fc.socketKey, "output")?.y ?? hostBox.h / 2;
      const prev = hostFootprint.get(fc.hostNodeId) ?? { w: hostBox.w, h: hostBox.h };
      hostFootprint.set(fc.hostNodeId, { w: prev.w + fcBox.w + 8, h: Math.max(prev.h, socketLocalY + fcBox.h / 2) });
    }

    // What ELK lays out, and where each of those boxes sits now: a cluster by its block, anything else by its card.
    const elkBoxes = elkNodes.map((n) => {
      const cluster = clusterBox.get(n.id);
      const from = cluster ?? view.position(n.id);
      let laid: Schemes["Node"];
      if (n instanceof GroupNode) {
        const gb = measuredBox(view, n.id, editor);
        laid = asLaidOut(n, { w: cluster?.w ?? (gb?.w || n.width), h: cluster?.h ?? (gb?.h || n.height), inputs: {}, outputs: {} });
      } else {
        const size = cluster ?? hostFootprint.get(n.id) ?? measuredBox(view, n.id, editor);
        const sockets = n instanceof ConduitNode ? wiredLanes(n, conns) : presentSockets(n, conns);
        laid = asLaidOut(n, { w: size?.w, h: size?.h, ...sockets });
      }
      return { node: laid, from: from ? { x: from.x, y: from.y, w: laid.width, h: laid.height } : null };
    });

    const elk = await ensureElk();
    if (!elk) return;
    const placed = new Map<string, { x: number; y: number }>();
    await elkTidyLayout(elk, {
      nodes: elkBoxes.map((b) => b.node),
      connections: elkConns,
      options: tidyOptionsFromSettings(),
      translate: (id, x, y) => { placed.set(id, { x, y }); },
      socketAt: (id, key, side) => (clusterBox.has(id) || editor.getNode(id) instanceof GroupNode ? null : socketLocalCenter(view, id, key, side)),
    });

    // Anchor: keep the leading edge and the cross-axis center. Both footprints use the same reserved boxes, so a
    // second Tidy is a fixed point; within a group the reference is the box interior.
    const down = settingsStore.get("tidyDirection") === "down";
    const after = unionBox(elkBoxes.flatMap((b) => {
      const p = placed.get(b.node.id);
      return p ? [{ x: p.x, y: p.y, w: b.node.width, h: b.node.height }] : [];
    }));
    let ref = unionBox(elkBoxes.flatMap((b) => (b.from ? [b.from] : [])));
    const gv = withinGroup ? view.position(withinGroup.id) : null;
    if (withinGroup) {
      ref = gv
        ? { left: gv.x + GROUP_PAD, right: gv.x + withinGroup.width - GROUP_PAD, top: gv.y + GROUP_HEADER + GROUP_PAD, bottom: gv.y + withinGroup.height - GROUP_PAD }
        : { left: NaN, right: NaN, top: NaN, bottom: NaN };
    }
    let dx = down ? (ref.left + ref.right) / 2 - (after.left + after.right) / 2 : ref.left - after.left;
    let dy = down ? ref.top - after.top : (ref.top + ref.bottom) / 2 - (after.top + after.bottom) / 2;
    if (gv) {
      if (down) dx = Math.max(dx, gv.x + GROUP_PAD - after.left);
      else dy = Math.max(dy, gv.y + GROUP_HEADER + GROUP_PAD - after.top);
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) { dx = 0; dy = 0; }

    // Every card moves once, to its final spot on a whole pixel: a cluster's cards at their offsets, a group's members
    // with it. ELK and the centering anchor leave fractions, and a fraction carried into a cluster's offsets or a
    // group's autofit came back as a slightly different size on the next Tidy, which is enough to change the layout.
    const moves = new Map<string, { x: number; y: number }>();
    const whole = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });
    for (const b of elkBoxes) {
      const p = placed.get(b.node.id);
      if (!p) continue;
      for (const id of clusterMembersOf.get(b.node.id) ?? [b.node.id]) {
        const off = clusterMemberOffset.get(id) ?? { dx: 0, dy: 0 };
        moves.set(id, whole(p.x + dx + off.dx, p.y + dy + off.dy));
      }
    }
    for (const [id, to] of [...moves]) {
      const g = editor.getNode(id);
      const from = view.position(id);
      if (!(g instanceof GroupNode) || !from || (to.x === from.x && to.y === from.y)) continue;
      for (const m of g.members) {
        const mp = view.position(m);
        if (mp) moves.set(m, whole(mp.x + to.x - from.x, mp.y + to.y - from.y));
      }
    }
    for (const [id, to] of moves) await view.moveNode(id, to);

    for (const n of layoutTargets) {
      const card = view.nodeElement(n.id)?.querySelector<HTMLElement>("*:not(span):not([fragment])");
      if (!card || !card.classList.contains("solenoid-node")) continue;
      card.style.removeProperty("height");
      const manual = collapseStore.get(n.id) ? undefined : nodeSizeStore.get(n.id);
      if (manual) card.style.width = `${Math.round(manual.w)}px`;
      else card.style.removeProperty("width");
    }

    if (withinGroup && gv) {
      const ext = unionBox(layoutTargets.flatMap((n) => { const b = measuredBox(view, n.id, editor); return b ? [b] : []; }));
      const preW = withinGroup.width, preH = withinGroup.height;
      if (Number.isFinite(ext.right)) {
        withinGroup.width = Math.round(Math.max(withinGroup.width, ext.right - gv.x + GROUP_PAD));
        withinGroup.height = Math.round(Math.max(withinGroup.height, ext.bottom - gv.y + GROUP_PAD));
        await view.rerenderNode(withinGroup.id);
      }
      rebuildGroupMembership(editor);
      syncGroupCollapse(editor, view);
      if (!opts?.skipPush && (withinGroup.width > preW + 0.5 || withinGroup.height > preH + 0.5)) {
        pushForGrownGroups(editor, view, [withinGroup], new Map([[withinGroup.id, { w: preW, h: preH }]]));
      }
    }

    // view.translate schedules nothing, and the autosave debounce reads positions at flush time, so the deferred settle below is captured.
    scheduleAutosave();
    selectedIds.forEach((id, i) => selectNodeFromProcess(id, i > 0));
    if (!withinGroup && selectedIds.length > 0) await zoomAt(view, targets);

    requestAnimationFrame(async () => {
      if (isDestroyed()) return;
      const hosts = new Set<string>();
      for (const n of editor.getNodes()) {
        if (n instanceof FormatControllerNode && n.hostNodeId) hosts.add(n.hostNodeId);
      }
      for (const h of hosts) repositionDockedTo(h);
      settleStandoffs(undefined, { forceLock: true });
      if (!opts?.skipPush) {
        settleOverlaps(editor, view, new Set(withinGroup ? [withinGroup.id] : layoutTargets.map((n) => n.id)));
      }
      // fitAll, never a raw zoomAt: zoomAt centers in the full container and lands content under the docked panels.
      if (!withinGroup && selectedIds.length === 0) {
        await nextFrame();
        if (!isDestroyed()) await fitAll();
      }
    });
  };
}

/** The sockets a card shows, wired or not (`presentSocketStore`), plus any a cable reaches, since ELK throws on an
 *  edge to a missing port. Reserving every declared socket would lay a card out at its largest variant. */
function presentSockets(n: Schemes["Node"], conns: readonly Schemes["Connection"][]): { inputs: object; outputs: object } {
  const keep = { input: new Set(presentSocketKeys(n, "input")), output: new Set(presentSocketKeys(n, "output")) };
  for (const c of conns) {
    if (c.target === n.id && typeof c.targetInput === "string") keep.input.add(c.targetInput);
    if (c.source === n.id && typeof c.sourceOutput === "string") keep.output.add(c.sourceOutput);
  }
  const pick = (rec: object, keys: Set<string>) => Object.fromEntries(Object.entries(rec).filter(([k]) => keys.has(k)));
  return { inputs: pick(n.inputs, keep.input), outputs: pick(n.outputs, keep.output) };
}

/** A Conduit's wired lanes only, one in and one out when nothing is wired, so ELK does not see a tall many-port card. */
function wiredLanes(n: ConduitNode, conns: readonly Schemes["Connection"][]): { inputs: object; outputs: object } {
  const ins = new Set<string>(), outs = new Set<string>();
  for (const c of conns) {
    if (c.target === n.id && typeof c.targetInput === "string") ins.add(c.targetInput);
    if (c.source === n.id && typeof c.sourceOutput === "string") outs.add(c.sourceOutput);
  }
  if (ins.size === 0) ins.add(Object.keys(n.inputs)[0]);
  if (outs.size === 0) outs.add(Object.keys(n.outputs)[0]);
  const pick = (rec: object, keys: Set<string>) => Object.fromEntries([...keys].map((k) => [k, (rec as Record<string, unknown>)[k]]));
  return { inputs: pick(n.inputs, ins), outputs: pick(n.outputs, outs) };
}

export function makeCleanupFn(
  editor: NodeEditor<Schemes>,
  view: View,
  arrangeFn: ArrangeFn,
): () => Promise<void> {
  const groupsNow = () => editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  return async () => {
    const memberIds = new Set(groupsNow().flatMap((g) => g.members));
    const count = countLayoutUnits(editor.getNodes(), memberIds);
    if (count > TIDY_CONFIRM_THRESHOLD) {
      const ok = await requestConfirm({ message: `Cleanup will tidy, collapse, and re-fit all ${count} items. Continue?`, confirmLabel: "Cleanup" });
      if (!ok) return;
    }

    unselectAllNodesFromProcess();
    cableSelectionStore.set(null);

    const groups = groupsNow().filter((g) => !g.lockedPosition);
    for (const g of groups) await arrangeFn({ groupId: g.id, skipPush: true });
    await nextFrame(); await nextFrame();
    for (const g of groups) await autofitGroupBox(editor, view, g);

    const toCollapse = groups.filter((g) => !g.collapsed);
    if (toCollapse.length) {
      for (const g of toCollapse) g.collapsed = true;
      syncGroupCollapse(editor, view);
      for (const g of toCollapse) {
        await view.rerenderNode(g.id);
        settleCollapse(view, g.id, g.members, false);
      }
      // React Flow measures a card a frame after it renders; the top-level Tidy must see the collapsed sizes.
      await nextFrame(); await nextFrame();
    }

    // The top-level Tidy fits the view and schedules the autosave itself.
    await arrangeFn({ skipConfirm: true });
  };
}
