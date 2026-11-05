import { useEffect, useState } from "react";
import type { RandArrayNode as RandArrayNodeType, ShapeMode } from "../nodeClasses";
import { RANDARRAY_MODE_META } from "../nodeClasses";
import { SegToggle } from "./SegToggle";
import { TableDisplay } from "./TableDisplay";
import { applyShapeMode } from "./shapeMode";
import { isSolError, type SolError } from "../errorValue";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { RecalcButton } from "./RecalcButton";
import { stopDragStart } from "../coarse";
import { nodeDisplayName } from "../catalogUtils";

const MODES = (Object.keys(RANDARRAY_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...RANDARRAY_MODE_META[m] }));

export function RandArrayComponent({ data, emit }: NodeProps<RandArrayNodeType>) {
  // Local mirror so the checkbox re-renders immediately (data.integer is the truth).
  const [integer, setInteger] = useState(data.integer);
  useEffect(() => { setInteger(data.integer); }, [data.integer]);

  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      <InlineInputs node={data} emit={emit} />
      <label
        style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text)", marginTop: 2, cursor: "pointer" }}
        title="Round every draw to a whole number (Excel's integer flag)"
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={integer}
          onChange={(e) => { setInteger(e.target.checked); data.integer = e.target.checked; void processGraph(data.id); }}
        />
        Integer
      </label>
      <RecalcButton title="Roll new random values" />
      {data.mode === "grid"
        ? <TableDisplay table={isSolError(data.cachedList) ? (data.cachedList as SolError) : (data.cachedList as number[][] | null)} label={nodeDisplayName(data)} elem="number" />
        : <ResultDisplay value={data.cachedList as number[] | SolError | null} label={nodeDisplayName(data)} />}
    </NodeShell>
  );
}
