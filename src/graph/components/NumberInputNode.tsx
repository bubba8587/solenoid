import { useState, type ChangeEvent } from "react";
import type { NumberInputNode as NumberInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { UNIT_ANNOTATIONS, UNIT_GROUP_LABELS, type UnitGroup } from "../formatAnnotationStore";
import { isDimensionalFcUnit } from "../unitBridge";

// The dimensional units a Number literal can carry, grouped for the picker. Only
// DIMENSIONAL ids (a real physical/currency dimension) — "none"/"custom" and any
// unit that resolves to dimensionless are excluded (they'd tag nothing).
const UNIT_GROUPS: Array<[UnitGroup, string]> = (() => {
  const seen: UnitGroup[] = [];
  for (const u of UNIT_ANNOTATIONS) {
    if (u.group === "none" || u.group === "custom") continue;
    if (!isDimensionalFcUnit(u.id)) continue;
    if (!seen.includes(u.group)) seen.push(u.group);
  }
  return seen.map((g) => [g, UNIT_GROUP_LABELS[g]] as [UnitGroup, string]);
})();

export function NumberInputComponent({ data, emit }: NodeProps<NumberInputNodeType>) {
  const [unit, setUnit] = useState(data.unit ?? "none");
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

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Number" collapsible={false}>
      <input
        className="solenoid-node__value-input"
        type="number"
        value={field.draft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        step="any"
      />
      {/* Optional physical dimension. A discrete pick applies immediately (unlike the
          typed value): the literal becomes a base-SI quantity that computes with its
          unit downstream (5 m ÷ 1 s = 5 m/s). stopPropagation keeps rete's node-drag
          from closing the native dropdown mid-interaction. */}
      <select
        className="solenoid-node__op-select"
        value={unit}
        onChange={(e) => { const u = e.target.value; setUnit(u); data.unit = u; void processGraph(data.id); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        title="Physical unit — the literal computes with this dimension"
        style={{ marginTop: 6, width: "100%" }}
      >
        <option value="none">— no unit</option>
        {UNIT_GROUPS.map(([g, label]) => (
          <optgroup key={g} label={label}>
            {UNIT_ANNOTATIONS.filter((u) => u.group === g && isDimensionalFcUnit(u.id)).map((u) => (
              <option key={u.id} value={u.id}>{u.id}{u.label ? ` (${u.label.trim()})` : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </NodeShell>
  );
}
