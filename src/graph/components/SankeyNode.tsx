import type { SankeyNode as SankeyNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SankeyView } from "./chartView";

const W = 238;
const H = 170;

export function SankeyComponent({ data, emit }: NodeProps<SankeyNodeType>) {
  const p = data.cachedPayload;
  const has = !!p && p.values.some((v) => v > 0) && p.sources.length > 0;
  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ height: H, marginTop: 4 }}>
        {has
          ? <SankeyView sources={p!.sources} targets={p!.targets} values={p!.values} width={W} height={H} />
          : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
    </NodeShell>
  );
}
