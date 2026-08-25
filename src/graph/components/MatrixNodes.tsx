import type {
  MatDetNode as MatDetNodeType, MatDetOp,
  TableMultNode as TableMultNodeType,
  TableUnitNode as TableUnitNodeType,
  TableDiagNode as TableDiagNodeType,
  TableOuterNode as TableOuterNodeType,
  MatSolveNode as MatSolveNodeType,
  MatEigenNode as MatEigenNodeType,
  TableTransposeNode as TableTransposeNodeType,
  StackNode as StackNodeType, StackOp,
  TableReshapeNode as TableReshapeNodeType, TableReshapeOp,
  TableSelectNode as TableSelectNodeType, TableSelectOp,
  TakeDropNode as TakeDropNodeType, TakeDropOp,
  ExpandNode as ExpandNodeType,
  TableInfoNode as TableInfoNodeType,
} from "../rete-nodes";
import {
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META, TAKEDROP_OP_META, STACK_OP_META,
} from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, OpSelect, ValueDisplay, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";
import { MeasuredSocketRow } from "./NodeSocket";
import { makeToggleNodeComponent } from "./standardNode";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { nodeDisplayName } from "../catalogUtils";

const MAT_DET_OPS = (Object.keys(MAT_DET_OP_META) as MatDetOp[]).map(op => ({
  value: op, label: MAT_DET_OP_META[op].label,
}));

export function MatDetComponent({ data, emit }: NodeProps<MatDetNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  async function pickOp(next: MatDetOp) {
    if (next === data.op) return;
    data.setOp(next);
    // The output retyped in place (number ↔ table): drop cables the new type can't feed
    // and let docked FCs re-resolve — no connection event fires.
    const editor = getActiveEditor();
    const area = getActiveArea();
    if (editor && area) await retypeOutputCables(editor, area, data.id, "result");
    if (area) await area.update("node", data.id);
    setOpField(next);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={MAT_DET_OPS} />
      {op === "minverse"
        ? <TableDisplay table={data.cachedMatrix} label={nodeDisplayName(data)} elem="number" />
        : <ValueDisplay value={data.cachedScalar} />}
    </NodeShell>
  );
}

export function MatSolveComponent({ data, emit }: NodeProps<MatSolveNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

export function MatEigenComponent({ data, emit }: NodeProps<MatEigenNodeType>) {
  const valuesOut = data.outputs.values, vectorsOut = data.outputs.vectors;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {valuesOut && (
        <MeasuredSocketRow hero side="output" socketKey="values" nodeId={data.id} emit={emit} payload={valuesOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedValues} /></div>
        </MeasuredSocketRow>
      )}
      {vectorsOut && (
        <MeasuredSocketRow hero side="output" socketKey="vectors" nodeId={data.id} emit={emit} payload={vectorsOut.socket}>
          <div style={{ width: "100%" }}><TableDisplay table={data.cachedVectors} label={nodeDisplayName(data)} elem="number" /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

export function TableMultComponent({ data, emit }: NodeProps<TableMultNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

const offDiagOptions = (zeroTitle: string) => [
  { value: "zero" as const, label: "0", title: zeroTitle },
  { value: "blank" as const, label: "blank", title: "Off-diagonal cells are blank (null) — skipped by sums and element-wise ops" },
];

export const TableUnitComponent = makeToggleNodeComponent<TableUnitNodeType, TableUnitNodeType["offDiag"]>(
  { read: (n) => n.offDiag, write: (n, v) => { n.offDiag = v; }, options: offDiagOptions("Off-diagonal cells are 0 (Excel MUNIT)") },
  (n) => n.cachedResult,
  { table: true },
);

export const TableDiagComponent = makeToggleNodeComponent<TableDiagNodeType, TableDiagNodeType["offDiag"]>(
  { read: (n) => n.offDiag, write: (n, v) => { n.offDiag = v; }, options: offDiagOptions("Off-diagonal cells are 0 (numpy.diag)") },
  (n) => n.cachedResult,
  { table: true },
);

export function TableOuterComponent({ data, emit }: NodeProps<TableOuterNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

export function TableTransposeComponent({ data, emit }: NodeProps<TableTransposeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

const STACK_OPS = (Object.keys(STACK_OP_META) as StackOp[]).map((op) => ({
  value: op, label: STACK_OP_META[op].label, title: STACK_OP_META[op].description,
}));

export function StackComponent({ data, emit }: NodeProps<StackNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={STACK_OPS} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

const RESHAPE_OPS = (Object.keys(TABLE_RESHAPE_OP_META) as TableReshapeOp[]).map(op => ({
  value: op, label: TABLE_RESHAPE_OP_META[op].label,
}));

export function TableReshapeComponent({ data, emit }: NodeProps<TableReshapeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const isWrap = op === "wraprows" || op === "wrapcols";
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={RESHAPE_OPS} />
      {isWrap
        ? <TableDisplay table={data.cachedMatrix} label={nodeDisplayName(data)} elem="number" />
        : /* flattened list is homogeneous at runtime (matches the input's element
             type); ValueDisplay branches number-vs-text on the first cell. */
          <ValueDisplay value={data.cachedList as number[] | string[] | null} />}
    </NodeShell>
  );
}

const SELECT_OPS = (Object.keys(TABLE_SELECT_OP_META) as TableSelectOp[]).map(op => ({
  value: op, label: TABLE_SELECT_OP_META[op].label,
}));

export function TableSelectComponent({ data, emit }: NodeProps<TableSelectNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={SELECT_OPS} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

const TAKEDROP_OPS = (Object.keys(TAKEDROP_OP_META) as TakeDropOp[]).map(op => ({
  value: op, label: TAKEDROP_OP_META[op].label,
}));

export function TakeDropComponent({ data, emit }: NodeProps<TakeDropNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const r = data.cachedResult;
  // Same rank out as in: a matrix draws in the grid, a list or scalar in the value box.
  const isMatrix = Array.isArray(r) && r.length > 0 && Array.isArray(r[0]);
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={TAKEDROP_OPS} />
      {isMatrix
        ? <TableDisplay table={r as (number | string | null)[][]} label={nodeDisplayName(data)} elem="number" />
        : <ValueDisplay value={r as DisplayValue} />}
    </NodeShell>
  );
}

export function ExpandTableComponent({ data, emit }: NodeProps<ExpandNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}

export function TableInfoComponent({ data, emit }: NodeProps<TableInfoNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "rows", label: "ROWS",    value: data.cachedRows },
          { key: "cols", label: "COLUMNS", value: data.cachedCols },
        ]}
      />
    </NodeShell>
  );
}
