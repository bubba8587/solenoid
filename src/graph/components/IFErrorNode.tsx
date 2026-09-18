import type { IFErrorNode as IFErrorNodeType, IFErrorMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const OPS: { value: IFErrorMode; label: string }[] = [
  { value: "iferror", label: "IFERROR: catch NaN / ±Infinity" },
  { value: "ifna",    label: "IFNA: catch a not-found null" },
];

export function IFErrorComponent({ data, emit }: NodeProps<IFErrorNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
