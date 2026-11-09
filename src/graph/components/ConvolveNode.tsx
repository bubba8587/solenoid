import { useEffect, useState } from "react";
import { CONVOLVE_FORM_META, CONVOLVE_MODE_META } from "../nodeClasses";
import type { ConvolveForm, ConvolveNode as ConvolveNodeType, ShapeMode } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, useNodeField, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { TableDisplay } from "./TableDisplay";
import { applyShapeMode } from "./shapeMode";
import { isSolError, type SolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";

const MODES = (Object.keys(CONVOLVE_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...CONVOLVE_MODE_META[m] }));
const FORMS = (Object.keys(CONVOLVE_FORM_META) as ConvolveForm[]).map((f) => ({ value: f, ...CONVOLVE_FORM_META[f] }));

export function ConvolveComponent({ data, emit }: NodeProps<ConvolveNodeType>) {
  const [form, setForm] = useNodeField(data, "form");
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      <SegToggle value={form} options={FORMS} onChange={setForm} />
      <InlineInputs node={data} emit={emit} />
      {data.mode === "grid"
        ? <TableDisplay table={isSolError(data.cachedList) ? (data.cachedList as SolError) : (data.cachedList as (number | null)[][])} label={nodeDisplayName(data)} elem="number" />
        : <ResultDisplay value={data.cachedList} label={nodeDisplayName(data)} />}
    </NodeShell>
  );
}
