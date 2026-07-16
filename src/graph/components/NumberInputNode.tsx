import type { ChangeEvent } from "react";
import type { NumberInputNode as NumberInputNodeType } from "../rete-nodes";
import { processGraph, pushHistory } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDraftCommit, useNumberScrub, INVALID_DRAFT } from "./inlineInput";

export function NumberInputComponent({ data, emit }: NodeProps<NumberInputNodeType>) {
  // Commit on Enter/clickaway (project rule) — typing must not recompute the
  // graph per keystroke. Empty commits as 0, like clearing a cell.
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

  // Drag-to-scrub, same gesture as the per-row inline literals (a plain click
  // still focuses for typing — the drag only engages past the move threshold).
  const apply = (v: number) => { data.value = v; void processGraph(data.id); };
  const scrub = useNumberScrub(
    data.value,
    (v) => field.setDraft(v == null ? "" : String(v)),
    (next) => {
      const prev = data.value;
      apply(next);
      pushHistory(() => apply(prev), () => apply(next));
    },
  );

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Number" collapsible={false}>
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
