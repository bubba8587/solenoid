import { useState } from "react";
import { DATE_TRUNC_UNIT_META } from "../rete-nodes";
import type { DateTruncNode as DateTruncNodeType, DateTruncUnit } from "../rete-nodes";
import { processGraph } from "../process";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";

const UNITS = (Object.keys(DATE_TRUNC_UNIT_META) as DateTruncUnit[]).map((u) => ({
  value: u, label: DATE_TRUNC_UNIT_META[u].label, title: DATE_TRUNC_UNIT_META[u].description,
}));
const DIRECTION = [
  { value: "floor" as const, label: "floor", title: "The start of the period the date falls in (lubridate floor_date)" },
  { value: "ceiling" as const, label: "ceiling", title: "The start of the next period; a date already on the boundary stays put (ceiling_date)" },
];

export function DateTruncComponent({ data, emit }: NodeProps<DateTruncNodeType>) {
  const [unit, setUnit] = useNodeField(data, "unit");
  const [dir, setDir] = useState<"floor" | "ceiling">(data.ceiling ? "ceiling" : "floor");
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg value={dir} options={DIRECTION}
        onChange={(d) => { setDir(d); data.ceiling = d === "ceiling"; void processGraph(data.id); }} />
      <OpSelect arg value={unit} onChange={setUnit} options={UNITS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
