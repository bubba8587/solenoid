import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "./schemes";
import { getEditor, getArea, selectNode, unselectAllNodes, beginGraphRebuild, endGraphRebuild, bulkSettle, markGraphCustom } from "./process";
import { collapseStore } from "./collapseStore";

interface ClipboardEntry {
  node: SolenoidNode;
  x: number; // relative to selection top-left
  y: number;
}

interface ClipboardData {
  entries: ClipboardEntry[];
  connections: Array<{
    srcIdx: number;
    srcOutput: string;
    tgtIdx: number;
    tgtInput: string;
  }>;
}

let _clipboard: ClipboardData | null = null;

export function copySelected() {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;

  const directly = editor.getNodes().filter((n) => n.selected) as SolenoidNode[];
  if (directly.length === 0) return;
  // A selected group brings its members along, so paste reproduces the contents.
  const ids = new Set(directly.map((n) => n.id));
  for (const n of directly) {
    const members = (n as unknown as { members?: string[] }).members;
    if (Array.isArray(members)) for (const m of members) ids.add(m);
  }
  const selected = editor.getNodes().filter((n) => ids.has(n.id)) as SolenoidNode[];

  const selectedIds = new Set(selected.map((n) => n.id));
  const internalConns = editor.getConnections().filter(
    (c) => selectedIds.has(c.source) && selectedIds.has(c.target),
  );

  const positions = selected.map(
    (n) => area.nodeViews.get(n.id)?.position ?? { x: 0, y: 0 },
  );
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));

  const idxMap = new Map(selected.map((n, i) => [n.id, i]));

  _clipboard = {
    entries: selected.map((n, i) => ({
      node: n,
      x: positions[i].x - minX,
      y: positions[i].y - minY,
    })),
    connections: internalConns.map((c) => ({
      srcIdx: idxMap.get(c.source)!,
      srcOutput: c.sourceOutput,
      tgtIdx: idxMap.get(c.target)!,
      tgtInput: c.targetInput,
    })),
  };
}

export function extractInit(src: ClassicPreset.Node): Record<string, unknown> {
  const n = src as unknown as Record<string, unknown>;
  const init: Record<string, unknown> = {};
  for (const key of ["label", "op", "value", "unitSuffix", "fromUnit", "toUnit", "lanes", "matchMode", "searchMode", "paymentTiming", "ignoreEmpty", "noCommas", "hostNodeId", "socketKey", "side", "format", "customPattern", "decimalDigits", "decimalMode", "unit", "customUnit", "socketDataType", "expr", "params", "locked", "axis", "op2", "combine", "textCase", "bold", "italic", "textScale",
                    "tableText", "frameText", "url", "fileName", "tableIndex", "query", "dir", "how", "mode", "inFormat", "outFormat",
                    "inputAngle", "outputAngle", "inputTightness", "outputTightness", "angle",
                    "selectedColumn", "selectedValues", "multiSelect", "readAs", "addAs", "activeIndex", "target", "resultAs", "colType",
                    "rowTotalDepth", "colTotalDepth", "rowSort", "colSort", "relativeTo", "normalize", "detail",
                    "members", "color", "collapsed", "width", "height", "title", "body", "seq", "embeds"]) {
    if (key in n && n[key] !== undefined) init[key] = n[key];
  }
  // PivotNode per-value aggregation map: deep-copy so a paste doesn't share the
  // source node's object (it's mutated live when a value's function changes).
  if (n.funcs && typeof n.funcs === "object") {
    init.funcs = { ...(n.funcs as object) };
  }
  // PivotNode field-value filter (field → excluded value keys). Deep-copy the arrays
  // so a paste/reload doesn't alias the source node's live filter.
  if (n.filterExclude && typeof n.filterExclude === "object") {
    init.filterExclude = Object.fromEntries(
      Object.entries(n.filterExclude as Record<string, string[]>).map(([k, v]) => [k, [...v]]),
    );
  }
  // Note frontmatter type-overrides: a per-key map the constructor clones. Deep-copy
  // so a paste doesn't share the source note's object (it's mutated live on retype).
  if (n.fieldTypes && typeof n.fieldTypes === "object") {
    init.fieldTypes = { ...(n.fieldTypes as object) };
  }
  // Decision Matrix per-criterion weights + per-column normalize overrides (both
  // criterion-name → value maps). Deep-copy so a paste/reload doesn't alias the
  // source node's live maps (mutated as you edit).
  if (n.weightMap && typeof n.weightMap === "object") {
    init.weightMap = { ...(n.weightMap as object) };
  }
  if (n.normMap && typeof n.normMap === "object") {
    init.normMap = { ...(n.normMap as object) };
  }
  // Spread literals so constructor fields like min/max/step are picked up.
  if (n.literals && typeof n.literals === "object") {
    Object.assign(init, n.literals as object);
  }
  // Extensible nodes carry an arbitrary set of value-input keys — flat (List,
  // Concat, CHOOSE: addValueInput) or paired (IFS, SWITCH: addValuePair).
  // Capture every input key so the constructor rebuilds the exact rows on
  // clone/load; the constructor filters to the keys it owns (the renderer's pair
  // helpers / value-key filter ignore fixed inputs like `index`/`expr`/`default`).
  if ((typeof n.addValueInput === "function" || typeof n.addValuePair === "function") && n.inputs) {
    init.valueKeys = Object.keys(n.inputs as object);
  }
  return init;
}

function cloneNode(src: ClassicPreset.Node): ClassicPreset.Node | null {
  try {
    const Ctor = src.constructor as new (init?: Record<string, unknown>) => ClassicPreset.Node;
    const clone = new Ctor(extractInit(src));
    // Restore mutable per-instance value maps after construction — the
    // constructor sets its own defaults, which would otherwise overwrite the
    // copied values. `literals` holds inline numeric inputs; `stringLiterals`
    // holds inline text inputs (Text Input, Regex pattern/flags, Text Filter…).
    const srcAny = src as unknown as Record<string, unknown>;
    const cloneAny = clone as unknown as Record<string, unknown>;
    if (srcAny.literals && typeof srcAny.literals === "object") {
      cloneAny.literals = { ...(srcAny.literals as Record<string, number>) };
    }
    if (srcAny.stringLiterals && typeof srcAny.stringLiterals === "object") {
      cloneAny.stringLiterals = { ...(srcAny.stringLiterals as Record<string, string>) };
    }
    return clone;
  } catch {
    return null;
  }
}

const PASTE_OFFSET = 30; // canvas units

export async function pasteClipboard(canvasX: number, canvasY: number) {
  if (!_clipboard || _clipboard.entries.length === 0) return;
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;

  const originX = canvasX + PASTE_OFFSET;
  const originY = canvasY + PASTE_OFFSET;

  const clones = _clipboard.entries.map((e) => cloneNode(e.node));

  // Remap Group member ids to the pasted copies. Members that weren't part of
  // the copy are dropped (a copied group box doesn't steal the originals).
  const oldToNew = new Map<string, string>();
  for (let i = 0; i < clones.length; i++) {
    if (clones[i]) oldToNew.set(_clipboard.entries[i].node.id, clones[i]!.id);
  }
  for (const clone of clones) {
    if (!clone) continue;
    const ref = clone as unknown as { members?: string[]; hostNodeId?: string };
    // Group: keep only members that were part of the copy, remapped to the clones.
    if (Array.isArray(ref.members)) {
      ref.members = ref.members.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
    }
    // Docked FC: re-point at the pasted copy of its host. If the host wasn't part
    // of the copy, undock (clear) instead of binding to the original's host —
    // otherwise a duplicated group's FC docks onto the *original* group's node.
    if (typeof ref.hostNodeId === "string" && ref.hostNodeId) {
      ref.hostNodeId = oldToNew.get(ref.hostNodeId) ?? "";
    }
  }

  // Synchronous setup (carry per-node collapse, claim fresh sequence ids), then add +
  // position the clones CONCURRENTLY under the rebuild gate. The node loop used to be
  // sequential AND ungated, so each addNode fired `nodecreated` → the live "absorb into
  // the group it's dropped inside" sweep (an O(nodes) membership rebuild) ran ~N times =
  // O(N²), and the ~N React-root mounts ran one-at-a-time. That's the post-crash-fix
  // "paste still hangs". Gating skips absorb (pasted nodes keep their COPIED group
  // membership — they don't join whatever group they happen to land on, which is the
  // correct paste behavior), and Promise.all de-serializes the mounts (mirrors load/B1).
  const toAdd: Array<{ clone: SolenoidNode; x: number; y: number }> = [];
  for (let i = 0; i < clones.length; i++) {
    const clone = clones[i];
    if (!clone) continue;
    // Per-node body collapse lives in collapseStore (not on the instance), so carry it
    // across explicitly — a copied collapsed node pastes collapsed.
    if (collapseStore.get(_clipboard.entries[i].node.id)) collapseStore.set(clone.id, true);
    // Sequenced identities (Conduit) must not duplicate: the clone re-claims a fresh
    // number instead of keeping the copied one.
    const fresh = (clone as unknown as { assignFreshSeq?: () => void }).assignFreshSeq;
    if (typeof fresh === "function") fresh.call(clone);
    toAdd.push({ clone: clone as SolenoidNode, x: originX + _clipboard.entries[i].x, y: originY + _clipboard.entries[i].y });
  }

  unselectAllNodes();
  beginGraphRebuild();
  try {
    await Promise.all(toAdd.map(async ({ clone, x, y }) => {
      await editor.addNode(clone);
      await area.translate(clone.id, { x, y });
    }));
    // Select the pasted nodes (deterministic order, after the concurrent adds).
    toAdd.forEach(({ clone }, idx) => selectNode(clone.id, idx > 0));
    // Each addConnection fires `connectioncreated`, whose settle (FC reconcile +
    // mismatch rescan + a FULL processGraph + collapse re-sync) is O(cables × nodes);
    // the gate skips it per-cable and bulkSettle() runs the equivalent ONCE below.
    for (const conn of _clipboard.connections) {
      const src = clones[conn.srcIdx];
      const tgt = clones[conn.tgtIdx];
      if (!src || !tgt) continue;
      try {
        await editor.addConnection(
          new ClassicPreset.Connection(
            src,
            conn.srcOutput,
            tgt,
            conn.tgtInput,
          ) as SolenoidConnection,
        );
      } catch {
        // Skip incompatible or duplicate connections.
      }
    }
  } finally {
    endGraphRebuild();
  }

  // Render only the pasted nodes: they're a self-contained copy that doesn't touch
  // existing nodes, so the originals need no recompute/re-render (bulkSettle skips the
  // engine reset for the additive set).
  await bulkSettle(new Set(toAdd.map((b) => b.clone.id)));
  markGraphCustom(); // a paste makes the doc no longer a pristine seed
}
