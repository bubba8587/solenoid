import { ClassicPreset } from "rete";
import type { SolenoidNode, SolenoidConnection } from "./schemes";
import { selectNode, unselectAllNodes, beginGraphRebuild, endGraphRebuild, bulkSettle, markGraphCustom, getCtorRegistry, processGraph } from "./process";
import { getActiveEditor, getActiveArea, isSubgraphActive } from "./activeGraph";
import { collapseStore } from "./collapseStore";
import { nodeNameStore } from "./nodeNameStore";

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
  // Active graph, not main — copy/paste works inside a Composite drill-in too.
  const editor = getActiveEditor();
  const area = getActiveArea();
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

// textForm.ts's writer shares this order so a node's text-form line is byte-identical
// across writes; appending is safe, reordering rewrites every existing save.
export const INIT_FIELD_ORDER = [
  "label", "op", "form", "value", "unitSuffix", "fromUnit", "toUnit", "lanes", "matchMode", "matchCase", "searchMode", "paymentTiming", "ignoreEmpty", "noCommas", "hostNodeId", "socketKey", "side", "format", "customPattern", "decimalDigits", "decimalMode", "unit", "customUnit", "socketDataType", "expr", "params", "locked", "axis", "op2", "combine", "textCase", "bold", "italic", "textScale", "textAlign", "textMarkdown", "textMono", "logicalStyle", "lambdaView", "chartFontScale", "grouping", "negativeStyle", "scaleMode", "advancedOpen",
  "tableText", "frameText", "pointsText", "url", "fileName", "assetPath", "path", "subfolder", "refreshMinutes", "tableIndex", "query", "dir", "how", "asofDirection", "mode", "inFormat", "outFormat", "provider",
  "inputAngle", "outputAngle", "inputTightness", "outputTightness", "angle",
  "selectedColumn", "selectedValues", "selectedLayer", "multiSelect", "forecast", "offDiag", "readAs", "addAs", "activeIndex", "target", "resultAs", "colType", "dataType", "angleMode", "lambdaKeys", "sideVars",
  "hoverColor",
  "totalDepth", "rowTotalDepth", "colTotalDepth", "rowSort", "colSort", "relativeTo", "normalize", "detail",
  "members", "color", "collapsed", "width", "height", "title", "body", "seq", "defaultValue",
  "checkNotNull", "checkUnique", "checkRange", "checkRegex", "checkAllowed", "integer",
  "runMode", "simulationSteps", "stopWhenPortId", "stopWhenOp", "stopWhenValue", "byRowPortId", "embeds", "steps",
  "wrap",
] as const;

// Object-valued extras, appended after INIT_FIELD_ORDER in this fixed order.
export const INIT_EXTRA_FIELD_ORDER = [
  "funcs", "filterExclude", "condConfig", "fieldTypes", "weightMap", "normMap", "titles", "selectedKeys", "varDescriptions", "bindings",
] as const;

export function extractInit(src: ClassicPreset.Node): Record<string, unknown> {
  const n = src as unknown as Record<string, unknown>;
  const init: Record<string, unknown> = {};
  for (const key of INIT_FIELD_ORDER) {
    if (key in n && n[key] !== undefined) init[key] = n[key];
  }
  // Every map below is deep-copied because the source node mutates it live; a
  // shallow share would let a paste edit its original.
  if (n.funcs && typeof n.funcs === "object") {
    init.funcs = { ...(n.funcs as object) };
  }
  if (n.filterExclude && typeof n.filterExclude === "object") {
    init.filterExclude = Object.fromEntries(
      Object.entries(n.filterExclude as Record<string, string[]>).map(([k, v]) => [k, [...v]]),
    );
  }
  // Keep only LIVE rows: a removed row leaves an orphan behind for undo's row-restore,
  // which would break the text form's byte-identical second write. Match on EITHER key
  // so a List Filter row (value-only, no column) persists too.
  if (n.condConfig && typeof n.condConfig === "object") {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    init.condConfig = Object.fromEntries(
      Object.entries(n.condConfig as Record<string, object>)
        .filter(([k]) => `value${k}` in liveInputs || `column${k}` in liveInputs)
        .map(([k, v]) => [k, { ...v }]),
    );
  }
  if (n.fieldTypes && typeof n.fieldTypes === "object") {
    init.fieldTypes = { ...(n.fieldTypes as object) };
  }
  if (n.weightMap && typeof n.weightMap === "object") {
    init.weightMap = { ...(n.weightMap as object) };
  }
  if (n.normMap && typeof n.normMap === "object") {
    init.normMap = { ...(n.normMap as object) };
  }
  // Keep only LIVE input keys, else an orphan title breaks the text form's
  // byte-identical second write.
  if (n.titles && typeof n.titles === "object") {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    const entries = Object.entries(n.titles as Record<string, string>).filter(([k]) => k in liveInputs);
    if (entries.length) init.titles = Object.fromEntries(entries);
    else delete init.titles;
  }
  // Live input keys only, same rationale.
  if (Array.isArray(n.selectedKeys)) {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    const kept = (n.selectedKeys as string[]).filter((k) => k in liveInputs);
    if (kept.length) init.selectedKeys = kept;
    else delete init.selectedKeys;
  }
  // Live variables only, same rationale.
  if (n.varDescriptions && typeof n.varDescriptions === "object") {
    const live = new Set((n.varNames as string[] | undefined) ?? []);
    const entries = Object.entries(n.varDescriptions as Record<string, string>)
      .filter(([k, v]) => live.has(k) && v.trim() !== "");
    if (entries.length) init.varDescriptions = Object.fromEntries(entries);
  }
  // Live variables only, and SORTED — a reordered entry breaks the text form's
  // byte-identical second write.
  if (n.bindings && typeof n.bindings === "object") {
    const live = new Set((n.defVars as string[] | undefined) ?? []);
    const entries = Object.entries(n.bindings as Record<string, string>)
      .filter(([k, v]) => live.has(k) && v !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length) init.bindings = Object.fromEntries(entries);
  }
  // A composite's subgraph rides along via its own snapshotInternal(), so paste and
  // persistence round-trip its contents without knowing anything about them.
  if (Array.isArray(n.inputPorts)) {
    init.inputPorts = (n.inputPorts as object[]).map((p) => ({ ...p }));
  }
  if (Array.isArray(n.outputPorts)) {
    init.outputPorts = (n.outputPorts as object[]).map((p) => ({ ...p }));
  }
  if (Array.isArray(n.scenarios)) {
    init.scenarios = (n.scenarios as Array<{ id: string; name: string; overrides: Record<string, unknown> }>)
      .map((s) => ({ id: s.id, name: s.name, overrides: { ...s.overrides } }));
  }
  if (n.dataTableValues && typeof n.dataTableValues === "object") {
    init.dataTableValues = Object.fromEntries(
      Object.entries(n.dataTableValues as Record<string, unknown[]>).map(([k, v]) => [k, [...v]]),
    );
  }
  // null means unconfigured, so drop the key rather than persist a null.
  if (n.goalSeek && typeof n.goalSeek === "object") {
    init.goalSeek = { ...(n.goalSeek as object) };
  }
  if (n.monteCarlo && typeof n.monteCarlo === "object") {
    init.monteCarlo = { ...(n.monteCarlo as object) };
  }
  // Only when SET: a point-value marker persists nothing, and "normal" is implied.
  if (typeof n.uncertainty === "number" && n.uncertainty > 0) {
    init.uncertainty = n.uncertainty;
    if (n.distribution === "uniform") init.distribution = "uniform";
  }
  if (typeof n.snapshotInternal === "function") {
    init.internal = (n.snapshotInternal as () => unknown)();
  }
  // Spread literals so constructor fields like min/max/step are picked up.
  if (n.literals && typeof n.literals === "object") {
    Object.assign(init, n.literals as object);
  }
  // Capture EVERY input key so the constructor rebuilds the exact rows on clone/load;
  // it filters down to the keys it owns.
  if ((typeof n.addValueInput === "function" || typeof n.addValuePair === "function") && n.inputs) {
    init.valueKeys = Object.keys(n.inputs as object);
  }
  return init;
}

function cloneNode(src: ClassicPreset.Node): ClassicPreset.Node | null {
  try {
    const Ctor = src.constructor as new (init?: Record<string, unknown>) => ClassicPreset.Node;
    const clone = new Ctor(extractInit(src));
    // Restore the mutable value maps AFTER construction — the constructor's own
    // defaults would otherwise overwrite the copied values.
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
  const editor = getActiveEditor();
  const area = getActiveArea();
  if (!editor || !area) return;
  // Inside a drill-in the selection + settle singletons are main-bound and don't apply.
  const subgraph = isSubgraphActive();

  const originX = canvasX + PASTE_OFFSET;
  const originY = canvasY + PASTE_OFFSET;

  const clones = _clipboard.entries.map((e) => cloneNode(e.node));

  // Members not part of the copy are dropped, so a copied group can't steal originals.
  const oldToNew = new Map<string, string>();
  for (let i = 0; i < clones.length; i++) {
    if (clones[i]) oldToNew.set(_clipboard.entries[i].node.id, clones[i]!.id);
  }
  for (const clone of clones) {
    if (!clone) continue;
    const ref = clone as unknown as { members?: string[]; hostNodeId?: string };
    if (Array.isArray(ref.members)) {
      ref.members = ref.members.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
    }
    // A docked FC whose host wasn't copied must UNDOCK, not bind to the original.
    if (typeof ref.hostNodeId === "string" && ref.hostNodeId) {
      ref.hostNodeId = oldToNew.get(ref.hostNodeId) ?? "";
    }
    // Same rule for presentation steps: a duplicated deck flies to its OWN nodes.
    const stepsRef = clone as unknown as { steps?: Array<{ nodeIds?: string[] }> };
    if (Array.isArray(stepsRef.steps)) {
      for (const step of stepsRef.steps) {
        if (Array.isArray(step.nodeIds)) {
          step.nodeIds = step.nodeIds.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
        }
      }
    }
  }

  // The rebuild gate skips the per-`nodecreated` absorb sweep (O(N²) ungated), so
  // pasted nodes keep their COPIED membership instead of joining where they land.
  const toAdd: Array<{ clone: SolenoidNode; x: number; y: number }> = [];
  for (let i = 0; i < clones.length; i++) {
    const clone = clones[i];
    if (!clone) continue;
    // Body collapse lives in collapseStore, not on the instance, so carry it across.
    if (collapseStore.get(_clipboard.entries[i].node.id)) collapseStore.set(clone.id, true);
    // Sequenced identities must not duplicate — the clone re-claims a fresh number.
    const fresh = (clone as unknown as { assignFreshSeq?: () => void }).assignFreshSeq;
    if (typeof fresh === "function") fresh.call(clone);
    toAdd.push({ clone: clone as SolenoidNode, x: originX + _clipboard.entries[i].x, y: originY + _clipboard.entries[i].y });
  }

  if (!subgraph) unselectAllNodes();
  beginGraphRebuild();
  try {
    await Promise.all(toAdd.map(async ({ clone, x, y }) => {
      await editor.addNode(clone);
      // A FRESH name, never the source's — the source is still on the canvas, so
      // inheriting it would collide immediately.
      nodeNameStore.ensure(clone.id, clone.constructor.name);
      await area.translate(clone.id, { x, y });
    }));
    // The captured subgraph snapshot hydrates into live instances only once the
    // clone exists.
    const reg = getCtorRegistry();
    for (const { clone } of toAdd) {
      const hydrate = (clone as unknown as { hydrate?: (r: typeof reg) => Promise<void> }).hydrate;
      if (typeof hydrate === "function") await hydrate(reg);
    }
    if (!subgraph) toAdd.forEach(({ clone }, idx) => selectNode(clone.id, idx > 0));
    // `connectioncreated`'s settle is O(cables × nodes); the gate skips it per-cable
    // and bulkSettle() runs the equivalent ONCE below.
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

  if (subgraph) {
    // rete already created the views on addNode; recompute through the owning composite.
    await processGraph();
    return;
  }
  // A paste is self-contained, so only the pasted nodes need rendering.
  await bulkSettle(new Set(toAdd.map((b) => b.clone.id)));
  markGraphCustom(); // a paste makes the doc no longer a pristine seed
}
