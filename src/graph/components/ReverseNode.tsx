import { useEffect, useState } from "react";
import type { ReverseNode as ReverseNodeType, ShapeMode } from "../nodeClasses";
import { REVERSE_MODE_META, DIFF_AXIS_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, useNodeField, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { TableDisplay } from "./TableDisplay";
import { applyShapeMode } from "./shapeMode";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";

const MODES = (Object.keys(REVERSE_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...REVERSE_MODE_META[m] }));
const AXES = [
  { value: "down" as const, label: DIFF_AXIS_META.down.label, title: "The last row first" },
  { value: "across" as const, label: DIFF_AXIS_META.across.label, title: "Each row back to front" },
];

export function ReverseComponent({ data, emit }: NodeProps<ReverseNodeType>) {
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  const [byCol, setByCol] = useNodeField(data, "byCol");
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      {mode === "grid" && <SegToggle value={byCol ? "across" : "down"} options={AXES} onChange={(next) => setByCol(next === "across")} />}
      <InlineInputs node={data} emit={emit} />
      {data.mode === "grid"
        ? <TableDisplay table={data.cachedList as (number | null)[][]} label={nodeDisplayName(data)} elem={undefined} />
        : <ResultDisplay value={previewed(() => data.cachedList as never)} label={nodeDisplayName(data)} />}
    </NodeShell>
  );
}
