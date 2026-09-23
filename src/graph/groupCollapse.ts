// [[C88]] collapseIsVisual
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode, DisplayNode, FormatControllerNode, ConduitNode } from "./rete-nodes";
import { dockedNodeStore } from "./dockedNodeStore";
import { createNotifier } from "./storeKit";
import { displayNameOf } from "./nodeNamer";

type Editor = NodeEditor<Schemes>;

export interface RetainedTerminal {
  kind: "display" | "node";
  displayId: string;
  label: string;
  effNodeId: string;
  effSocketKey: string;
  lanes?: number;
}

function extendedMembers(editor: Editor, group: GroupNode): string[] {
  const base = new Set(group.members);
  const ext = [...group.members];
  for (const n of editor.getNodes()) {
    if (base.has(n.id)) continue;
    const dock = dockedNodeStore.get(n.id);
    if (dock && base.has(dock.hostNodeId)) ext.push(n.id);
  }
  return ext;
}

function genericLabel(node: object): string {
  return displayNameOf(node);
}

export interface PillPos {
  groupId: string;
  side: "left" | "right";
  index: number;
}

export interface InputPill {
  nodeId: string;
  socketKey: string;
  index: number;
  lanes?: number;
}

// rowGap must match the `.solenoid-group__summary` flex `gap` in GroupNode.css, or cable endpoints drift a gap further with every row.
export const COLLAPSE_LAYOUT = { width: 264, headerH: 34, padTop: 6, rowH: 24, rowGap: 3 };
export function pillY(index: number): number {
  return COLLAPSE_LAYOUT.headerH + COLLAPSE_LAYOUT.padTop
    + index * (COLLAPSE_LAYOUT.rowH + COLLAPSE_LAYOUT.rowGap) + COLLAPSE_LAYOUT.rowH / 2;
}

const _hiddenNodes = new Set<string>();
const _hiddenConns = new Set<string>();
const _retained = new Map<string, RetainedTerminal[]>();
const _outPill = new Map<string, PillPos>();
const _inPill = new Map<string, PillPos>();
const _inputPillList = new Map<string, InputPill[]>();
const { notify, subscribe, version } = createNotifier();

export const groupCollapseStore = {
  isNodeHidden: (id: string) => _hiddenNodes.has(id),
  isConnHidden: (id: string) => _hiddenConns.has(id),
  retainedFor: (groupId: string): RetainedTerminal[] => _retained.get(groupId) ?? [],
  outPillFor: (nodeId: string, key: string): PillPos | undefined => _outPill.get(`${nodeId}::${key}`),
  inPillFor: (nodeId: string, key: string): PillPos | undefined => _inPill.get(`${nodeId}::${key}`),
  inputPillsFor: (groupId: string): InputPill[] => _inputPillList.get(groupId) ?? [],
  version,
  subscribe,
};

function outgoing(editor: Editor, nodeId: string, socketKey: string) {
  return editor.getConnections().filter((c) => c.source === nodeId && c.sourceOutput === socketKey);
}

function bundleDest(
  editor: Editor,
  c: { target: string; targetInput: string },
  nodeGroup: Map<string, string>,
  srcGroupId: string,
): { kind: "conduit" | "group"; id: string } | null {
  const tg = nodeGroup.get(c.target);
  if (tg && tg !== srcGroupId) return { kind: "group", id: tg };
  const t = editor.getNode(c.target);
  if (t instanceof ConduitNode && c.targetInput.startsWith("in_")) return { kind: "conduit", id: c.target };
  return null;
}

export function groupReadouts(editor: Editor, group: GroupNode): RetainedTerminal[] {
  const members = new Set(extendedMembers(editor, group));
  const conns = editor.getConnections();
  const terminals: RetainedTerminal[] = [];
  const exposed = new Set<string>();

  for (const id of members) {
    const node = editor.getNode(id);
    if (!(node instanceof DisplayNode)) continue;
    let effNodeId = id, effKey = "out";
    const fcHop = outgoing(editor, id, "out")
      .map((c) => editor.getNode(c.target))
      .find((t): t is FormatControllerNode => t instanceof FormatControllerNode && members.has(t.id));
    if (fcHop) { effNodeId = fcHop.id; effKey = "out"; }
    const effConns = outgoing(editor, effNodeId, effKey);
    if (effConns.length === 0 || effConns.some((c) => !members.has(c.target))) {
      terminals.push({ kind: "display", displayId: id, label: node.label, effNodeId, effSocketKey: effKey });
      exposed.add(id); exposed.add(effNodeId);
    }
  }

  const seenOut = new Set<string>();
  const rowed = new Set<string>();
  for (const c of conns) {
    if (!members.has(c.source) || members.has(c.target)) continue;
    if (exposed.has(c.source)) continue;
    const key = `${c.source}::${c.sourceOutput}`;
    if (seenOut.has(key)) continue;
    seenOut.add(key);
    const node = editor.getNode(c.source);
    if (!node) continue;
    rowed.add(c.source);
    terminals.push({ kind: "node", displayId: c.source, label: genericLabel(node), effNodeId: c.source, effSocketKey: c.sourceOutput });
  }

  for (const id of members) {
    if (exposed.has(id) || rowed.has(id)) continue;
    const node = editor.getNode(id);
    if (!node) continue;
    const firstOut = Object.keys(node.outputs ?? {})[0];
    if (!firstOut) continue;
    if (conns.some((c) => c.source === id)) continue;
    terminals.push({ kind: "node", displayId: id, label: genericLabel(node), effNodeId: id, effSocketKey: firstOut });
  }

  return terminals;
}

export function recomputeGroupCollapse(editor: Editor): void {
  _hiddenNodes.clear();
  _hiddenConns.clear();
  _retained.clear();
  _outPill.clear();
  _inPill.clear();
  _inputPillList.clear();

  const groups = editor.getNodes().filter(
    (n): n is GroupNode => n instanceof GroupNode && n.collapsed,
  );
  const conns = editor.getConnections();

  // Pass 0 completes for every collapsed group first: bundling needs to know whether a target is hidden in a different group.
  const nodeGroup = new Map<string, string>();
  const membersOf = new Map<string, string[]>();
  for (const g of groups) {
    const ext = extendedMembers(editor, g);
    membersOf.set(g.id, ext);
    for (const id of ext) { _hiddenNodes.add(id); nodeGroup.set(id, g.id); }
  }

  for (const g of groups) {
    const members = new Set(membersOf.get(g.id)!);

    const terminals: RetainedTerminal[] = [];
    const exposed = new Set<string>();
    const displayRowBySource = new Map<string, number>();

    for (const id of members) {
      const node = editor.getNode(id);
      if (!(node instanceof DisplayNode)) continue;

      let effNodeId = id, effKey = "out";
      const fcHop = outgoing(editor, id, "out")
        .map((c) => editor.getNode(c.target))
        .find((t): t is FormatControllerNode => t instanceof FormatControllerNode && members.has(t.id));
      if (fcHop) { effNodeId = fcHop.id; effKey = "out"; }

      const effConns = outgoing(editor, effNodeId, effKey);
      const retained = effConns.length === 0 || effConns.some((c) => !members.has(c.target));
      if (retained) {
        const rowIndex = terminals.length;
        terminals.push({ kind: "display", displayId: id, label: node.label, effNodeId, effSocketKey: effKey });
        exposed.add(id);
        exposed.add(effNodeId);
        for (const ic of conns) if (ic.target === id) displayRowBySource.set(ic.source, rowIndex);
      }
    }

    const seenOut = new Set<string>();
    const rowedMembers = new Set<string>();
    const conduitDestRow = new Map<string, number>();
    for (const c of conns) {
      if (!members.has(c.source) || members.has(c.target)) continue;
      if (exposed.has(c.source)) continue;
      const key = `${c.source}::${c.sourceOutput}`;
      if (seenOut.has(key)) continue;
      seenOut.add(key);
      const node = editor.getNode(c.source);
      if (!node) continue;
      const isConduitLane = node instanceof ConduitNode && c.sourceOutput.startsWith("out_");
      if (isConduitLane) {
        const dest = bundleDest(editor, c, nodeGroup, g.id);
        if (dest) {
          const dkey = `${c.source}|${dest.kind}:${dest.id}`;
          let row = conduitDestRow.get(dkey);
          if (row === undefined) {
            row = terminals.length;
            conduitDestRow.set(dkey, row);
            rowedMembers.add(c.source);
            terminals.push({ kind: "node", displayId: c.source, label: genericLabel(node), effNodeId: c.source, effSocketKey: c.sourceOutput, lanes: 0 });
          }
          terminals[row].lanes = (terminals[row].lanes ?? 0) + 1;
          _outPill.set(key, { groupId: g.id, side: "right", index: row });
          continue;
        }
      }
      let valueSrcId = c.source;
      if (isConduitLane) {
        const laneIn = `in_${c.sourceOutput.slice(4)}`;
        valueSrcId = conns.find((cc) => cc.target === c.source && cc.targetInput === laneIn)?.source ?? c.source;
      }
      const dispRow = displayRowBySource.get(valueSrcId);
      if (dispRow !== undefined) {
        _outPill.set(key, { groupId: g.id, side: "right", index: dispRow });
        continue;
      }
      const valueSrc = valueSrcId === c.source ? node : editor.getNode(valueSrcId);
      rowedMembers.add(c.source);
      terminals.push({ kind: "node", displayId: c.source, label: genericLabel(valueSrc ?? node), effNodeId: c.source, effSocketKey: c.sourceOutput });
    }

    for (const id of members) {
      if (exposed.has(id) || rowedMembers.has(id)) continue;
      const node = editor.getNode(id);
      if (!node) continue;
      const firstOut = Object.keys(node.outputs ?? {})[0];
      if (!firstOut) continue;
      if (conns.some((c) => c.source === id)) continue;
      terminals.push({ kind: "node", displayId: id, label: genericLabel(node), effNodeId: id, effSocketKey: firstOut });
    }

    _retained.set(g.id, terminals);
    terminals.forEach((t, i) =>
      _outPill.set(`${t.effNodeId}::${t.effSocketKey}`, { groupId: g.id, side: "right", index: i }),
    );

    const inputs: InputPill[] = [];
    let inIdx = 0;
    const conduitPill = new Map<string, InputPill>();
    for (const c of conns) {
      if (!members.has(c.target) || members.has(c.source)) continue;
      const key = `${c.target}::${c.targetInput}`;
      if (_inPill.has(key)) continue;
      const srcNode = editor.getNode(c.source);
      const conduitSrc =
        srcNode instanceof ConduitNode &&
        c.sourceOutput.startsWith("out_");
      if (conduitSrc) {
        let entry = conduitPill.get(c.source);
        if (!entry) {
          entry = { nodeId: c.target, socketKey: c.targetInput, index: inIdx++, lanes: 0 };
          conduitPill.set(c.source, entry);
          inputs.push(entry);
        }
        entry.lanes = (entry.lanes ?? 0) + 1;
        _inPill.set(key, { groupId: g.id, side: "left", index: entry.index });
      } else {
        _inPill.set(key, { groupId: g.id, side: "left", index: inIdx });
        inputs.push({ nodeId: c.target, socketKey: c.targetInput, index: inIdx });
        inIdx++;
      }
    }
    _inputPillList.set(g.id, inputs);
  }

  for (const c of conns) {
    const sg = nodeGroup.get(c.source);
    const tg = nodeGroup.get(c.target);
    if (sg && tg && sg === tg) _hiddenConns.add(c.id);
  }
  notify();
}

/** Expand must re-render members a frame before re-measuring, and collapse must not, because pills reuse member socket keys. */
export function settleCollapse(
  view: View,
  groupId: string,
  members: string[],
  expanding: boolean,
): void {
  const set = new Set(members);
  for (const m of members) for (const d of dockedNodeStore.getDockedTo(m)) set.add(d.id);
  requestAnimationFrame(() => {
    void view.rerenderNode(groupId);
    if (expanding) for (const m of set) void view.rerenderNode(m);
    requestAnimationFrame(() => { void view.rerenderCables(); });
  });
}

export function syncGroupCollapse(editor: Editor, _area: View): void {
  recomputeGroupCollapse(editor);
}
