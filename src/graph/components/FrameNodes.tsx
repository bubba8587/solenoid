// Frame (data-table) node components: Frame Input, Build, Split, Get Column, Add Column.
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type {
  FrameInputNode as FrameInputNodeType,
  BuildFrameNode as BuildFrameNodeType,
  SplitFrameNode as SplitFrameNodeType,
  GetColumnNode as GetColumnNodeType,
  AddColumnNode as AddColumnNodeType,
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
  DecisionMatrixNode as DecisionMatrixNodeType,
  DecisionSensitivityNode as DecisionSensitivityNodeType,
  ReconcileNode as ReconcileNodeType,
  FrameLookupNode as FrameLookupNodeType,
  FrameSortDir,
  DecisionDetail,
  SplitColType,
} from "../rete-nodes";
import type { FilterOp, JoinHow, AsofDirection, AggOp, DecisionNormalize, LookupMatchMode } from "../frameVerbs";
import { CubeDisplay } from "./CubeDisplay";
import { parseFrameSource, frameSourceToText, type FrameSourceColumn } from "../frame";
import { processGraph } from "../process";
import { pivotEditor } from "../pivotEditorStore";
import { InlineInputs, InlineNumberField, useConnectedInputs } from "./inlineInput";
import { FrameDisplay } from "./FrameDisplay";
import { ArrayChip } from "./ArrayChip";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { applyGetColumnReadAs, applyAddColumnAddAs, applySplitColType } from "./frameEdit";
import type { GetColumnReadAs, AddColumnAddAs } from "../rete-nodes";

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
    void processGraph();
  }, [data]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Frame">
      <FrameDisplay frame={data.cachedResult} label={data.label} source={source} onSaveSource={onSaveSource} />
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

export function HeadComponent({ data, emit }: NodeProps<HeadNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
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

const FILTER_OP_OPTIONS: { value: FilterOp; label: string }[] = [
  { value: "gt", label: "＞ greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "＜ less than" },
  { value: "lte", label: "≤ at most" },
  { value: "eq", label: "＝ equals" },
  { value: "neq", label: "≠ not equal" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
];

export function FilterFrameComponent({ data, emit }: NodeProps<FilterFrameNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} options={FILTER_OP_OPTIONS} onChange={setOp} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────

const JOIN_HOW_OPTIONS: { value: JoinHow; label: string; title: string }[] = [
  { value: "inner", label: "Inner", title: "Only rows that match in both" },
  { value: "left", label: "Left", title: "All left rows; unmatched right side is blank" },
  { value: "right", label: "Right", title: "All right rows; unmatched left side is blank" },
  { value: "outer", label: "Outer", title: "All rows from both sides" },
  { value: "asof", label: "As-of", title: "Nearest match on a sorted number/date key (no exact match required)" },
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

const AGG_OP_OPTIONS: { value: AggOp; label: string }[] = [
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

export function GroupByFrameComponent({ data, emit }: NodeProps<GroupByFrameNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} options={AGG_OP_OPTIONS} onChange={setOp} />
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
  if (!rows.length && !cols.length && !vals.length) return "Not configured — click Configure";
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
    const accent = getComputedStyle(e.currentTarget).getPropertyValue("--node-accent").trim() || undefined;
    pivotEditor.open({ node: data, nodeId: data.id, title: data.label || "Pivot", accent });
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["frame", "rowFields", "colFields", "values", "filter"]} cableOnlyKeys={PIVOT_CABLE_ONLY} />
      <button
        type="button"
        className="solenoid-node__pivot-config"
        onClick={openEditor}
        onPointerDown={(e) => e.stopPropagation()}
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
      <InlineInputs node={data} emit={emit} />
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
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

const DECISION_NORMALIZE_OPTIONS: { value: DecisionNormalize; label: string; title: string }[] = [
  { value: "none", label: "Raw", title: "Score with the criteria values as-is" },
  { value: "max", label: "÷ Max", title: "Scale each criterion by its largest magnitude (≈ [-1, 1]) so different ranges compare" },
  { value: "rank", label: "Rank", title: "Replace each criterion's values with their within-column rank — compares incompatible scales like $ vs out-of-10" },
];

const DECISION_DETAIL_OPTIONS: { value: DecisionDetail; label: string; title: string }[] = [
  { value: "summary", label: "Summary", title: "Output just Option · Score · Rank" },
  { value: "breakdown", label: "Breakdown", title: "Also show each criterion's effective (post-normalize) value per option — the contributions behind the score" },
];

// Per-criterion normalize override. "" = inherit the node's default mode (the global
// SegToggle); the rest are the DMBV per-column "Rank Raws" / Normalize, set per column.
const DECISION_PERCOL_OPTIONS: { value: "" | DecisionNormalize; label: string; title: string }[] = [
  { value: "", label: "—", title: "Use the node's default normalize mode (above)" },
  { value: "none", label: "Raw", title: "This column: score the raw values as-is" },
  { value: "max", label: "÷Max", title: "This column: scale by its largest magnitude → [0,1]" },
  { value: "rank", label: "Rank", title: "This column: within-column rank → [0,1] (DMBV Rank Raws) — for $-scale columns" },
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
      <div className="solenoid-node__dm-caption">Normalize — default for every criterion (override per-row below):</div>
      <SegToggle value={normalize} options={DECISION_NORMALIZE_OPTIONS} onChange={setNormalize} />
      <div className="solenoid-node__dm-weights">
        {criteria.length === 0 ? (
          <div className="solenoid-node__dm-hint">Wire a Scores frame — a row appears per criterion.</div>
        ) : (
          <>
            <div className="solenoid-node__dm-weight-row solenoid-node__dm-weights-head">
              <span className="solenoid-node__dm-col-crit">Criterion</span>
              {!wired && <span className="solenoid-node__dm-col-weight">Weight</span>}
              <span className="solenoid-node__dm-col-norm" title="Per-criterion normalize override; — uses the default above">Norm</span>
            </div>
            {wired && <div className="solenoid-node__dm-hint">Weights from the wired list; per-column Norm still applies.</div>}
            {criteria.map((name) => (
              <div className="solenoid-node__dm-weight-row" key={name}>
                <span className="solenoid-node__io-label solenoid-node__dm-col-crit" title={`“${name}” — weight (negative = lower is better) and per-column normalize`}>{name}</span>
                {!wired && <InlineNumberField value={data.weightMap[name] ?? 1} onChange={(v) => setWeight(name, v)} />}
                <OpSelect value={data.normMap[name] ?? ""} options={DECISION_PERCOL_OPTIONS} onChange={(m) => setNorm(name, m)} />
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
        <MeasuredSocketRow side="output" socketKey="frame" nodeId={data.id} emit={emit} payload={frameOut.socket}>
          <div style={{ width: "100%" }}>
            <FrameDisplay frame={data.cachedResult} label={data.label} />
          </div>
        </MeasuredSocketRow>
      )}
      {summaryOut && (
        <MeasuredSocketRow side="output" socketKey="summary" nodeId={data.id} emit={emit} payload={summaryOut.socket}>
          <span
            className="solenoid-node__io-label"
            style={{ fontSize: 10.5, color: "var(--text-dim)", whiteSpace: "normal", lineHeight: 1.4 }}
            title={data.cachedSummary || undefined}
          >
            {data.cachedSummary || "—"}
          </span>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

// ─── SPLIT FRAME ───────────────────────────────────────────────────────────────
// Two outputs (Matrix + Headers), each a labelled row with its socket and a chip.

const SPLIT_COLTYPE_OPTIONS: { value: SplitColType; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Keep every column" },
  { value: "number", label: "Num", title: "Keep only number columns" },
  { value: "date", label: "Date", title: "Keep only date columns (Matrix = serials)" },
  { value: "logical", label: "Bool", title: "Keep only logical columns (Matrix = 1/0)" },
  { value: "string", label: "Text", title: "Keep only text columns (Headers only — text has no numeric Matrix)" },
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
            ? <ArrayChip value={matrix} label={`${data.label} — Matrix`} size="sm" />
            : data.cachedMixed
              ? <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }} title="A frame with text columns has no numeric matrix. Pull a column with Get Column.">mixed — use Get Column</span>
              : "—"}
        </span>
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="headers" nodeId={data.id} emit={emit} payload={data.outputs.headers!.socket}>
        <span className="solenoid-node__io-label">Headers</span>
        <span className="solenoid-node__output-value" style={{ display: "flex", justifyContent: "flex-end" }}>
          {headers && headers.length ? <ArrayChip value={headers} label={`${data.label} — Headers`} size="sm" /> : "—"}
        </span>
      </MeasuredSocketRow>
    </NodeShell>
  );
}

// ─── GET COLUMN ────────────────────────────────────────────────────────────────

const GET_COLUMN_READ_OPTIONS: { value: GetColumnReadAs; label: string; title: string }[] = [
  { value: "number", label: "Number", title: "Read the column as numbers" },
  { value: "text", label: "Text", title: "Read the column as text" },
  { value: "date", label: "Date", title: "Read the column as dates (Excel serials)" },
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
  { value: "date", label: "Date", title: "Add a date column (Excel serials)" },
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

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export function GetRowComponent({ data, emit }: NodeProps<GetRowNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── FRAME LOOKUP ────────────────────────────────────────────────────────────────

const LOOKUP_MATCH_OPTIONS: { value: LookupMatchMode; label: string; title: string }[] = [
  { value: "exact", label: "Exact", title: "Only an equal cell matches" },
  { value: "nextSmaller", label: "≤", title: "Exact match, else the closest smaller number/date" },
  { value: "nextLarger", label: "≥", title: "Exact match, else the closest larger number/date" },
];

export function FrameLookupComponent({ data, emit }: NodeProps<FrameLookupNodeType>) {
  const [matchMode, setMatchMode] = useNodeField(data, "matchMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={matchMode} options={LOOKUP_MATCH_OPTIONS} onChange={setMatchMode} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
