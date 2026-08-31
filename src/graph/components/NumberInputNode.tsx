import type { ChangeEvent } from "react";
import type { NumberInputNode as NumberInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDraftCommit, useNumberScrub, INVALID_DRAFT } from "./inlineInput";

export function NumberInputComponent({ data, emit }: NodeProps<NumberInputNodeType>) {
  // Empty commits as 0, like clearing a cell.
  const field = useDraftCommit<number>(
    data.value,
    String,
    (t) => {
      if (t.trim() === "") return 0;
      const n = Number(t);
      return Number.isFinite(n) ? n : INVALID_DRAFT;
    },
    (v) => { data.value = v; void processGraph(data.id); },
  );

  // Drag-to-scrub, same gesture as the per-row inline literals — the drag engages
  // only past the move threshold, so a plain click still focuses for typing.
  const apply = (v: number) => { data.value = v; void processGraph(data.id); };
  const scrub = useNumberScrub(
    data.value,
    (v) => field.setDraft(v == null ? "" : String(v)),
    (next) => apply(next),
  );

  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <input
        className="solenoid-node__value-input"
        type="number"
        value={field.draft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        {...scrub}
        onMouseDown={(e) => e.stopPropagation()}
        step="any"
      />
    </NodeShell>
  );
}
