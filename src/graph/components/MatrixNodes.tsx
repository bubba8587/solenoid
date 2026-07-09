// All matrix math + shape node components in one file.
import type {
  MatDetNode as MatDetNodeType, MatDetOp,
  TableMultNode as TableMultNodeType,
  TableUnitNode as TableUnitNodeType,
  TableTransposeNode as TableTransposeNodeType,
  HStackTableNode as HStackTableNodeType,
  TableReshapeNode as TableReshapeNodeType, TableReshapeOp,
  TableSelectNode as TableSelectNodeType, TableSelectOp,
  TableInfoNode as TableInfoNodeType,
} from "../rete-nodes";
import {
  MAT_DET_OP_META, TABLE_RESHAPE_OP_META, TABLE_SELECT_OP_META,
} from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, OpSelect, ValueDisplay, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";

// ─── MDETERM / MINVERSE ───────────────────────────────────────────────────────

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

// ─── MMULT ────────────────────────────────────────────────────────────────────

export function TableMultComponent({ data, emit }: NodeProps<TableMultNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── MUNIT ────────────────────────────────────────────────────────────────────

export function TableUnitComponent({ data, emit }: NodeProps<TableUnitNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── TRANSPOSE ────────────────────────────────────────────────────────────────

export function TableTransposeComponent({ data, emit }: NodeProps<TableTransposeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── HSTACK ───────────────────────────────────────────────────────────────────

export function HStackTableComponent({ data, emit }: NodeProps<HStackTableNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

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

// ─── CHOOSEROWS / CHOOSECOLS ──────────────────────────────────────────────────

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

// ─── TABLE INFO (ROWS / COLUMNS) ──────────────────────────────────────────────

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
