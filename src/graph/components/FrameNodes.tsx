// Frame (data-table) node components: Frame Input, Build, Split, Get Column, Add Column.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import type {
  FrameInputNode as FrameInputNodeType,
  BuildFrameNode as BuildFrameNodeType,
  SplitFrameNode as SplitFrameNodeType,
  GetColumnNode as GetColumnNodeType,
  AddColumnNode as AddColumnNodeType,
  ComputedColumnNode as ComputedColumnNodeType,
  GetRowNode as GetRowNodeType,
  DistinctNode as DistinctNodeType,
  HeadNode as HeadNodeType,
  SortFrameNode as SortFrameNodeType,
  FilterFrameNode as FilterFrameNodeType,
  JoinNode as JoinNodeType,
  SelectColumnsNode as SelectColumnsNodeType,
  DropColumnsNode as DropColumnsNodeType,
  GroupByFrameNode as GroupByFrameNodeType,
  PivotNode as PivotNodeType,
  UnpivotNode as UnpivotNodeType,
  NestNode as NestNodeType,
  UnnestNode as UnnestNodeType,
  AppendNode as AppendNodeType,
  RenameNode as RenameNodeType,
  SplitColumnNode as SplitColumnNodeType,
  AddIndexNode as AddIndexNodeType,
  FillBlanksNode as FillBlanksNodeType,
  ReplaceValuesNode as ReplaceValuesNodeType,
  MergeColumnsNode as MergeColumnsNodeType,
  HeadersNode as HeadersNodeType,
  DropBlankRowsNode as DropBlankRowsNodeType,
  DecisionMatrixNode as DecisionMatrixNodeType,
  DecisionSensitivityNode as DecisionSensitivityNodeType,
  ReconcileNode as ReconcileNodeType,
  XLookupNode as XLookupNodeType,
  FrameSortDir,
  DecisionDetail,
  SplitColType,
  ComputedColumnAs,
  HeadOp,
  FillDir,
  ReplaceMode,
  HeaderOp,
  BlankRowMode,
} from "../rete-nodes";
import { VALUELESS_FILTER_OPS } from "../frameVerbs";
import type { FilterOp, FilterCombine, JoinHow, AsofDirection, AggOp, DecisionNormalize, LookupMatchMode, LookupSearchMode } from "../frameVerbs";
import type { FilterCondConfig } from "../nodes/frame";
import { HEAD_OP_META, HEADER_OP_META, BLANK_ROW_OP_META } from "../nodes/frame";
import { CubeDisplay } from "./CubeDisplay";
import { parseFrameSource, frameSourceToText, type FrameSourceColumn } from "../frame";
import { processGraph, bumpConnectionVersion } from "../process";
import { getActiveArea, getOwningEditor, getOwningArea } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { collapseStore } from "../collapseStore";
import { pivotEditor } from "../pivotEditorStore";
import { InlineInputs, InlineNumberField, InlineTextField, useConnectedInputs } from "./inlineInput";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { ExtensibleInputs, pushRowAddUndo, pushRowRemovalUndo } from "./ExtensibleInputs";
import { FrameDisplay } from "./FrameDisplay";
import { FormulaField } from "./FormulaField";
import { formulaPopup } from "../formulaPopupStore";
import { ResultDisplay } from "./ResultDisplay";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { ArrayChip } from "./ArrayChip";
import { readChipPopupStyle } from "./chipStyle";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, renderTextMarkdownHtml, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { applyGetColumnReadAs, applyAddColumnAddAs, applySplitColType } from "./frameEdit";
import type { GetColumnReadAs, AddColumnAddAs } from "../rete-nodes";
import { stopDragStart } from "../coarse";
import { dropInputCables } from "./cablePrune";

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────
// Like Table Input: the single result box doubles as the editor. The chip opens
// the grid popup (editable cells + column names); Save serializes the body +
// headers back into the node's frameText.

export function FrameInputComponent({ data, emit }: NodeProps<FrameInputNodeType>) {
  // The editor edits the RAW source (what you typed); Save stores it back verbatim
  // and the node derives the typed frame in data(). So a "1" you typed in a Boolean
  // column stays "1" — the Source/Formatted toggle in the popup shows raw vs derived.
  const source = useMemo(() => parseFrameSource(data.frameText), [data.frameText]);
  const onSaveSource = useCallback((columns: FrameSourceColumn[]) => {
    data.frameText = frameSourceToText(columns);
    // The source IS this frame's static shape, so a column retyped/renamed/added here
    // can retype a downstream socket that reads it (INDEX over a named column). No
    // connection event fires on a text edit — settle the derived types by hand.
    const ed = getOwningEditor(data.id);
    const ar = getOwningArea(data.id);
    if (ed && ar) reconcileTypesAfterEdit(ed, ar);
    void processGraph();
  }, [data]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Frame">
      {/* Addable λ inputs (column-source model, slice 1): each wired λ can
          define a column — pick it per column in the grid editor. */}
      <ExtensibleInputs node={data} emit={emit} valueKeys={data.lambdaKeys} minRows={0} />
      <FrameDisplay frame={data.cachedResult} label={data.label} source={source} onSaveSource={onSaveSource} lambdaOptions={data.lambdaKeys} />
    </NodeShell>
  );
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

export function BuildFrameComponent({ data, emit }: NodeProps<BuildFrameNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────

export function DistinctComponent({ data, emit }: NodeProps<DistinctNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── HEAD ────────────────────────────────────────────────────────────────────

const HEAD_OP_OPTIONS = (Object.entries(HEAD_OP_META) as [HeadOp, { label: string; description: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function HeadComponent({ data, emit }: NodeProps<HeadNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  // The To row only exists in range mode — the other modes read Rows alone.
  const keys = op === "range" ? ["frame", "rows", "to"] : ["frame", "rows"];
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={keys} labelFor={(k) => (k === "rows" && op === "range" ? "From" : (data.inputs[k]?.label ?? k))} />
      <OpSelect value={op} onChange={setOp} options={HEAD_OP_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────

const SORT_DIR_OPTIONS: { value: FrameSortDir; label: string; title: string }[] = [
  { value: "asc", label: "Asc", title: "Ascending (A→Z, low→high); blanks last" },
  { value: "desc", label: "Desc", title: "Descending (Z→A, high→low); blanks last" },
];

export function SortFrameComponent({ data, emit }: NodeProps<SortFrameNodeType>) {
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={dir} options={SORT_DIR_OPTIONS} onChange={setDir} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── FILTER FRAME ──────────────────────────────────────────────────────────────

export const FILTER_OP_OPTIONS: { value: FilterOp; label: string }[] = [
  { value: "gt", label: "＞ greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "＜ less than" },
  { value: "lte", label: "≤ at most" },
  { value: "eq", label: "＝ equals" },
  { value: "neq", label: "≠ not equal" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "isblank", label: "is blank" },
  { value: "notblank", label: "not blank" },
];

// The Filter-node op list adds the ERROR predicates (drop / keep #DIV/0!-style
// error cells). Kept OFF the base FILTER_OP_OPTIONS so SUMIFS — whose criteria are
// a different idea — doesn't offer them; only the List/Frame Filters do.
export const FILTER_OP_OPTIONS_WITH_ERROR: { value: FilterOp; label: string }[] = [
  ...FILTER_OP_OPTIONS,
  { value: "noterror", label: "no error" },
  { value: "iserror", label: "has error" },
];

// The blank + error predicates take no comparison value — the Value field hides
// and a wired value is ignored. (Single source of truth in frameVerbs.)
export const VALUELESS_OPS: ReadonlySet<FilterOp> = VALUELESS_FILTER_OPS;

// The ops where case can matter — string eq/neq + the three text predicates.
// Numeric/date/logical comparisons ignore the flag, so the checkbox hides.
export const TEXT_MATCH_OPS: ReadonlySet<FilterOp> = new Set(["eq", "neq", "contains", "startsWith", "endsWith"]);

export const FILTER_COMBINE_OPTIONS: { value: FilterCombine; label: string; title: string }[] = [
  { value: "and", label: "AND", title: "Keep rows matching every condition" },
  { value: "or", label: "OR", title: "Keep rows matching any condition" },
];

// Extensible AND/OR condition rows (B-2). Each pair: a wireable Column row
// (with the remove ×) and a wireable Value row whose op select + Match-case
// toggle live in the row when unwired. Per-row {op, matchCase} mirrors onto
// data.condConfig (local useState drives the controlled selects — the
// useNodeField rule, per-key). The AND/OR SegToggle appears from 2 rows up.
export function FilterFrameComponent({ data, emit }: NodeProps<FilterFrameNodeType>) {
  const connected = useConnectedInputs(data.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const [combine, setCombine] = useNodeField(data, "combine");
  const [cfg, setCfg] = useState<Record<string, FilterCondConfig>>(() => ({ ...data.condConfig }));
  const strLiterals = (data.stringLiterals ??= {});
  const pairs = data.valuePairKeys();

  const rowCfg = (id: string): FilterCondConfig => cfg[id] ?? data.condConfig[id] ?? { op: "gt" };
  const updateCfg = (id: string, patch: Partial<FilterCondConfig>) => {
    const next = { ...rowCfg(id), ...patch };
    setCfg((c) => ({ ...c, [id]: next }));
    data.condConfig[id] = next;
    void processGraph();
  };
  const setStr = (key: string, v: string) => {
    strLiterals[key] = v;
    void processGraph();
  };

  async function addPair() {
    const before = new Set(Object.keys(data.inputs));
    data.addValuePair();
    const added = Object.keys(data.inputs).filter((k) => !before.has(k));
    const aKey = added[0];
    if (aKey) pushRowAddUndo(data, added, () => data.removeValuePair(aKey));
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  async function removePair(aKey: string, bKey: string) {
    await dropInputCables(data.id, [aKey, bKey]);
    pushRowRemovalUndo(data, [aKey, bKey], () => data.removeValuePair(aKey));
    data.removeValuePair(aKey);
    await getActiveArea()?.update("node", data.id);
    bumpConnectionVersion();
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      {collapsed ? (
        <CollapsedInputPill node={data} emit={emit} keys={["frame", ...pairs.flat()]} />
      ) : (
        <>
          <InlineInputs node={data} emit={emit} keys={["frame"]} />
          {pairs.length > 1 && (
            <SegToggle value={combine} options={FILTER_COMBINE_OPTIONS} onChange={setCombine} />
          )}
          {pairs.map(([colKey, valKey], i) => {
            const id = colKey.slice(6);
            const c = rowCfg(id);
            return (
              <div key={colKey} className="solenoid-node__pair-group">
                <MeasuredSocketRow side="input" socketKey={colKey} nodeId={data.id} emit={emit} payload={data.inputs[colKey]!.socket}>
                  <span className="solenoid-node__io-label">Column{pairs.length > 1 ? ` ${i + 1}` : ""}</span>
                  {connected.has(colKey) ? (
                    <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
                  ) : (
                    <InlineTextField value={strLiterals[colKey]} onChange={(v) => setStr(colKey, v)} />
                  )}
                  {pairs.length > 1 && (
                    <button
                      type="button"
                      className="solenoid-node__row-remove"
                      title="Remove this condition"
                      onClick={(e) => { e.stopPropagation(); void removePair(colKey, valKey); }}
                    >
                      ×
                    </button>
                  )}
                </MeasuredSocketRow>
                <OpSelect arg value={c.op} options={FILTER_OP_OPTIONS_WITH_ERROR} onChange={(op) => updateCfg(id, { op })} />
                {(!VALUELESS_OPS.has(c.op) || connected.has(valKey)) && (
                <MeasuredSocketRow side="input" socketKey={valKey} nodeId={data.id} emit={emit} payload={data.inputs[valKey]!.socket}>
                  <span className="solenoid-node__io-label">Value</span>
                  {connected.has(valKey) ? (
                    <span className="solenoid-node__io-wired" title={VALUELESS_OPS.has(c.op) ? "Ignored by this condition" : "Driven by an incoming cable"}>↩ wired</span>
                  ) : (
                    <InlineTextField value={strLiterals[valKey]} onChange={(v) => setStr(valKey, v)} />
                  )}
                  {TEXT_MATCH_OPS.has(c.op) && (
                    <button
                      type="button"
                      title="Match case. Off matches text like Excel's = does."
                      aria-pressed={c.matchCase ?? false}
                      onClick={(e) => { e.stopPropagation(); updateCfg(id, { matchCase: !c.matchCase }); }}
                      onPointerDown={stopDragStart}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        flexShrink: 0, fontSize: 11, lineHeight: 1, padding: "3px 5px",
                        border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
                        background: c.matchCase ? "var(--accent)" : "transparent",
                        color: c.matchCase ? "var(--surface)" : "var(--text-muted)",
                      }}
                    >
                      Aa
                    </button>
                  )}
                </MeasuredSocketRow>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="solenoid-node__add-input"
            onClick={(e) => { e.stopPropagation(); void addPair(); }}
          >
            + Add condition
          </button>
        </>
      )}
      <MeasuredSocketRow side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={data.outputs.frame!.socket} hero>
        <FrameDisplay frame={data.cachedResult} label={data.label} />
      </MeasuredSocketRow>
      {/* The complement stays a LAZY ref — no preview here, just its socket
          (materializing it for a chip would collect a frame nobody asked for). */}
      <MeasuredSocketRow side="output" socketKey="dropped" nodeId={data.id} emit={emit} payload={data.outputs.dropped!.socket}>
        <span className="solenoid-node__io-label">Dropped</span>
      </MeasuredSocketRow>
    </NodeShell>
  );
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────

const JOIN_HOW_OPTIONS: { value: JoinHow; label: string; title: string }[] = [
  { value: "inner", label: "Inner", title: "Only rows that match in both" },
  { value: "left", label: "Left", title: "All left rows; unmatched right side is blank" },
  { value: "right", label: "Right", title: "All right rows; unmatched left side is blank" },
  { value: "outer", label: "Outer", title: "All rows from both sides" },
  { value: "semi", label: "Semi", title: "Left rows whose key matches in right — left columns only" },
  { value: "anti", label: "Anti", title: "Left rows with no match in right — left columns only" },
  { value: "asof", label: "As-of", title: "Nearest match on a sorted number/date key; no exact match required" },
];

const ASOF_DIRECTION_OPTIONS: { value: AsofDirection; label: string; title: string }[] = [
  { value: "backward", label: "≤", title: "Latest right key at or before the left key" },
  { value: "forward", label: "≥", title: "Earliest right key at or after the left key" },
  { value: "nearest", label: "≈", title: "Whichever right key is closest" },
];

export function JoinComponent({ data, emit }: NodeProps<JoinNodeType>) {
  const [how, setHow] = useNodeField(data, "how");
  const [asofDirection, setAsofDirection] = useNodeField(data, "asofDirection");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={how} options={JOIN_HOW_OPTIONS} onChange={setHow} />
      {how === "asof" && <SegToggle value={asofDirection} options={ASOF_DIRECTION_OPTIONS} onChange={setAsofDirection} />}
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── SELECT / DROP COLUMNS ───────────────────────────────────────────────────

export function SelectColumnsComponent({ data, emit }: NodeProps<SelectColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function DropColumnsComponent({ data, emit }: NodeProps<DropColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── GROUP BY / PIVOT (shared aggregate-op selector) ─────────────────────────

export const AGG_OP_OPTIONS: { value: AggOp; label: string }[] = [
  { value: "sum", label: "SUM" },
  { value: "avg", label: "AVERAGE" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
  { value: "count", label: "COUNT" },
  { value: "product", label: "PRODUCT" },
  { value: "median", label: "MEDIAN" },
  { value: "mode", label: "MODE" },
  { value: "stdev", label: "STDEV.S" },
  { value: "stdevp", label: "STDEV.P" },
  { value: "var", label: "VAR.S" },
  { value: "varp", label: "VAR.P" },
];

// Same depth encoding as the Pivot editor's totals selector (PivotSpec's
// rowTotalDepth): 0/1/2, negative ⇒ totals placed at the top.
const GROUP_TOTAL_OPTIONS = [
  { value: "0", label: "No totals" }, { value: "1", label: "Grand total" }, { value: "2", label: "Grand + subtotals" },
  { value: "-1", label: "Grand at start" }, { value: "-2", label: "Grand + sub at start" },
];

export function GroupByFrameComponent({ data, emit }: NodeProps<GroupByFrameNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [totalDepth, setTotalDepth] = useNodeField(data, "totalDepth");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} options={AGG_OP_OPTIONS} onChange={setOp} />
      <OpSelect arg value={String(totalDepth)} options={GROUP_TOTAL_OPTIONS} onChange={(v) => setTotalDepth(Number(v))} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── PIVOT (full Excel PIVOTBY) ────────────────────────────────────────────────
// The node face is compact: the wireable sockets, a one-line summary of the current
// pivot, and a "Configure fields" button that opens the Excel-style 2×2 field editor
// (PivotEditorPopup). All of Rows/Columns/Values/functions/totals/sort/% live there.

const PIVOT_CABLE_ONLY = new Set(["rowFields", "colFields", "values", "filter"]);
const splitNames = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function pivotSummary(data: PivotNodeType): string {
  const rows = splitNames(data.stringLiterals?.rowFields);
  const cols = splitNames(data.stringLiterals?.colFields);
  const vals = splitNames(data.stringLiterals?.values);
  if (!rows.length && !cols.length && !vals.length) return "Not configured";
  const parts: string[] = [];
  if (rows.length) parts.push(`Rows: ${rows.join(", ")}`);
  if (cols.length) parts.push(`Cols: ${cols.join(", ")}`);
  if (vals.length) parts.push(`Σ ${vals.map((v) => `${v} (${(data.funcs?.[v] ?? data.op).toUpperCase()})`).join(", ")}`);
  return parts.join(" · ");
}

export function PivotComponent({ data, emit }: NodeProps<PivotNodeType>) {
  // Read the node's category accent (Frame violet) off the live DOM so the popup
  // header tints to match the node it opened from — same trick FrameChip uses.
  const openEditor = (e: MouseEvent<HTMLButtonElement>) => {
    const { accent } = readChipPopupStyle(e.currentTarget);
    pivotEditor.open({ node: data, nodeId: data.id, title: data.label || "Pivot", accent });
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["frame", "rowFields", "colFields", "values", "filter"]} cableOnlyKeys={PIVOT_CABLE_ONLY} />
      <button
        type="button"
        className="solenoid-node__pivot-config"
        onClick={openEditor}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        Configure fields…
      </button>
      <div className="solenoid-node__pivot-summary" title={pivotSummary(data)}>{pivotSummary(data)}</div>
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function UnpivotComponent({ data, emit }: NodeProps<UnpivotNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── NEST / UNNEST (frame ⟷ cube) ────────────────────────────────────────────

export function NestComponent({ data, emit }: NodeProps<NestNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function UnnestComponent({ data, emit }: NodeProps<UnnestNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── APPEND / RENAME ─────────────────────────────────────────────────────────

export function AppendComponent({ data, emit }: NodeProps<AppendNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function RenameComponent({ data, emit }: NodeProps<RenameNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function SplitColumnComponent({ data, emit }: NodeProps<SplitColumnNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function AddIndexComponent({ data, emit }: NodeProps<AddIndexNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <MeasuredSocketRow side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={data.outputs.frame!.socket}>
        <span className="solenoid-node__io-label">Frame</span>
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="grid" nodeId={data.id} emit={emit} payload={data.outputs.grid!.socket}>
        <span className="solenoid-node__io-label" title="The data indexed on BOTH axes: a coordinate-bordered matrix (row 0 = column indices, column 0 = row indices) — the grid Surface, Contour, and Grid Interpolate read.">Bordered grid</span>
      </MeasuredSocketRow>
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── TIMESAVER CLEANUP VERBS ─────────────────────────────────────────────────────

const FILL_DIR_OPTIONS: { value: FillDir; label: string; title: string }[] = [
  { value: "down", label: "Down", title: "Carry the last present value forward over blanks" },
  { value: "up", label: "Up", title: "Carry the next present value backward over blanks" },
];

export function FillBlanksComponent({ data, emit }: NodeProps<FillBlanksNodeType>) {
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={dir} options={FILL_DIR_OPTIONS} onChange={setDir} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

const REPLACE_MODE_OPTIONS: { value: ReplaceMode; label: string; title: string }[] = [
  { value: "cell", label: "Whole cell", title: "Replace cells whose whole value equals Find (numbers match numerically)" },
  { value: "substring", label: "Substring", title: "Rewrite occurrences of Find inside text cells" },
];

export function ReplaceValuesComponent({ data, emit }: NodeProps<ReplaceValuesNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={mode} options={REPLACE_MODE_OPTIONS} onChange={setMode} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function MergeColumnsComponent({ data, emit }: NodeProps<MergeColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

const HEADER_OP_OPTIONS = (Object.entries(HEADER_OP_META) as [HeaderOp, { label: string; description: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function HeadersComponent({ data, emit }: NodeProps<HeadersNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={HEADER_OP_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

const BLANK_ROW_OPTIONS = (Object.entries(BLANK_ROW_OP_META) as [BlankRowMode, { label: string; description: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function DropBlankRowsComponent({ data, emit }: NodeProps<DropBlankRowsNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={op} onChange={setOp} options={BLANK_ROW_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

const DECISION_NORMALIZE_OPTIONS: { value: DecisionNormalize; label: string; title: string }[] = [
  { value: "none", label: "Raw", title: "Score with the criteria values as-is" },
  { value: "max", label: "÷ Max", title: "Scale each criterion by its largest magnitude (≈ [-1, 1]) so different ranges compare" },
  { value: "rank", label: "Rank", title: "Replace each criterion's values with their within-column rank, so incompatible scales like $ vs out-of-10 compare" },
];

const DECISION_DETAIL_OPTIONS: { value: DecisionDetail; label: string; title: string }[] = [
  { value: "summary", label: "Summary", title: "Output just Option · Score · Rank" },
  { value: "breakdown", label: "Breakdown", title: "Also show each criterion's effective post-normalize value per option: the contributions behind the score" },
];

// Per-criterion normalize override. "" = inherit the node's default mode (the global
// SegToggle); the rest are the DMBV per-column "Rank Raws" / Normalize, set per column.
const DECISION_PERCOL_OPTIONS: { value: "" | DecisionNormalize; label: string; title: string }[] = [
  { value: "", label: "—", title: "Use the node's default normalize mode, set above" },
  { value: "none", label: "Raw", title: "This column: score the raw values as-is" },
  { value: "max", label: "÷Max", title: "This column: scale by its largest magnitude → [0,1]" },
  { value: "rank", label: "Rank", title: "This column: within-column rank → [0,1] (DMBV Rank Raws); suits $-scale columns" },
];

const DECISION_CABLE_ONLY = new Set(["weights"]);

// One row per detected criterion: a labeled, default-1 weight box plus a per-column
// normalize override (Rank Raws lives here). Criteria come from the upstream Scores
// frame (data.criteria, refreshed each compute), so the rows are named, not blind
// positional slots. A wired `weights` cable overrides the weights (computed weights),
// and we say so — the per-column modes still apply.
export function DecisionMatrixComponent({ data, emit }: NodeProps<DecisionMatrixNodeType>) {
  const [normalize, setNormalize] = useNodeField(data, "normalize");
  const [detail, setDetail] = useNodeField(data, "detail");
  const connected = useConnectedInputs(data.id);
  const wired = connected.has("weights");
  const criteria = data.criteria;

  const setWeight = (name: string, v: number | undefined) => {
    if (v === undefined) delete data.weightMap[name];
    else data.weightMap[name] = v;
    void processGraph(data.id);
  };

  const setNorm = (name: string, mode: "" | DecisionNormalize) => {
    if (mode === "") delete data.normMap[name];
    else data.normMap[name] = mode;
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} cableOnlyKeys={DECISION_CABLE_ONLY} />
      {/* Global normalize is the DEFAULT each criterion inherits; the per-row "Norm"
          column below overrides it ("—" = use this default). Caption + shared wording
          ("Normalize") make that relationship explicit. */}
      <div className="solenoid-node__dm-caption">Default normalize for every criterion; override per row below:</div>
      <SegToggle value={normalize} options={DECISION_NORMALIZE_OPTIONS} onChange={setNormalize} />
      <div className="solenoid-node__dm-weights">
        {criteria.length === 0 ? (
          <div className="solenoid-node__dm-hint">Wire a Scores frame; a row appears per criterion.</div>
        ) : (
          <>
            <div className="solenoid-node__dm-weight-row solenoid-node__dm-weights-head">
              <span className="solenoid-node__dm-col-crit">Criterion</span>
              {!wired && <span className="solenoid-node__dm-col-weight">Weight</span>}
              <span className="solenoid-node__dm-col-norm" title={'Per-criterion normalize override; "—" uses the default above'}>Norm</span>
            </div>
            {wired && <div className="solenoid-node__dm-hint">Weights from the wired list; per-column Norm still applies.</div>}
            {criteria.map((name) => (
              <div className="solenoid-node__dm-weight-row" key={name}>
                <span className="solenoid-node__io-label solenoid-node__dm-col-crit" title={`“${name}”: weight and per-column normalize. A negative weight means lower is better.`}>{name}</span>
                {!wired && <InlineNumberField value={data.weightMap[name] ?? 1} onChange={(v) => setWeight(name, v)} />}
                <OpSelect arg value={data.normMap[name] ?? ""} options={DECISION_PERCOL_OPTIONS} onChange={(m) => setNorm(name, m)} />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="solenoid-node__dm-caption">Output:</div>
      <SegToggle value={detail} options={DECISION_DETAIL_OPTIONS} onChange={setDetail} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────
// Scores × weight-scenarios → a Cube of rankings (one nested Option·Score·Rank table
// per scenario). Both inputs are frames (cable-only rows); `normalize` is the same
// default-mode toggle as the Decision Matrix.

export function DecisionSensitivityComponent({ data, emit }: NodeProps<DecisionSensitivityNodeType>) {
  const [normalize, setNormalize] = useNodeField(data, "normalize");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__dm-caption">Normalize (every criterion):</div>
      <SegToggle value={normalize} options={DECISION_NORMALIZE_OPTIONS} onChange={setNormalize} />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── RECONCILE ───────────────────────────────────────────────────────────────
// Two frame outputs would be one too many dots to auto-place, so — like Split
// Frame — this hand-places both rows: the reconciliation Frame, then the
// readable Summary line (added/removed/changed/unchanged, + PVM if applicable).

export function ReconcileComponent({ data, emit }: NodeProps<ReconcileNodeType>) {
  const frameOut = data.outputs.frame;
  const summaryOut = data.outputs.summary;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["left", "right", "key", "priceColumn", "qtyColumn"]} />
      {frameOut && (
        <MeasuredSocketRow hero side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frameOut.socket}>
          <div style={{ width: "100%" }}>
            <FrameDisplay frame={data.cachedResult} label={data.label} />
          </div>
        </MeasuredSocketRow>
      )}
      {summaryOut && (
        <MeasuredSocketRow hero side="output" socketKey="summary" nodeId={data.id} emit={emit} payload={summaryOut.socket}>
          {/* The summary is markdown (bold counts + a Δ paragraph) — render it here
              in its own hero box; the raw markdown flows out the socket for a
              Display + markdown FC downstream. */}
          {data.cachedSummary ? (
            <div
              className="solenoid-node__display-value solenoid-node__md"
              style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 11.5, textAlign: "left", color: "var(--text)" }}
              dangerouslySetInnerHTML={{ __html: renderTextMarkdownHtml(data.cachedSummary) }}
            />
          ) : (
            <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
          )}
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

// ─── SPLIT FRAME ───────────────────────────────────────────────────────────────
// Two outputs (Matrix + Headers), each a labeled row with its socket and a chip.

const SPLIT_COLTYPE_OPTIONS: { value: SplitColType; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Keep every column" },
  { value: "number", label: "Num", title: "Keep only number columns" },
  { value: "date", label: "Date", title: "Keep only date columns; the Matrix carries serials" },
  { value: "logical", label: "Bool", title: "Keep only logical columns; the Matrix carries 1/0" },
  { value: "string", label: "Text", title: "Keep only text columns. Headers only, since text has no numeric Matrix." },
];

export function SplitFrameComponent({ data, emit }: NodeProps<SplitFrameNodeType>) {
  // Local mirror so the toggle re-renders; the change handler swaps the Matrix
  // output socket type (see applySplitColType) — like Get Column's read-as.
  const [colType, setColType] = useState<SplitColType>(data.colType);
  useEffect(() => { setColType(data.colType); }, [data.colType]);
  const matrix = data.cachedMatrix;
  const headers = data.cachedHeaders;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={colType} options={SPLIT_COLTYPE_OPTIONS} onChange={(next) => { setColType(next); void applySplitColType(data, next); }} />
      <MeasuredSocketRow side="output" socketKey="matrix" nodeId={data.id} emit={emit} payload={data.outputs.matrix!.socket}>
        <span className="solenoid-node__io-label">Matrix</span>
        <span className="solenoid-node__output-value" style={{ display: "flex", justifyContent: "flex-end" }}>
          {matrix && matrix.length
            ? <ArrayChip value={matrix} label={`${data.label}: Matrix`} size="sm" elem={nodeOutputElemFamily(data.id, "matrix")} />
            : data.cachedMixed
              ? <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }} title="A frame with text columns has no numeric matrix. Pull a column with Get Column.">mixed; use Get Column</span>
              : "—"}
        </span>
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="headers" nodeId={data.id} emit={emit} payload={data.outputs.headers!.socket}>
        <span className="solenoid-node__io-label">Headers</span>
        <span className="solenoid-node__output-value" style={{ display: "flex", justifyContent: "flex-end" }}>
          {headers && headers.length ? <ArrayChip value={headers} label={`${data.label}: Headers`} size="sm" elem={nodeOutputElemFamily(data.id, "headers")} /> : "—"}
        </span>
      </MeasuredSocketRow>
    </NodeShell>
  );
}

// ─── GET COLUMN ────────────────────────────────────────────────────────────────

const GET_COLUMN_READ_OPTIONS: { value: GetColumnReadAs; label: string; title: string }[] = [
  { value: "number", label: "Number", title: "Read the column as numbers" },
  { value: "text", label: "Text", title: "Read the column as text" },
  { value: "date", label: "Date", title: "Read the column as dates, stored as Excel serials" },
  { value: "logical", label: "Boolean", title: "Read the column as logicals (TRUE/FALSE); a 0/1 or true/false column coerces" },
];

export function GetColumnComponent({ data, emit }: NodeProps<GetColumnNodeType>) {
  // Local mirror of readAs so the control re-renders on change; the change handler
  // swaps the output socket type (see applyGetColumnReadAs).
  const [readAs, setReadAs] = useState<GetColumnReadAs>(data.readAs);
  useEffect(() => { setReadAs(data.readAs); }, [data.readAs]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle
        value={readAs}
        options={GET_COLUMN_READ_OPTIONS}
        onChange={(next) => { setReadAs(next); void applyGetColumnReadAs(data, next); }}
      />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

// ─── ADD COLUMN ────────────────────────────────────────────────────────────────

const ADD_COLUMN_OPTIONS: { value: AddColumnAddAs; label: string; title: string }[] = [
  { value: "number", label: "Number", title: "Add a numeric column" },
  { value: "text", label: "Text", title: "Add a text column" },
  { value: "date", label: "Date", title: "Add a date column of Excel serials" },
  { value: "logical", label: "Boolean", title: "Add a logical column (TRUE/FALSE); a 0/1 list coerces" },
];

export function AddColumnComponent({ data, emit }: NodeProps<AddColumnNodeType>) {
  // Local mirror of addAs; the change handler swaps the Values input socket type
  // (see applyAddColumnAddAs).
  const [addAs, setAddAs] = useState<AddColumnAddAs>(data.addAs);
  useEffect(() => { setAddAs(data.addAs); }, [data.addAs]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle
        value={addAs}
        options={ADD_COLUMN_OPTIONS}
        onChange={(next) => { setAddAs(next); void applyAddColumnAddAs(data, next); }}
      />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── COMPUTED COLUMN ───────────────────────────────────────────────────────────

const COMPUTED_AS_OPTIONS: { value: ComputedColumnAs; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "logical", label: "Boolean" },
];

export function ComputedColumnComponent({ data, emit }: NodeProps<ComputedColumnNodeType>) {
  const [expr, setExpr] = useState(data.expr);
  useEffect(() => { setExpr(data.expr); }, [data.expr]);
  const commit = useCallback(async (next: string) => {
    setExpr(next);
    data.expr = next;
    await processGraph(data.id);
  }, [data]);
  // The output type: Auto infers from the computed cells; Date is the case
  // inference can't reach (a serial is indistinguishable from a number).
  const [addAs, setAddAs] = useNodeField(data, "addAs");
  const [, bumpBindings] = useState(0);
  const bind = useCallback((v: string, col: string) => {
    if (col) data.bindings[v] = col; else delete data.bindings[v];
    bumpBindings((x) => x + 1);
    void processGraph(data.id);
  }, [data]);
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      {/* Variables are column names, `row`, or side inputs the node grows; a
          wired λ takes over and the field goes quiet. Editing routes to the
          shared formula popup like Expression. */}
      <FormulaField
        value={expr}
        onChange={commit}
        placeholder="price * qty …"
        locked={false}
        onOpen={() => formulaPopup.open(data.id)}
      />
      <OpSelect arg value={addAs} onChange={setAddAs} options={COMPUTED_AS_OPTIONS} />
      {/* Binding pickers — one quiet row per variable/param, shown once a
          frame is wired. Auto = the by-name ladder (column, else `row`/`rows`,
          else a grown side input); a picked column ALWAYS reads that column,
          so a variable can reach "Unit Price" or a column its own name
          doesn't match. */}
      {data.defVars.length > 0 && data.sourceColumns.length > 0 && data.defVars.map((v) => (
        <div key={v} className="solenoid-node__field-row" title={`Where ${v} reads from`}>
          <span className="solenoid-node__field-label">{v}</span>
          <OpSelect
            arg
            value={data.bindings[v] ?? ""}
            onChange={(next) => bind(v, next)}
            options={[{ value: "", label: "auto" }, ...data.sourceColumns.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      ))}
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export function GetRowComponent({ data, emit }: NodeProps<GetRowNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── XLOOKUP (table / cube / widened list) ──────────────────────────────────────

const LOOKUP_MATCH_OPTIONS: { value: LookupMatchMode; label: string; title: string }[] = [
  { value: "exact", label: "Exact", title: "Only an equal cell matches" },
  { value: "nextSmaller", label: "≤", title: "Exact match, else the closest smaller number/date" },
  { value: "nextLarger", label: "≥", title: "Exact match, else the closest larger number/date" },
];

const LOOKUP_SEARCH_OPTIONS: { value: LookupSearchMode; label: string; title: string }[] = [
  { value: "first", label: "First", title: "On duplicate keys, return the first match, scanning top to bottom" },
  { value: "last", label: "Last", title: "On duplicate keys, return the last match, scanning bottom to top" },
];

export function XLookupComponent({ data, emit }: NodeProps<XLookupNodeType>) {
  const [matchMode, setMatchMode] = useNodeField(data, "matchMode");
  const [searchMode, setSearchMode] = useNodeField(data, "searchMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={matchMode} options={LOOKUP_MATCH_OPTIONS} onChange={setMatchMode} />
      <SegToggle value={searchMode} options={LOOKUP_SEARCH_OPTIONS} onChange={setSearchMode} />
      {/* Return = * gives a whole row; a cube lookup can return a nested frame/cube
          cell — ResultDisplay routes Frame → FrameDisplay, Cube → CubeDisplay, else
          ValueDisplay (scalar). */}
      <ResultDisplay value={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
