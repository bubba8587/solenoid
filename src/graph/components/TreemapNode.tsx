import type { TreemapNode as TreemapNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TreemapView } from "./chartView";

const W = 218;
const H = 170;

export function TreemapComponent({ data, emit }: NodeProps<TreemapNodeType>) {
  const p = data.cachedPayload;
  const has = !!p && p.values.some((v) => v > 0);
  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ height: H, marginTop: 4 }}>
        {has
          ? <TreemapView names={p!.names} values={p!.values} width={W} height={H} />
          : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
    </NodeShell>
  );
}
