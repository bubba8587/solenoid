import type { FitDistributionNode as FitDistributionNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { FrameDisplay } from "./FrameDisplay";

export function FitDistributionComponent({ data, emit }: NodeProps<FitDistributionNodeType>) {
  const rankingOut = data.outputs.ranking, bestOut = data.outputs.best, paramsOut = data.outputs.params;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      {rankingOut && (
        <MeasuredSocketRow hero side="output" socketKey="ranking" nodeId={data.id} emit={emit} payload={rankingOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedRanking} label={data.label} /></div>
        </MeasuredSocketRow>
      )}
      {bestOut && (
        <MeasuredSocketRow hero side="output" socketKey="best" nodeId={data.id} emit={emit} payload={bestOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedBest} /></div>
        </MeasuredSocketRow>
      )}
      {paramsOut && (
        <MeasuredSocketRow hero side="output" socketKey="params" nodeId={data.id} emit={emit} payload={paramsOut.socket}>
          <div style={{ width: "100%" }}><ValueDisplay value={data.cachedParams} /></div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
