import { InlineInputs, type InlineNode } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps, type OpOption, type ShellNode } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveView } from "../activeGraph";
import { processGraph } from "../process";

interface SpecOpNode<Op extends string> {
  id: string;
  op: Op;
  cachedResult: number | null;
  keysDroppedBySwitch(next: Op): string[];
  setOp(next: Op): void;
}

/** The card for a spec-table op family (finance.ts § Spec-table op cards): a grouped op
 *  dropdown, the op's inputs, one result. The switch prunes the departing sockets'
 *  cables BEFORE the node reshapes (onePrunePath). */
export function makeSpecOpComponent<Op extends string, N extends SpecOpNode<Op> & ShellNode & InlineNode>(
  meta: Record<Op, { label: string; description: string; group: string }>,
) {
  const OPS: ReadonlyArray<OpOption<Op>> = (Object.keys(meta) as Op[]).map((op) => ({
    value: op, label: meta[op].label, title: meta[op].description, group: meta[op].group,
  }));
  return function SpecOpComponent({ data, emit }: NodeProps<N>) {
    const [op, setOpField] = useNodeField(data, "op");

    async function pickOp(next: Op) {
      if (next === data.op) return;
      const departing = data.keysDroppedBySwitch(next);
      if (departing.length > 0) await dropInputCables(data.id, departing);
      data.setOp(next);
      await getActiveView()?.rerenderNode(data.id);
      setOpField(next);
      await processGraph();
    }

    return (
      <NodeShell node={data} emit={emit}>
        <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
        <InlineInputs node={data} emit={emit} />
        <ValueDisplay value={data.cachedResult} />
      </NodeShell>
    );
  };
}
