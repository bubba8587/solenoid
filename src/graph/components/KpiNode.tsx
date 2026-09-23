import type { KpiNode as KpiNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ChartFigure } from "./chartView";
import type { ChartValue } from "../chartValue";

export function KpiComponent({ data, emit }: NodeProps<KpiNodeType>) {
  const payload = data.cachedPayload;
  const cv: ChartValue = {
    __chart: true, op: "kpi", values: null, payload: payload ?? undefined,
    options: data.chartOptions, title: data.chartOptions.title || data.label || "KPI",
  };
  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      {payload
        ? <ChartFigure value={cv} width={data.width - 22} height={120} />
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
