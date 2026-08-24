import type { EtsForecastNode as EtsForecastNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { FrameDisplay } from "./FrameDisplay";

export function EtsForecastComponent({ data, emit }: NodeProps<EtsForecastNodeType>) {
  const forecastOut = data.outputs.forecast, detectedOut = data.outputs.detected;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      {forecastOut && (
        <MeasuredSocketRow hero side="output" socketKey="forecast" nodeId={data.id} emit={emit} payload={forecastOut.socket}>
          <div style={{ width: "100%" }}><FrameDisplay frame={data.cachedResult} label={data.label} /></div>
        </MeasuredSocketRow>
      )}
      {detectedOut && (
        <MeasuredSocketRow side="output" socketKey="detected" nodeId={data.id} emit={emit} payload={detectedOut.socket}>
          <span className="solenoid-node__io-label">Season used</span>
          <ValueDisplay value={data.cachedSeason} />
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}
