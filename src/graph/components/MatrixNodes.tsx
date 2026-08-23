import type {
  MatDetNode as MatDetNodeType, MatDetOp,
  TableMultNode as TableMultNodeType,
  TableUnitNode as TableUnitNodeType,
  TableDiagNode as TableDiagNodeType,
  TableOuterNode as TableOuterNodeType,
  TableTransposeNode as TableTransposeNodeType,
  HStackTableNode as HStackTableNodeType,
  TableReshapeNode as TableReshapeNodeType, TableReshapeOp,
  TableSelectNode as TableSelectNodeType, TableSelectOp,
  TableTakeDropNode as TableTakeDropNodeType, TableTakeDropOp,
  ExpandNode as ExpandNodeType,
  TableInfoNode as TableInfoNodeType,
} from "../rete-nodes";
import {
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META, TABLE_TAKEDROP_OP_META,
} from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, OpSelect, ValueDisplay, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { makeToggleNodeComponent } from "./standardNode";

const MAT_DET_OPS = (Object.keys(MAT_DET_OP_META) as MatDetOp[]).map(op => ({
  value: op, label: MAT_DET_OP_META[op].label,
}));

export function MatDetComponent({ data, emit }: NodeProps<MatDetNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={MAT_DET_OPS} />
      {op === "mdeterm"
        ? <ValueDisplay value={data.cachedScalar} />
        : <TableDisplay table={data.cachedMatrix} label={data.label} />}
    </NodeShell>
  );
}

export function TableMultComponent({ data, emit }: NodeProps<TableMultNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
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
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function TableTransposeComponent({ data, emit }: NodeProps<TableTransposeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function HStackTableComponent({ data, emit }: NodeProps<HStackTableNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
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
        ? <TableDisplay table={data.cachedMatrix} label={data.label} />
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
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

const TAKEDROP_OPS = (Object.keys(TABLE_TAKEDROP_OP_META) as TableTakeDropOp[]).map(op => ({
  value: op, label: TABLE_TAKEDROP_OP_META[op].label,
}));

export function TableTakeDropComponent({ data, emit }: NodeProps<TableTakeDropNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={TAKEDROP_OPS} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function ExpandTableComponent({ data, emit }: NodeProps<ExpandNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
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
