// [[B12]] losslessSaves
// What a save holds of a card: its init fields, captured as plain JSON. Free of the editor, so a card's body on the
// core (nodeOnCore.ts) and the Obsidian plugin can read it.
import type { GraphNode } from "./graphModel";
import { readPivotView, savedPivotView } from "./pivotLayout";

// textForm.ts's writer shares this order: appending is safe, reordering rewrites every existing save.
export const INIT_FIELD_ORDER = [
  "label", "op", "form", "value", "unitSuffix", "fromUnit", "toUnit", "lanes", "matchMode", "matchCase", "matchEnd", "searchMode", "paymentTiming", "ignoreEmpty", "noCommas", "hostNodeId", "socketKey", "side", "format", "customPattern", "decimalDigits", "decimalMode", "unit", "customUnit", "socketDataType", "expr", "params", "locked", "axis", "op2", "combine", "textCase", "bold", "italic", "textScale", "textAlign", "textMarkdown", "textMono", "logicalStyle", "lambdaView", "chartFontScale", "grouping", "negativeStyle", "scaleMode", "advancedOpen", "match",
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
  "scanBy", "skipCells", "indexAxes",
  "byCol", "exactlyOnce",
  "typedKeys",
  "choices",
] as const;

export const INIT_EXTRA_FIELD_ORDER = [
  "funcs", "filterExclude", "condConfig", "fieldTypes", "titles", "selectedKeys", "varDescriptions", "varUnits", "bindings",
  "keyOrder", "pivotView", "detailFields",
] as const;

const INIT_INDEX = new Map<string, number>(INIT_FIELD_ORDER.map((k, i) => [k, i]));
const inherited = new WeakMap<object, number[]>();

/** The positions of the saved names a prototype chain defines (a getter, a method), read once per prototype. */
function inheritedInitKeys(proto: object | null): number[] {
  if (!proto) return [];
  let keys = inherited.get(proto);
  if (!keys) {
    const found = new Set<number>();
    for (let p: object | null = proto; p; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) {
        const i = INIT_INDEX.get(k);
        if (i !== undefined) found.add(i);
      }
    }
    keys = [...found];
    inherited.set(proto, keys);
  }
  return keys;
}

export function extractInit(src: GraphNode): Record<string, unknown> {
  const n = src as unknown as Record<string, unknown>;
  const init: Record<string, unknown> = {};
  // The saved names the card has, own or inherited, in their order ([[C120]] linearWork: a call reads it every pass).
  const at = [...inheritedInitKeys(Object.getPrototypeOf(n))];
  for (const k of Object.getOwnPropertyNames(n)) {
    const i = INIT_INDEX.get(k);
    if (i !== undefined) at.push(i);
  }
  at.sort((a, b) => a - b);
  let prev = -1;
  for (const i of at) {
    if (i === prev) continue;
    prev = i;
    const key = INIT_FIELD_ORDER[i];
    const v = n[key];
    // A method is no field: a split card's `body()` shares its name with a Note's saved `body`.
    if (v !== undefined && typeof v !== "function") init[key] = v;
  }
  if (n.funcs && typeof n.funcs === "object") {
    init.funcs = { ...(n.funcs as object) };
  }
  if (n.filterExclude && typeof n.filterExclude === "object") {
    init.filterExclude = Object.fromEntries(
      Object.entries(n.filterExclude as Record<string, string[]>).map(([k, v]) => [k, [...v]]),
    );
  }
  if (n.pivotView && typeof n.pivotView === "object") {
    const saved = savedPivotView(readPivotView(n.pivotView));
    if (saved) init.pivotView = saved;
  }
  if (Array.isArray(n.detailFields) && n.detailFields.length) init.detailFields = [...(n.detailFields as string[])];
  if (n.condConfig && typeof n.condConfig === "object") {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    init.condConfig = Object.fromEntries(
      Object.entries(n.condConfig as Record<string, object>)
        .filter(([k]) => `value${k}` in liveInputs || `column${k}` in liveInputs)
        .map(([k, v]) => [k, { ...v }]),
    );
  }
  if (n.keyOrder && typeof n.keyOrder === "object") {
    const liveInputs = (n.inputs ?? {}) as Record<string, unknown>;
    const entries = Object.entries(n.keyOrder as Record<string, string>).filter(([k]) => `key${k}` in liveInputs);
    if (entries.length) init.keyOrder = Object.fromEntries(entries);
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
  if (n.varUnits && typeof n.varUnits === "object") {
    const live = new Set((n.varNames as string[] | undefined) ?? []);
    const entries = Object.entries(n.varUnits as Record<string, string>).filter(([k, v]) => live.has(k) && v !== "");
    if (entries.length) init.varUnits = Object.fromEntries(entries);
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
  if ((typeof n.addValueInput === "function" || typeof n.addValuePair === "function") && n.inputs) {
    init.valueKeys = Object.keys(n.inputs as object);
  }
  return init;
}
