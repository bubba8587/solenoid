import type { IFErrorNode as IFErrorNodeType, IFErrorMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const OPS: { value: IFErrorMode; label: string }[] = [
  { value: "iferror", label: "IFERROR — catch NaN / ±Infinity" },
  { value: "ifna",    label: "IFNA — catch null (not found)" },
];

export function IFErrorComponent({ data, emit }: NodeProps<IFErrorNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={mode} onChange={setMode} options={OPS} />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
