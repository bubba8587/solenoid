import type { SubsystemNode as SubsystemNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import "./SubsystemNode.css";

// The architecture card face: the group's leading module names read on the card
// (the seed writes rows ordered by import degree, so the first rows are the
// load-bearing ones); the full table is the frame output's popup.

const SAMPLE_ROWS = 6;

export function SubsystemComponent({ data, emit }: NodeProps<SubsystemNodeType>) {
  const names = data.cachedResult?.columns[0]?.values ?? [];
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Subsystem">
      <InlineInputs node={data} emit={emit} />
      {names.length > 0 && (
        <div className="subsys-rows">
          {names.slice(0, SAMPLE_ROWS).map((v, i) => (
            <div key={i} className="subsys-row">{String(v ?? "")}</div>
          ))}
          {names.length > SAMPLE_ROWS && (
            <div className="subsys-row subsys-row--more">+{names.length - SAMPLE_ROWS} more</div>
          )}
        </div>
      )}
      <ResultDisplay value={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
