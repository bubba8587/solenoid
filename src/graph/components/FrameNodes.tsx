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
  ColumnsNode as ColumnsNodeType,
  GroupByFrameNode as GroupByFrameNodeType,
  PivotNode as PivotNodeType,
  UnpivotNode as UnpivotNodeType,
  NestNode as NestNodeType,
  UnnestNode as UnnestNodeType,
  AppendNode as AppendNodeType, BindColumnsNode as BindColumnsNodeType,
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
  AllocatorNode as AllocatorNodeType,
  ReconcileNode as ReconcileNodeType,
  XLookupNode as XLookupNodeType,
  FrameSortDir,
  DecisionDetail,
  SplitColType,
  ComputedColumnAs,
  HeadOp,
  ColumnsOp,
  FillDir,
  ReplaceMode,
  HeaderOp,
  BlankRowMode,
} from "../rete-nodes";
import { AGG_OP_META, CORR_METHOD_META, WINDOW_FN_META } from "../rete-nodes";
import type { DescribeNode as DescribeNodeType, CorrMatrixNode as CorrMatrixNodeType, KMeansNode as KMeansNodeType, PcaNode as PcaNodeType, LogisticNode as LogisticNodeType, CorrMethod, WindowNode as WindowNodeType, WindowFn } from "../rete-nodes";
import { VALUELESS_FILTER_OPS } from "../frameVerbs";
import type { FilterOp, FilterCombine, JoinHow, AsofDirection, AggOp, DecisionNormalize, LookupMatchMode, LookupSearchMode } from "../frameVerbs";
import type { FilterCondConfig } from "../nodes/frame";
import { RecordLayoutField } from "./RecordLayoutField";
import { HEAD_OP_META, HEADER_OP_META, BLANK_ROW_OP_META, COLUMNS_OP_META } from "../nodes/frame";
import { CubeDisplay } from "./CubeDisplay";
import { isCubeValue } from "../frame";
import { parseFrameSource, frameSourceToText, isFrameValue, frameRowCount, type FrameSourceColumn } from "../frame";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { scheduleAutosave } from "../persistence";
import { getActiveView, getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { collapseStore } from "../collapseStore";
import { pivotEditor } from "../pivotEditorStore";
import { InlineInputs, InlineNumberField, InlineTextField, useConnectedInputs } from "./inlineInput";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { FrameDisplay } from "./FrameDisplay";
import { FormulaField } from "./FormulaField";
import { formulaPopup } from "../formulaPopupStore";
import { ResultDisplay } from "./ResultDisplay";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { ArrayChip } from "./ArrayChip";
import { readChipPopupStyle } from "./chipStyle";
import { NodeShell, ValueDisplay, OpSelect, ArgSelect, useNodeField, renderTextMarkdownHtml, type NodeProps, type OpOption } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { applyGetColumnReadAs, applyAddColumnAddAs, applySplitColType } from "./frameEdit";
import type { GetColumnReadAs, AddColumnAddAs } from "../rete-nodes";
import { stopDragStart } from "../coarse";
import { dropInputCables } from "./cablePrune";
import { nodeDisplayName } from "../catalogUtils";
import { ALLOCATE_MODE_META } from "../rete-nodes";
import type { AllocateMode } from "../nodes/allocateOps";

const ALLOCATE_MODE_OPTIONS: OpOption<AllocateMode>[] =
  (Object.entries(ALLOCATE_MODE_META) as [AllocateMode, { label: string }][]).map(([value, m]) => ({ value, label: m.label }));
const BUDGET_CABLE_ONLY_PROP = new Set(["amount"]);

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────
// Like Table Input: the single result box doubles as the editor, and Save serializes
// the popup's body + headers back into the node's frameText.

export function FrameInputComponent({ data, emit }: NodeProps<FrameInputNodeType>) {
  // The RAW source is stored verbatim and the typed frame derived in data(), so a "1"
  // typed into a Boolean column stays "1" (tableInputRawText).
  const source = useMemo(() => parseFrameSource(data.frameText), [data.frameText]);
  const onSaveSource = useCallback((columns: FrameSourceColumn[]) => {
    data.frameText = frameSourceToText(columns);
    // A text edit fires no connection event, so settle the derived downstream types by
    // hand — a retyped/renamed column can retype a socket that reads it.
    const ed = getOwningEditor(data.id);
    const ar = getOwningView(data.id);
    if (ed && ar) reconcileTypesAfterEdit(ed, ar);
    void processGraph();
  }, [data]);
  // LIVE write-through: an in-popup edit commits and recomputes NOW, handing the open
  // popup fresh derived cells + types with no Save/close round trip.
  const onCommitSource = useCallback(async (columns: FrameSourceColumn[]) => {
    data.frameText = frameSourceToText(columns);
    const ed = getOwningEditor(data.id);
    const ar = getOwningView(data.id);
    if (ed && ar) reconcileTypesAfterEdit(ed, ar);
    await processGraph(data.id);
    const derived = data.cachedResult;
    if (!isFrameValue(derived)) return null;
    const src = parseFrameSource(data.frameText);
    const rows = frameRowCount(derived);
    return {
      computedCells: Array.from({ length: rows }, (_, r) =>
        src.map((c, j) => ((c.lambda || c.expr) ? (derived.columns[j]?.values[r] ?? null) : null))),
      columnTypes: src.map((c, j) => ((c.lambda || c.expr) ? (derived.columns[j]?.type ?? "number") : c.type)),
    };
  }, [data]);
  // The popup Form view's layout, authored HERE exactly like the Record card;
  // an emptied layout deletes the key so the form falls back to stacked.
  function commitLayout(next: string) {
    if (next.trim()) data.stringLiterals.layout = next;
    else delete data.stringLiterals.layout;
    scheduleAutosave();
  }
  // The Form-view layout is opt-in: an unauthored one stays hidden behind a button so the
  // card isn't carrying an empty textarea most Frame Inputs never fill.
  const [showLayout, setShowLayout] = useState(false);

  return (
    <NodeShell node={data} emit={emit}>
      {/* Addable λ inputs (column-source model, slice 1): each wired λ can
          define a column — pick it per column in the grid editor. */}
      <ExtensibleInputs node={data} emit={emit} valueKeys={data.lambdaKeys} minRows={0} addLabel="+ Add lambda" />
      {data.stringLiterals.layout || showLayout ? (
        <RecordLayoutField value={data.stringLiterals.layout ?? ""} onCommit={commitLayout} />
      ) : (
        <button
          type="button"
          className="solenoid-node__add-input"
          onClick={(e) => { e.stopPropagation(); setShowLayout(true); }}
        >
          + Add Form layout
        </button>
      )}
      <FrameDisplay
        frame={data.cachedResult} label={nodeDisplayName(data)} source={source}
        onSaveSource={onSaveSource} onCommitSource={onCommitSource} lambdaOptions={data.lambdaKeys}
        formLayout={data.stringLiterals.layout}
      />
    </NodeShell>
  );
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

export function BuildFrameComponent({ data, emit }: NodeProps<BuildFrameNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────

export function DistinctComponent({ data, emit }: NodeProps<DistinctNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────

const SORT_DIR_OPTIONS: { value: FrameSortDir; label: string; title: string }[] = [
  { value: "asc", label: "Asc", title: "Ascending (A→Z, low→high). Blanks last." },
  { value: "desc", label: "Desc", title: "Descending (Z→A, high→low). Blanks last." },
];

export function SortFrameComponent({ data, emit }: NodeProps<SortFrameNodeType>) {
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={dir} options={SORT_DIR_OPTIONS} onChange={setDir} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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

// The ERROR predicates stay OFF the base FILTER_OP_OPTIONS so SUMIFS doesn't offer
// them; only the List/Frame Filters do.
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

// Paired Column/Value rows; per-row {op, matchCase} mirrors onto data.condConfig, with
// local useState driving the controlled selects (the useNodeField rule, per-key).
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
    data.addValuePair();
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  async function removePair(aKey: string, bKey: string) {
    await dropInputCables(data.id, [aKey, bKey]);
    data.removeValuePair(aKey);
    await getActiveView()?.rerenderNode(data.id);
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
                <ArgSelect value={c.op} options={FILTER_OP_OPTIONS_WITH_ERROR} onChange={(op) => updateCfg(id, { op })} />
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
        <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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

const JOIN_HOW_OPTIONS: OpOption<JoinHow>[] = [
  { value: "inner", label: "Inner", title: "Only rows that match in both" },
  { value: "left", label: "Left", title: "All left rows. Unmatched right side is blank." },
  { value: "right", label: "Right", title: "All right rows. Unmatched left side is blank." },
  { value: "outer", label: "Outer", title: "All rows from both sides" },
  { value: "semi", label: "Semi", title: "Left rows whose key matches in right — left columns only" },
  { value: "anti", label: "Anti", title: "Left rows with no match in right — left columns only" },
  { value: "asof", label: "As-of", title: "Nearest match on a sorted number or date key. No exact match required." },
  { value: "cross", label: "Cross", title: "Every left row paired with every right row — all columns, no keys" },
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
      <ArgSelect value={how} options={JOIN_HOW_OPTIONS} onChange={setHow} />
      {how === "asof" && <SegToggle value={asofDirection} options={ASOF_DIRECTION_OPTIONS} onChange={setAsofDirection} />}
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── COLUMNS (KEEP / DROP) ───────────────────────────────────────────────────

const COLUMNS_OP_OPTIONS = (Object.entries(COLUMNS_OP_META) as [ColumnsOp, { label: string; description: string; fx: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function ColumnsComponent({ data, emit }: NodeProps<ColumnsNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} labelFor={(k) => (k === "columns" ? COLUMNS_OP_META[op].label : (data.inputs[k]?.label ?? k))} />
      <OpSelect value={op} onChange={setOp} options={COLUMNS_OP_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── GROUP BY / PIVOT (shared aggregate-op selector) ─────────────────────────

// Derived from AGG_OP_META (declareOnce); `pivotOnly` ops stay off these cards because only
// the pivot assembly can run them.
export const AGG_OP_OPTIONS: { value: AggOp; label: string }[] =
  (Object.keys(AGG_OP_META) as AggOp[])
    .filter((op) => !AGG_OP_META[op].pivotOnly)
    .map((value) => ({ value, label: AGG_OP_META[value].label }));

// Same depth encoding as the Pivot editor's totals selector (PivotSpec's
// rowTotalDepth): 0/1/2, negative ⇒ totals placed at the top.
const GROUP_TOTAL_OPTIONS = [
  { value: "0", label: "No totals" }, { value: "1", label: "Grand total" }, { value: "2", label: "Grand + subtotals" },
  { value: "-1", label: "Grand at start" }, { value: "-2", label: "Grand + sub at start" },
];

export function GroupByFrameComponent({ data, emit }: NodeProps<GroupByFrameNodeType>) {
  const [agg, setAgg] = useNodeField(data, "agg");
  const [totalDepth, setTotalDepth] = useNodeField(data, "totalDepth");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={agg} options={AGG_OP_OPTIONS} onChange={setAgg} />
      <ArgSelect value={String(totalDepth)} options={GROUP_TOTAL_OPTIONS} onChange={(v) => setTotalDepth(Number(v))} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── PIVOT (full Excel PIVOTBY) ────────────────────────────────────────────────
// The card keeps only the sockets and a summary line — all of Rows/Columns/Values/
// functions/totals/sort/% live in PivotEditorPopup.

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
  if (vals.length) parts.push(`Σ ${vals.map((v) => `${v} (${(data.funcs?.[v] ?? data.agg).toUpperCase()})`).join(", ")}`);
  return parts.join(" · ");
}

export function PivotComponent({ data, emit }: NodeProps<PivotNodeType>) {
  // Read the node's category accent (Frame violet) off the live DOM so the popup
  // header tints to match the node it opened from — same trick FrameChip uses.
  const openEditor = (e: MouseEvent<HTMLButtonElement>) => {
    const { accent } = readChipPopupStyle(e.currentTarget);
    pivotEditor.open({ node: data, nodeId: data.id, title: nodeDisplayName(data), accent });
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
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function UnpivotComponent({ data, emit }: NodeProps<UnpivotNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── NEST / UNNEST (frame ⟷ cube) ────────────────────────────────────────────

export function NestComponent({ data, emit }: NodeProps<NestNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <CubeDisplay cube={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function UnnestComponent({ data, emit }: NodeProps<UnnestNodeType>) {
  const result = data.cachedResult;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      {/* Peeling a deeper cube yields a Cube; flattening the last level yields a Frame. */}
      {isCubeValue(result)
        ? <CubeDisplay cube={result} label={nodeDisplayName(data)} />
        : <FrameDisplay frame={result} label={nodeDisplayName(data)} />}
    </NodeShell>
  );
}

// ─── APPEND / RENAME ─────────────────────────────────────────────────────────

export function AppendComponent({ data, emit }: NodeProps<AppendNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function BindColumnsComponent({ data, emit }: NodeProps<BindColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function RenameComponent({ data, emit }: NodeProps<RenameNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function SplitColumnComponent({ data, emit }: NodeProps<SplitColumnNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function AddIndexComponent({ data, emit }: NodeProps<AddIndexNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function MergeColumnsComponent({ data, emit }: NodeProps<MergeColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

const HEADER_OP_OPTIONS = (Object.entries(HEADER_OP_META) as [HeaderOp, { label: string; description: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function HeadersComponent({ data, emit }: NodeProps<HeadersNodeType>) {
  const [action, setAction] = useNodeField(data, "action");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={action} onChange={setAction} options={HEADER_OP_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

const BLANK_ROW_OPTIONS = (Object.entries(BLANK_ROW_OP_META) as [BlankRowMode, { label: string; description: string }][])
  .map(([value, m]) => ({ value, label: m.label, title: m.description }));

export function DropBlankRowsComponent({ data, emit }: NodeProps<DropBlankRowsNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={mode} onChange={setMode} options={BLANK_ROW_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

const DECISION_NORMALIZE_OPTIONS: { value: DecisionNormalize; label: string; title: string }[] = [
  { value: "none", label: "Raw", title: "Use the numbers as they are. Right when every column shares one scale, like all out of 10." },
  { value: "max", label: "÷ Max", title: "Divide each column by its biggest value so each tops out at 1. Puts dollars and out-of-10 scores on the same footing." },
  { value: "rank", label: "Rank", title: "Keep only each column's order, worst 0 to best 1. An extreme value counts no more than its place in line." },
];

const DECISION_DETAIL_OPTIONS: { value: DecisionDetail; label: string; title: string }[] = [
  { value: "summary", label: "Summary", title: "Output just Option · Score · Rank" },
  { value: "breakdown", label: "Breakdown", title: "Add a signed column per criterion: its weighted contribution. The contributions sum to the Score." },
];

// Per-criterion normalize override. "" = inherit the node's default mode (the
// global SegToggle); the rest force this one column.
const DECISION_PERCOL_OPTIONS: { value: "" | DecisionNormalize; label: string; title: string }[] = [
  { value: "", label: "—", title: "Follow the Normalize default above" },
  { value: "none", label: "Raw", title: "This column: use the numbers as they are" },
  { value: "max", label: "÷Max", title: "This column: divide by its biggest value, top = 1" },
  { value: "rank", label: "Rank", title: "This column: keep only the order, worst 0 to best 1. Suits dollar columns." },
];

const DECISION_CABLE_ONLY = new Set(["weights"]);

// One row per criterion, NAMED from the upstream Scores frame rather than blind
// positional slots. A wired `weights` cable overrides the weights, not the modes.
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

  // Mirror weightOf in frameVerbs: a missing or non-finite wired entry weighs 1.
  const wiredWeightAt = (i: number): number => {
    const w = data.wiredWeights?.[i];
    return typeof w === "number" && Number.isFinite(w) ? w : 1;
  };

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} cableOnlyKeys={DECISION_CABLE_ONLY} />
      <div className="solenoid-node__dm-caption" title="The default for every criterion. Norm on a row overrides it.">Normalize</div>
      <SegToggle value={normalize} options={DECISION_NORMALIZE_OPTIONS} onChange={setNormalize} />
      <div className="solenoid-node__dm-weights">
        {criteria.length === 0 ? (
          <div className="solenoid-node__dm-hint">— connect a Scores frame</div>
        ) : (
          <>
            <div className="solenoid-node__dm-weight-row solenoid-node__dm-weights-head">
              <span className="solenoid-node__dm-col-crit">Criterion</span>
              <span className="solenoid-node__dm-col-weight">Weight</span>
              <span className="solenoid-node__dm-col-norm" title={'Per-criterion normalize override. "—" uses the default above.'}>Norm</span>
            </div>
            {criteria.map((name, i) => (
              <div className="solenoid-node__dm-weight-row" key={name}>
                <span className="solenoid-node__io-label solenoid-node__dm-col-crit" title={`“${name}”: weight and normalize. A negative weight means lower is better.`}>{name}</span>
                {wired
                  ? <span className="solenoid-node__dm-col-weight solenoid-node__dm-weight-ro" title="From the wired Weights list">{wiredWeightAt(i)}</span>
                  : <InlineNumberField value={data.weightMap[name] ?? 1} onChange={(v) => setWeight(name, v)} />}
                <ArgSelect value={data.normMap[name] ?? ""} options={DECISION_PERCOL_OPTIONS} onChange={(m) => setNorm(name, m)} />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="solenoid-node__dm-caption">Output</div>
      <SegToggle value={detail} options={DECISION_DETAIL_OPTIONS} onChange={setDetail} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────
// Scores × weight-scenarios → a Cube of rankings, one nested table per scenario.

export function DecisionSensitivityComponent({ data, emit }: NodeProps<DecisionSensitivityNodeType>) {
  const [normalize, setNormalize] = useNodeField(data, "normalize");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__dm-caption" title="Applies to every criterion, in every scenario.">Normalize</div>
      <SegToggle value={normalize} options={DECISION_NORMALIZE_OPTIONS} onChange={setNormalize} />
      <CubeDisplay cube={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function AllocatorComponent({ data, emit }: NodeProps<AllocatorNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  // The amount field is hidden in Min proportional (which uses neither budget nor target);
  // its socket stays so nothing is ever left wired to an undrawn dot. (Weights ride the
  // categories frame's Weight column — orderedColumnsAreFrames — so there is no list socket.)
  const cableOnly = mode === "minProportional" ? BUDGET_CABLE_ONLY_PROP : undefined;
  return (
    <NodeShell node={data} emit={emit}>
      <ArgSelect value={mode} onChange={setMode} options={ALLOCATE_MODE_OPTIONS} />
      <InlineInputs node={data} emit={emit} cableOnlyKeys={cableOnly} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── RECONCILE ───────────────────────────────────────────────────────────────
// Two frame outputs are one too many dots to auto-place, so both rows are hand-placed
// (like Split Frame).

export function ReconcileComponent({ data, emit }: NodeProps<ReconcileNodeType>) {
  const frameOut = data.outputs.frame;
  const summaryOut = data.outputs.summary;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["left", "right", "key", "priceColumn", "qtyColumn"]} />
      {frameOut && (
        <MeasuredSocketRow hero side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frameOut.socket}>
          <div style={{ width: "100%" }}>
            <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
  { value: "date", label: "Date", title: "Keep only date columns. The Matrix carries serials." },
  { value: "logical", label: "Bool", title: "Keep only logical columns. The Matrix carries 1/0." },
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
            ? <ArrayChip value={matrix} label={`${nodeDisplayName(data)}: Matrix`} size="sm" elem={nodeOutputElemFamily(data.id, "matrix")} />
            : data.cachedMixed
              ? <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }} title="A frame with text columns has no numeric matrix. Pull a column with Get Column.">mixed; use Get Column</span>
              : "—"}
        </span>
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="headers" nodeId={data.id} emit={emit} payload={data.outputs.headers!.socket}>
        <span className="solenoid-node__io-label">Headers</span>
        <span className="solenoid-node__output-value" style={{ display: "flex", justifyContent: "flex-end" }}>
          {headers && headers.length ? <ArrayChip value={headers} label={`${nodeDisplayName(data)}: Headers`} size="sm" elem={nodeOutputElemFamily(data.id, "headers")} /> : "—"}
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
  { value: "logical", label: "Boolean", title: "Read the column as logicals (TRUE/FALSE). A 0/1 or true/false column coerces." },
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
  { value: "logical", label: "Boolean", title: "Add a logical column (TRUE/FALSE). A 0/1 list coerces." },
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
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
        placeholder="@price * @qty …"
        locked={false}
        onOpen={() => formulaPopup.open(data.id)}
      />
      <ArgSelect value={addAs} onChange={setAddAs} options={COMPUTED_AS_OPTIONS} />
      {/* Binding pickers — one quiet row per variable/param, shown once a
          frame is wired. Auto = the by-name ladder (column, else `row`/`rows`,
          else a grown side input); a picked column ALWAYS reads that column,
          so a variable can reach "Unit Price" or a column its own name
          doesn't match. */}
      {data.defVars.length > 0 && data.sourceColumns.length > 0 && data.defVars.map((v) => (
        <div key={v} className="solenoid-node__field-row" title={`Where ${v} reads from`}>
          <span className="solenoid-node__field-label">{v}</span>
          <ArgSelect
            value={data.bindings[v] ?? ""}
            onChange={(next) => bind(v, next)}
            options={[{ value: "", label: "auto" }, ...data.sourceColumns.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      ))}
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export function GetRowComponent({ data, emit }: NodeProps<GetRowNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
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
      <ResultDisplay value={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

// ─── DESCRIBE / CORRELATION MATRIX ───────────────────────────────────────────
export function DescribeComponent({ data, emit }: NodeProps<DescribeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

const CORR_METHOD_OPTIONS = (Object.keys(CORR_METHOD_META) as CorrMethod[]).map((m) => ({
  value: m, label: CORR_METHOD_META[m].label, title: CORR_METHOD_META[m].description,
}));

export function CorrMatrixComponent({ data, emit }: NodeProps<CorrMatrixNodeType>) {
  const [method, setMethod] = useNodeField(data, "method");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={method} onChange={setMethod} options={CORR_METHOD_OPTIONS} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}

export function KMeansComponent({ data, emit }: NodeProps<KMeansNodeType>) {
  const labelsOut = data.outputs.labels, centersOut = data.outputs.centers;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {labelsOut && (
        <MeasuredSocketRow hero side="output" socketKey="labels" nodeId={data.id} emit={emit} payload={labelsOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedLabels} /></div>
        </MeasuredSocketRow>
      )}
      {centersOut && (
        <MeasuredSocketRow hero side="output" socketKey="centers" nodeId={data.id} emit={emit} payload={centersOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedCenters} label={nodeDisplayName(data)} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

const PCA_SCALE_OPTIONS: { value: "cov" | "corr"; label: string; title: string }[] = [
  { value: "cov", label: "Centered", title: "Covariance PCA — features keep their scale (prcomp default)" },
  { value: "corr", label: "Standardized", title: "Correlation PCA — each feature scaled to unit variance first (prcomp scale. = TRUE)" },
];

export function PcaComponent({ data, emit }: NodeProps<PcaNodeType>) {
  const [std, setStd] = useState<"cov" | "corr">(data.standardize ? "corr" : "cov");
  useEffect(() => { setStd(data.standardize ? "corr" : "cov"); }, [data.standardize]);
  const scoresOut = data.outputs.scores, loadingsOut = data.outputs.loadings, explainedOut = data.outputs.explained;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={std} options={PCA_SCALE_OPTIONS} onChange={(v) => { setStd(v); data.standardize = v === "corr"; void processGraph(data.id); }} />
      {scoresOut && (
        <MeasuredSocketRow hero side="output" socketKey="scores" nodeId={data.id} emit={emit} payload={scoresOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedScores} label={nodeDisplayName(data)} /></div>
        </MeasuredSocketRow>
      )}
      {loadingsOut && (
        <MeasuredSocketRow hero side="output" socketKey="loadings" nodeId={data.id} emit={emit} payload={loadingsOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedLoadings} label={nodeDisplayName(data)} /></div>
        </MeasuredSocketRow>
      )}
      {explainedOut && (
        <MeasuredSocketRow hero side="output" socketKey="explained" nodeId={data.id} emit={emit} payload={explainedOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedExplained} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

export function LogisticComponent({ data, emit }: NodeProps<LogisticNodeType>) {
  const coefOut = data.outputs.coefficients, probOut = data.outputs.probabilities;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {coefOut && (
        <MeasuredSocketRow hero side="output" socketKey="coefficients" nodeId={data.id} emit={emit} payload={coefOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedCoefficients} label={nodeDisplayName(data)} /></div>
        </MeasuredSocketRow>
      )}
      {probOut && (
        <MeasuredSocketRow hero side="output" socketKey="probabilities" nodeId={data.id} emit={emit} payload={probOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedProbabilities} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

// ─── WINDOW ───────────────────────────────────────────────────────────────────
const WINDOW_FN_OPTIONS = (Object.keys(WINDOW_FN_META) as WindowFn[]).map((f) => ({
  value: f, label: WINDOW_FN_META[f].label, title: WINDOW_FN_META[f].description,
}));

export function WindowComponent({ data, emit }: NodeProps<WindowNodeType>) {
  const [agg, setAgg] = useNodeField(data, "agg");
  return (
    <NodeShell node={data} emit={emit}>
      <ArgSelect value={agg} onChange={setAgg} options={WINDOW_FN_OPTIONS} />
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
