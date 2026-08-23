import type { EtsForecastNode as EtsForecastNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function EtsForecastComponent({ data, emit }: NodeProps<EtsForecastNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "forecast", label: "Forecast", value: data.cachedForecast },
          { key: "interval", label: "± 95%", value: data.cachedInterval },
          { key: "detected", label: "Season used", value: data.cachedSeason },
        ]}
      />
    </NodeShell>
  );
}
