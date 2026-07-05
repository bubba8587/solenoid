import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { GroupNode, DisplayNode, FormatControllerNode, ConduitNode } from "./rete-nodes";
import { dockedNodeStore } from "./dockedNodeStore";

// ─── Group collapse engine ──────────────────────────────────────────────────────
// Collapse is visual-only: members stay wired and computing. When a group is
// collapsed we (1) hide its member nodes and every cable touching them, and (2)
// re-present the group's "terminal" readouts compactly in its header box. Pill
// sockets that re-expose external cables on the group edge are a later step.
//
// Retain rule (which member readouts survive the collapse):
//   Any member whose output leaves the group becomes a readout row. Two flavors:
//   - Display members are the special-cased *visible* readout. A Display is
//     retained iff its effective output has no connection, or that connection
//     leaves the group. "Effective output" follows a single Display→FC hop: if a
//     Display feeds a member FC, the FC's output is what's tested and exposed
//     (the Display stays the visible readout; the FC is hidden). So:
//       Display → FC → outside : retained (shown as the Display)
//       Display → FC → inside  : hidden
//       Display → (nothing)    : retained
//   - Any *other* member with an output connection that leaves the group gets a
//     generic readout row (its label + live value, read from cableValueStore).
//     Unlike a Display it must actually cross the boundary — an unconnected
//     internal node isn't a terminal worth surfacing. Nodes already exposed as a
//     Display (or a Display's FC hop) are not double-counted.

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

export interface RetainedTerminal {
  kind: "display" | "node"; // "display" → read cachedValue; "node" → read cableValueStore
  displayId: string;        // the visible node (Display for "display"; the source node for "node")
  label: string;
  effNodeId: string;        // node whose output is exposed (the FC if Display→FC, else the node itself)
  effSocketKey: string;
  // > 1 marks a COMBINED output: a hidden Conduit member whose outputs all leave
  // the group. Its cables render as ONE ribbon trunk fanning out of this pill
  // (the mirror of the combined input pill), and the row shows the lane count
  // instead of a single lane's value.
  lanes?: number;
}

// Virtual membership: a node DOCKED to a member (an FC that was never absorbed
// as a member itself — docked from outside the group box, host sitting on the
// group's edge, or an old save) collapses WITH its host. Without this the FC
// chip stayed VISIBLE, floating over the collapsed box while its host hid
// (v1.1 A3 audit). Treating it as a member here makes every downstream
// computation — hiding, the Display→FC hop, crossing detection, pills —
// consistent with the absorbed-member case.
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

// Generic readout label for a non-Display member: its user label, else a name
// derived from the class (keepNames preserves constructor.name in production).
function genericLabel(node: { constructor: { name: string }; label?: string }): string {
  const l = (node.label ?? "").trim();
  if (l) return l;
  return node.constructor.name.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

// A pill on a collapsed group's edge. Keyed by the *socket* it stands in for
// (not a connection) so in-progress cables dragged from an output pill redirect
// too — otherwise they'd anchor at the hidden member's 0,0.
export interface PillPos {
  groupId: string;
  side: "left" | "right";
  index: number; // pill row (drives its vertical offset)
}

// An input pill rendered for a member input socket that an external cable feeds.
// `lanes` > 1 marks a COMBINED pill: every cable from one external Conduit's
// outputs shares this single pill (the ribbon trunk terminates on it whole).
export interface InputPill {
  nodeId: string;
  socketKey: string;
  index: number;
  lanes?: number;
}

// Compact-collapse layout — shared by the group component (pill dots, box size)
// and ConnectionComponent (redirected cable endpoints) so they line up.
// rowGap MUST match the `.solenoid-group__summary` flex `gap` in GroupNode.css —
// the readout rows are laid out with that gap between them, so a socket/cable
// endpoint that ignores it drifts index*gap further off with every row down.
export const COLLAPSE_LAYOUT = { width: 264, headerH: 34, padTop: 6, rowH: 24, rowGap: 3 };
export function pillY(index: number): number {
  return COLLAPSE_LAYOUT.headerH + COLLAPSE_LAYOUT.padTop
    + index * (COLLAPSE_LAYOUT.rowH + COLLAPSE_LAYOUT.rowGap) + COLLAPSE_LAYOUT.rowH / 2;
}

const _hiddenNodes = new Set<string>();
const _hiddenConns = new Set<string>();
const _retained = new Map<string, RetainedTerminal[]>();
const _outPill = new Map<string, PillPos>();        // "nodeId::socketKey" → pill
const _inPill = new Map<string, PillPos>();          // "nodeId::socketKey" → pill
const _inputPillList = new Map<string, InputPill[]>(); // groupId → input pills to render
let _version = 0;
const _listeners = new Set<() => void>();
function notify() { _version++; for (const l of _listeners) l(); }

export const groupCollapseStore = {
  isNodeHidden: (id: string) => _hiddenNodes.has(id),
  isConnHidden: (id: string) => _hiddenConns.has(id),
  retainedFor: (groupId: string): RetainedTerminal[] => _retained.get(groupId) ?? [],
  // A pill standing in for an output / input socket (keyed by socket, so the
  // in-progress cable dragged from an output pill redirects too).
  outPillFor: (nodeId: string, key: string): PillPos | undefined => _outPill.get(`${nodeId}::${key}`),
  inPillFor: (nodeId: string, key: string): PillPos | undefined => _inPill.get(`${nodeId}::${key}`),
  inputPillsFor: (groupId: string): InputPill[] => _inputPillList.get(groupId) ?? [],
  version: () => _version,
  subscribe: (l: () => void) => { _listeners.add(l); return () => { _listeners.delete(l); }; },
};

function outgoing(editor: Editor, nodeId: string, socketKey: string) {
  return editor.getConnections().filter((c) => c.source === nodeId && c.sourceOutput === socketKey);
}

// The external bundling-destination a crossing cable lands on, for the inverse
// (group-source) ribbon: another collapsed group (target hidden there), or a
// visible Conduit's lane input. Plain nodes / uncollapsed groups → null (no
// bundle; the output renders as a normal readout row + cable). Membership-based
// so it doesn't depend on pill computation order.
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

/**
 * A group's readout terminals (Display rows + each member output that leaves the
 * group + leaf members), derived independently of collapse state — so a PINNED
 * group shows the same readouts a collapsed one would. Same Pass 1/2/2b logic as
 * recomputeGroupCollapse, minus the edge-pill / ribbon bundling (one row per
 * crossing output socket; Pin shows each lane's value).
 */
export function groupReadouts(editor: Editor, group: GroupNode): RetainedTerminal[] {
  const members = new Set(extendedMembers(editor, group));
  const conns = editor.getConnections();
  const terminals: RetainedTerminal[] = [];
  const exposed = new Set<string>();

  // Pass 1: Display readouts (follow one Display→FC hop).
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

  // Pass 2: any other member output that crosses the boundary.
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

  // Pass 2b: a leaf member (has an output but feeds nothing).
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

/** Recompute the hidden-node / hidden-cable / retained-terminal sets. */
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

  // Pass 0: hidden-node membership for ALL collapsed groups, complete before any
  // per-group processing — output bundling needs to know whether a target is
  // hidden in a DIFFERENT collapsed group. Membership is EXTENDED: a node docked
  // to a member hides (and bundles) with its host even if never absorbed.
  const nodeGroup = new Map<string, string>(); // hidden member id → its group id
  const membersOf = new Map<string, string[]>();
  for (const g of groups) {
    const ext = extendedMembers(editor, g);
    membersOf.set(g.id, ext);
    for (const id of ext) { _hiddenNodes.add(id); nodeGroup.set(id, g.id); }
  }

  for (const g of groups) {
    const members = new Set(membersOf.get(g.id)!);

    const terminals: RetainedTerminal[] = [];
    const exposed = new Set<string>(); // node ids already surfaced (Display + its FC hop)
    // Value-source node id → the readout row that already shows it (a Display
    // readout's upstream feeder). A crossing whose underlying value matches one
    // of these anchors its cable at that row instead of adding a duplicate row —
    // so a value that feeds both a Display and an exporting Conduit shows once.
    const displayRowBySource = new Map<string, number>();

    // Pass 1: Display readouts (the special-cased visible terminals).
    for (const id of members) {
      const node = editor.getNode(id);
      if (!(node instanceof DisplayNode)) continue;

      // Effective output: follow one Display→FC member hop.
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
        // Remember which nodes feed this Display, so an exporting Conduit lane (or
        // any crossing) carrying the same value merges into this row.
        for (const ic of conns) if (ic.target === id) displayRowBySource.set(ic.source, rowIndex);
      }
    }

    // Pass 2: any other member whose output crosses the boundary → generic row.
    // One row per source socket; skip nodes already exposed by a Display.
    const seenOut = new Set<string>();
    const rowedMembers = new Set<string>(); // members that already have a generic row
    // A hidden Conduit's outputs that land on ONE external bundling-destination (a
    // visible Conduit, or another collapsed group) share a COMBINED output pill +
    // row, keyed by (conduit, destination) — their cables render as one ribbon
    // trunk running all the way to that destination. Outputs to plain nodes /
    // uncollapsed groups fall through to normal per-socket readout rows.
    const conduitDestRow = new Map<string, number>(); // `${conduit}|${kind}:${id}` → row index
    for (const c of conns) {
      if (!members.has(c.source) || members.has(c.target)) continue; // not outbound-crossing
      if (exposed.has(c.source)) continue;                            // already a Display/FC row
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
        // dest is a plain node / uncollapsed group → normal row (fall through)
      }
      // The node whose VALUE this crossing carries: a Conduit lane mirrors the
      // node feeding the matching input lane; any other crossing is its own
      // source. Used for both the readout LABEL and dedup against Display rows —
      // so the row reads "Net cash flow", not the Conduit's name ("Cash KPIs").
      let valueSrcId = c.source;
      if (isConduitLane) {
        const laneIn = `in_${c.sourceOutput.slice(4)}`;
        valueSrcId = conns.find((cc) => cc.target === c.source && cc.targetInput === laneIn)?.source ?? c.source;
      }
      // Already shown by a Display readout → anchor this cable at that row, no
      // duplicate readout. (Cable still needs a pill, so we set it, then skip.)
      const dispRow = displayRowBySource.get(valueSrcId);
      if (dispRow !== undefined) {
        _outPill.set(key, { groupId: g.id, side: "right", index: dispRow });
        continue;
      }
      const valueSrc = valueSrcId === c.source ? node : editor.getNode(valueSrcId);
      rowedMembers.add(c.source);
      terminals.push({ kind: "node", displayId: c.source, label: genericLabel(valueSrc ?? node), effNodeId: c.source, effSocketKey: c.sourceOutput });
    }

    // Pass 2b: a leaf member — an output node with NO outgoing connection at all
    // (e.g. a LAMBDA / Filter whose table result is the group's endpoint but isn't
    // wired onward) — is also a terminal worth surfacing. Its first output socket
    // becomes the readout row. (Crossing-out leaves are already covered above.)
    for (const id of members) {
      if (exposed.has(id) || rowedMembers.has(id)) continue;
      const node = editor.getNode(id);
      if (!node) continue;
      const firstOut = Object.keys(node.outputs ?? {})[0];
      if (!firstOut) continue;                                         // no output → nothing to read
      if (conns.some((c) => c.source === id)) continue;               // feeds something → not a leaf
      terminals.push({ kind: "node", displayId: id, label: genericLabel(node), effNodeId: id, effSocketKey: firstOut });
    }

    _retained.set(g.id, terminals);
    // Each retained terminal's effective output is a right pill at its row.
    terminals.forEach((t, i) =>
      _outPill.set(`${t.effNodeId}::${t.effSocketKey}`, { groupId: g.id, side: "right", index: i }),
    );

    // Inbound cables crossing the boundary (external → member input) → left pills.
    // (Outbound crossings are now represented by the readout rows above.)
    // All crossings sourced from one visible external Conduit's outputs share a
    // single COMBINED pill row: their cables render as one ribbon trunk that
    // terminates whole on the pill, so they need one anchor point, not N rows.
    const inputs: InputPill[] = [];
    let inIdx = 0;
    const conduitPill = new Map<string, InputPill>(); // external conduit id → shared pill
    for (const c of conns) {
      if (!members.has(c.target) || members.has(c.source)) continue;
      const key = `${c.target}::${c.targetInput}`;
      if (_inPill.has(key)) continue;
      const srcNode = editor.getNode(c.source);
      // A Conduit source bundles into one combined input pill — whether it's a
      // visible external Conduit (forward ribbon) OR a Conduit hidden in another
      // collapsed group (inverse ribbon lands whole on this pill).
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

  // Hide a cable only when both ends are in the SAME collapsed group (truly
  // internal). A cable between two *different* collapsed groups stays visible —
  // both its ends are already redirected to those groups' pills.
  for (const c of conns) {
    const sg = nodeGroup.get(c.source);
    const tg = nodeGroup.get(c.target);
    if (sg && tg && sg === tg) _hiddenConns.add(c.id);
  }
  notify();
}

/**
 * Settle cable endpoints after a collapse/expand toggle. The collapse pills are
 * real sockets that reuse each member's nodeId/socketKey, so mounting/unmounting
 * them overwrites and then removes the members' entries in rete's socket-position
 * watcher. On EXPAND the member node doesn't re-render on its own, so its real
 * socket never re-registers and a cable can stay anchored at the gone pill's
 * coords. Fix: next frame, re-render the members (re-registering their sockets),
 * then a frame later re-measure every cable touching a member. (On collapse we
 * only re-measure — re-rendering members would clobber the pills' positions.)
 */
export function settleCollapse(
  editor: Editor,
  area: Area,
  groupId: string,
  members: string[],
  expanding: boolean,
): void {
  // Include docked satellites (virtual members — see extendedMembers): a
  // retained Display→FC hop registers a PILL on the FC's out socket, so an
  // unabsorbed docked FC needs the same expand re-render to re-register its
  // real socket, and its cables the same re-measure.
  const set = new Set(members);
  for (const m of members) for (const d of dockedNodeStore.getDockedTo(m)) set.add(d.id);
  requestAnimationFrame(() => {
    void area.update("node", groupId);
    if (expanding) for (const m of set) void area.update("node", m);
    requestAnimationFrame(() => {
      for (const c of editor.getConnections()) {
        if (set.has(c.source) || set.has(c.target)) void area.update("connection", c.id);
      }
    });
  });
}

/** Recompute, then hide/show member node elements to match (cables hide reactively). */
export function syncGroupCollapse(editor: Editor, area: Area): void {
  recomputeGroupCollapse(editor);
  for (const n of editor.getNodes()) {
    const el = area.nodeViews.get(n.id)?.element;
    if (!el) continue;
    const shouldHide = _hiddenNodes.has(n.id);
    // Hide with `visibility` (not `display: none`): the element stays laid out,
    // so its ResizeObserver-measured size and socket positions remain valid.
    // `display: none` collapses them to 0, leaving member boxes half-rendered and
    // cables anchored at the origin when the group is later expanded (esp. after
    // a Tidy moved the collapsed group). Cables to hidden members are hidden /
    // redirected by the store, and `pointer-events:none` keeps them un-clickable.
    el.style.visibility = shouldHide ? "hidden" : "";
    el.style.pointerEvents = shouldHide ? "none" : "";
  }
}
