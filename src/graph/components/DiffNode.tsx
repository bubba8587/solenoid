import { useEffect, useState } from "react";
import { DIFF_AXIS_META, DIFF_MODE_META, DIFF_OP_META } from "../nodeClasses";
import type { DiffNode as DiffNodeType, DiffOp, ShapeMode } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, useNodeField, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { OpToggle, SegToggle } from "./SegToggle";
import { TableDisplay } from "./TableDisplay";
import { applyShapeMode } from "./shapeMode";
import { processGraph } from "../process";
import { isSolError, type SolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";

const options = <K extends string>(meta: Record<K, { label: string; title: string }>) =>
  (Object.keys(meta) as K[]).map((k) => ({ value: k, ...meta[k] }));
const OPS = options(DIFF_OP_META);
const MODES = options(DIFF_MODE_META);
const AXES = options(DIFF_AXIS_META);

export function DiffComponent({ data, emit }: NodeProps<DiffNodeType>) {
  const [op, setOp] = useState<DiffOp>(data.op);
  useEffect(() => { setOp(data.op); }, [data.op]);
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  const [byCol, setByCol] = useNodeField(data, "byCol");
  return (
    <NodeShell node={data} emit={emit}>
      <OpToggle value={op} options={OPS} onChange={(next) => { setOp(next); data.setOp(next); void processGraph(data.id); }} />
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      {mode === "grid" && (
        <SegToggle value={byCol ? "across" : "down"} options={AXES} onChange={(next) => setByCol(next === "across")} />
      )}
      <InlineInputs node={data} emit={emit} />
      {data.mode === "grid"
        ? <TableDisplay table={isSolError(data.cachedList) ? (data.cachedList as SolError) : (data.cachedList as (number | null)[][])} label={nodeDisplayName(data)} elem="number" />
        : <ResultDisplay value={data.cachedList} label={nodeDisplayName(data)} />}
    </NodeShell>
  );
}
