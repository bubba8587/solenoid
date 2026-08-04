import type { FillNode as FillNodeType, FillOp } from "../rete-nodes";
import { FILL_OP_META } from "../rete-nodes";
import { InlineInputs, useConnectedInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: FillOp; label: string }[] =
  (Object.keys(FILL_OP_META) as FillOp[]).map((value) => ({ value, label: FILL_OP_META[value].label }));

export function FillComponent({ data, emit }: NodeProps<FillNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const connected = useConnectedInputs(data.id);
  const elseKeys = Object.keys(data.inputs).filter((k) => /^e\d+$/.test(k));

  // Coalesce is N-ary: a typed number in an unwired Else row is a constant.
  if (op === "coalesce") {
    const leading = ["list", ...(connected.has("value") ? ["value"] : [])];
    return (
      <NodeShell node={data} emit={emit}>
        <ExtensibleInputs node={data} emit={emit} leadingKeys={leading} valueKeys={elseKeys} />
        <OpSelect value={op} onChange={setOp} options={OPS} />
        <ValueDisplay value={data.cachedList} />
      </NodeShell>
    );
  }

  // A WIRED socket must never disappear (its endpoint would dangle), so a
  // connected row stays visible in modes that don't use it.
  const keys = ["list"];
  if (op === "constant" || connected.has("value")) keys.push("value");
  for (const k of elseKeys) if (connected.has(k)) keys.push(k);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={keys} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
