import { ConstantNode as ConstantNodeType, ConstantOp, CONSTANTS } from "../rete-nodes";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: ConstantOp; label: string }[] = Object.entries(CONSTANTS).map(
  ([value, meta]) => ({ value: value as ConstantOp, label: `${meta.symbol}  ${meta.label}` }),
);

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "−∞";
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(6).replace(/\.?0+$/, "");
}

export function ConstantComponent({ data, emit }: NodeProps<ConstantNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const meta = CONSTANTS[op];
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay
        value={meta.value}
        renderWins
        render={(v) => <><span style={{ marginRight: 6, color: "var(--text-dim)" }}>{meta.symbol}</span>{formatValue(v)}</>}
        toClipboard={(v) => String(v)}
      />
    </NodeShell>
  );
}
