// tree/specs/computation/probability-pack.md § Bootstrap
import { BOOTSTRAP_OP_META, type BootstrapNode as Node, type BootstrapOp } from "../nodes/probability";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { getOwningView } from "../activeGraph";
import { PLOT_H, Bars, Strip, pairs, px, scaleOf } from "./probabilityPlot";

const OPTIONS = (Object.keys(BOOTSTRAP_OP_META) as BootstrapOp[]).map((op) => ({
  value: op, label: BOOTSTRAP_OP_META[op].label, title: BOOTSTRAP_OP_META[op].description,
}));

type Out = "estimate" | "low" | "high";

export function BootstrapComponent({ data, emit }: NodeProps<Node>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pick(next: BootstrapOp) {
    if (next === data.op) return;
    data.setOp(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }

  const pts = pairs(data.plotX, data.plotY);
  const s = scaleOf([pts], pts.length > 1 ? (pts[1][0] - pts[0][0]) / 2 : 0.5);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const lo = num(data.cachedLow), hi = num(data.cachedHigh), est = num(data.cachedResult);
  const shown: Record<Out, typeof data.cachedResult> = { estimate: data.cachedResult, low: data.cachedLow, high: data.cachedHigh };

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect value={op} onChange={(o) => void pick(o)} options={OPTIONS} />
      <InlineInputs node={data} emit={emit} />
      <Strip>
        {s && lo != null && hi != null && <Bars s={s} pts={pts} inRange={(x) => x >= lo && x <= hi} />}
        {s && est != null && (
          <line x1={px(s, est)} x2={px(s, est)} y1={0} y2={PLOT_H} stroke="var(--text)" strokeWidth={1} strokeDasharray="3 2" />
        )}
      </Strip>
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={(["estimate", "low", "high"] as Out[]).map((key) => ({ key, label: data.outputs[key]?.label ?? "", value: shown[key] }))}
      />
    </NodeShell>
  );
}
