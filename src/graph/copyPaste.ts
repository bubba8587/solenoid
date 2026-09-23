// [[C30]] saveViaTextForm, [[C86]] membershipByGesture, [[D50]] everyFieldClassified, [[C29]] plainJsonInit
import { ClassicPreset, type NodeEditor } from "rete";
import type { Schemes, SolenoidNode, SolenoidConnection } from "./schemes";
import { dockedNodeStore } from "./dockedNodeStore";
import { beginGraphRebuild, endGraphRebuild, bulkSettle, processGraph } from "./process";
import { selectNode, unselectAllNodes } from "./canvasCommands";
import { getCtorRegistry } from "./ctorProvider";
import { getActiveEditor, getActiveView, isSubgraphActive } from "./activeGraph";
import { collapseStore } from "./collapseStore";
import { socketFlipStore } from "./socketFlipStore";
import { nodeNameStore } from "./nodeNameStore";

// A snapshot taken at copy time, so a later edit or delete of the source never changes what pastes.
interface ClipboardEntry {
  id: string;
  Ctor: new (init?: Record<string, unknown>) => ClassicPreset.Node;
  init: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  collapsed: boolean;
  flipped: boolean;
  x: number;
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

// By name, not instanceof: composite.ts imports this module.
const isMarker = (n: { constructor: { name: string } }) =>
  n.constructor.name === "CompositeInputNode" || n.constructor.name === "CompositeOutputNode";

/** The nodes a copy takes: the selection, a group's members and every docked FC riding a copied node, never a boundary marker. */
export function copySet(editor: NodeEditor<Schemes>): SolenoidNode[] {
  const ids = new Set<string>();
  for (const n of editor.getNodes()) {
    if (!n.selected) continue;
    ids.add(n.id);
    const members = (n as unknown as { members?: string[] }).members;
    if (Array.isArray(members)) for (const m of members) ids.add(m);
  }
  for (const id of [...ids]) for (const d of dockedNodeStore.getDockedTo(id)) ids.add(d.id);
  return editor.getNodes().filter((n) => ids.has(n.id) && !isMarker(n)) as SolenoidNode[];
}

export function copySelected() {
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view) return;

  const selected = copySet(editor);
  if (selected.length === 0) return;

  const selectedIds = new Set(selected.map((n) => n.id));
  const internalConns = editor.getConnections().filter(
    (c) => selectedIds.has(c.source) && selectedIds.has(c.target),
  );

  const positions = selected.map(
    (n) => view.position(n.id) ?? { x: 0, y: 0 },
  );
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));

  const idxMap = new Map(selected.map((n, i) => [n.id, i]));

  _clipboard = {
    entries: selected.map((n, i) => {
      const any = n as unknown as Record<string, unknown>;
      return {
        id: n.id,
        Ctor: n.constructor as ClipboardEntry["Ctor"],
        init: structuredClone(extractInit(n)),
        literals: any.literals && typeof any.literals === "object" ? { ...(any.literals as Record<string, number>) } : undefined,
        stringLiterals: any.stringLiterals && typeof any.stringLiterals === "object" ? { ...(any.stringLiterals as Record<string, string>) } : undefined,
        collapsed: !!collapseStore.get(n.id),
        flipped: !!socketFlipStore.get(n.id),
        x: positions[i].x - minX,
        y: positions[i].y - minY,
      };
    }),
    connections: internalConns.map((c) => ({
      srcIdx: idxMap.get(c.source)!,
      srcOutput: c.sourceOutput,
      tgtIdx: idxMap.get(c.target)!,
      tgtInput: c.targetInput,
    })),
  };
}

// textForm.ts's writer shares this order: appending is safe, reordering rewrites every existing save.
export const INIT_FIELD_ORDER = [
  "label", "op", "form", "value", "unitSuffix", "fromUnit", "toUnit", "lanes", "matchMode", "matchCase", "searchMode", "paymentTiming", "ignoreEmpty", "noCommas", "hostNodeId", "socketKey", "side", "format", "customPattern", "decimalDigits", "decimalMode", "unit", "customUnit", "socketDataType", "expr", "params", "locked", "axis", "op2", "combine", "textCase", "bold", "italic", "textScale", "textAlign", "textMarkdown", "textMono", "logicalStyle", "lambdaView", "chartFontScale", "grouping", "negativeStyle", "scaleMode", "advancedOpen", "match",
  "tableText", "frameText", "pointsText", "url", "fileName", "assetPath", "path", "subfolder", "refreshMinutes", "tableIndex", "query", "dir", "how", "asofDirection", "mode", "precision", "progress", "criticalPaths", "inFormat", "outFormat", "provider",
  "inputAngle", "outputAngle", "inputTightness", "outputTightness", "angle",
  "selectedColumn", "selectedValues", "selectedLayer", "multiSelect", "forecast", "offDiag", "readAs", "addAs", "activeIndex", "target", "resultAs", "colType", "dataType", "angleMode", "lambdaKeys", "sideVars",
  "hoverColor",
  "totalDepth", "rowTotalDepth", "colTotalDepth", "rowSort", "colSort", "relativeTo", "normalize", "detail",
  "members", "color", "collapsed", "width", "height", "lockedPosition", "title", "body", "seq", "defaultValue",
  "checkNotNull", "checkUnique", "checkRange", "checkRegex", "checkAllowed", "integer",
  "runMode", "simulationSteps", "stopWhenPortId", "stopWhenOp", "stopWhenValue", "byRowPortId", "embeds", "steps",
  "wrap", "method", "ceiling", "model", "standardize",
  "action", "agg", "order", "condition", "algorithm", "substance", "bands", "material", "symbol",
  "layoutHidden",
  "inheritFormat",
  "chip",
  "pickedLabel",
  "pastDays", "forecastDays",
  "country", "region", "year",
  "qrTemplate",
  "vault", "folder", "glob", "nameFormat", "includeBody", "addMissing", "writeBase",
  "cubeText",
  "stamp", "split",
  "pageName",
] as const;

export const INIT_EXTRA_FIELD_ORDER = [
  "funcs", "filterExclude", "condConfig", "fieldTypes", "titles", "selectedKeys", "varDescriptions", "bindings",
] as const;

export function extractInit(src: ClassicPreset.Node): Record<string, unknown> {
  const n = src as unknown as Record<string, unknown>;
  const init: Record<string, unknown> = {};
  for (const key of INIT_FIELD_ORDER) {
    if (key in n && n[key] !== undefined) init[key] = n[key];
  }
  if (n.funcs && typeof n.funcs === "object") {
    init.funcs = { ...(n.funcs as object) };
  }
  if (n.filterExclude && typeof n.filterExclude === "object") {
    init.filterExclude = Object.fromEntries(
      Object.entries(n.filterExclude as Record<string, string[]>).map(([k, v]) => [k, [...v]]),
    );
  }
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
  if (n.titles && typeof n.titles === "object") {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    const entries = Object.entries(n.titles as Record<string, string>).filter(([k]) => k in liveInputs);
    if (entries.length) init.titles = Object.fromEntries(entries);
    else delete init.titles;
  }
  if (Array.isArray(n.selectedKeys)) {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    const kept = (n.selectedKeys as string[]).filter((k) => k in liveInputs);
    if (kept.length) init.selectedKeys = kept;
    else delete init.selectedKeys;
  }
  if (n.varDescriptions && typeof n.varDescriptions === "object") {
    const live = new Set((n.varNames as string[] | undefined) ?? []);
    const entries = Object.entries(n.varDescriptions as Record<string, string>)
      .filter(([k, v]) => live.has(k) && v.trim() !== "");
    if (entries.length) init.varDescriptions = Object.fromEntries(entries);
  }
  if (n.bindings && typeof n.bindings === "object") {
    const live = new Set((n.defVars as string[] | undefined) ?? []);
    const entries = Object.entries(n.bindings as Record<string, string>)
      .filter(([k, v]) => live.has(k) && v !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length) init.bindings = Object.fromEntries(entries);
  }
  const savedId = typeof n.savedInternalId === "function"
    ? (n.savedInternalId as (id: string) => string).bind(n)
    : (id: string) => id;
  const savedPort = (p: { internalNodeId?: unknown }) =>
    (typeof p.internalNodeId === "string" ? { ...p, internalNodeId: savedId(p.internalNodeId) } : { ...p });
  if (Array.isArray(n.inputPorts)) {
    init.inputPorts = (n.inputPorts as { internalNodeId?: unknown }[]).map(savedPort);
  }
  if (Array.isArray(n.outputPorts)) {
    init.outputPorts = (n.outputPorts as { internalNodeId?: unknown }[]).map(savedPort);
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
  if (n.goalSeek && typeof n.goalSeek === "object") {
    init.goalSeek = { ...(n.goalSeek as object) };
  }
  if (n.monteCarlo && typeof n.monteCarlo === "object") {
    init.monteCarlo = { ...(n.monteCarlo as object) };
  }
  if (typeof n.uncertainty === "number" && n.uncertainty > 0) {
    init.uncertainty = n.uncertainty;
    if (n.distribution === "uniform") init.distribution = "uniform";
  }
  if (typeof n.snapshotInternal === "function") {
    init.internal = (n.snapshotInternal as () => unknown)();
  }
  if (n.literals && typeof n.literals === "object") {
    Object.assign(init, n.literals as object);
  }
  if ((typeof n.addValueInput === "function" || typeof n.addValuePair === "function") && n.inputs) {
    init.valueKeys = Object.keys(n.inputs as object);
  }
  return init;
}

function cloneEntry(e: ClipboardEntry): ClassicPreset.Node | null {
  try {
    const clone = new e.Ctor(structuredClone(e.init));
    // Restore the value maps after construction, or the constructor's own defaults overwrite them.
    const cloneAny = clone as unknown as Record<string, unknown>;
    if (e.literals) cloneAny.literals = { ...e.literals };
    if (e.stringLiterals) cloneAny.stringLiterals = { ...e.stringLiterals };
    return clone;
  } catch {
    return null;
  }
}

const PASTE_OFFSET = 30;

export async function pasteClipboard(canvasX: number, canvasY: number) {
  if (!_clipboard || _clipboard.entries.length === 0) return;
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view) return;
  const subgraph = isSubgraphActive();

  const originX = canvasX + PASTE_OFFSET;
  const originY = canvasY + PASTE_OFFSET;

  const clip = _clipboard;
  const clones = clip.entries.map(cloneEntry);

  const oldToNew = new Map<string, string>();
  for (let i = 0; i < clones.length; i++) {
    if (clones[i]) oldToNew.set(clip.entries[i].id, clones[i]!.id);
  }
  for (const clone of clones) {
    if (!clone) continue;
    const ref = clone as unknown as { members?: string[]; hostNodeId?: string };
    if (Array.isArray(ref.members)) {
      ref.members = ref.members.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
    }
    if (typeof ref.hostNodeId === "string" && ref.hostNodeId) {
      ref.hostNodeId = oldToNew.get(ref.hostNodeId) ?? "";
    }
    const stepsRef = clone as unknown as { steps?: Array<{ nodeIds?: string[] }> };
    if (Array.isArray(stepsRef.steps)) {
      for (const step of stepsRef.steps) {
        if (Array.isArray(step.nodeIds)) {
          step.nodeIds = step.nodeIds.map((m) => oldToNew.get(m)).filter((m): m is string => !!m);
        }
      }
    }
  }

  const toAdd: Array<{ clone: SolenoidNode; x: number; y: number }> = [];
  for (let i = 0; i < clones.length; i++) {
    const clone = clones[i];
    if (!clone) continue;
    if (clip.entries[i].collapsed) collapseStore.set(clone.id, true);
    if (clip.entries[i].flipped) socketFlipStore.set(clone.id, true);
    const fresh = (clone as unknown as { assignFreshSeq?: () => void }).assignFreshSeq;
    if (typeof fresh === "function") fresh.call(clone);
    toAdd.push({ clone: clone as SolenoidNode, x: originX + clip.entries[i].x, y: originY + clip.entries[i].y });
  }

  unselectAllNodes();
  beginGraphRebuild();
  try {
    await Promise.all(toAdd.map(async ({ clone, x, y }) => {
      await editor.addNode(clone);
      nodeNameStore.ensure(clone.id, clone.constructor.name);
      await view.moveNode(clone.id, { x, y });
    }));
    const reg = getCtorRegistry();
    for (const { clone } of toAdd) {
      const hydrate = (clone as unknown as { hydrate?: (r: typeof reg) => Promise<void> }).hydrate;
      if (typeof hydrate === "function") await hydrate(reg);
    }
    toAdd.forEach(({ clone }, idx) => selectNode(clone.id, idx > 0));
    for (const conn of clip.connections) {
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
      }
    }
    // The copied cables already carry the splice, so re-docking only registers the dock.
    for (const { clone } of toAdd) {
      const fc = clone as unknown as { hostNodeId?: string; dockSelf?: (e: typeof editor) => void };
      if (fc.hostNodeId && typeof fc.dockSelf === "function") fc.dockSelf(editor);
    }
  } finally {
    endGraphRebuild();
  }

  if (subgraph) {
    await processGraph();
    return;
  }
  await bulkSettle(new Set(toAdd.map((b) => b.clone.id)));
}
