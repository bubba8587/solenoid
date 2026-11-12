// [[compute-pass#A Delayed Pass card hands on what its input held one recalculation earlier, so loops through it step]]
import type { DelayedPassNode as DelayedPassNodeType } from "../nodeClasses";
import { processGraph, getEngine } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { MeasuredSocketRow } from "./NodeSocket";
import { SwitchValue } from "./CableSwitchNode";
import { nodeDisplayName } from "../catalogUtils";
import "./DelayedPassNode.css";

export function DelayedPassComponent({ data, emit }: NodeProps<DelayedPassNodeType>) {
  function reset() {
    data.reset();
    getEngine()?.invalidate(data.id, false);
    void processGraph(data.id);
  }
  const out = data.outputs.out;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {out && (
        <MeasuredSocketRow side="output" socketKey="out" nodeId={data.id} emit={emit} payload={out.socket} hero>
          <SwitchValue value={data.cachedValue} label={nodeDisplayName(data)} nodeId={data.id} />
        </MeasuredSocketRow>
      )}
      <div className="sol-delay__bar">
        <span className="sol-delay__steps">step {data.stepCount}</span>
        <button
          type="button" className="sol-delay__reset" title="Start again from blank"
          onClick={(e) => { e.stopPropagation(); reset(); }}
          onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
        >Reset</button>
      </div>
    </NodeShell>
  );
}
