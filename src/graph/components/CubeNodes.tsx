import type { BuildCubeNode as BuildCubeNodeType, NestJoinNode as NestJoinNodeType, CubeColumnsNode as CubeColumnsNodeType, CubeRollupNode as CubeRollupNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { CubeDisplay } from "./CubeDisplay";
import { FrameDisplay } from "./FrameDisplay";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { AGG_OP_OPTIONS } from "./FrameNodes";

export function BuildCubeComponent({ data, emit }: NodeProps<BuildCubeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["name"]}
        valueKeys={data.valueInputKeys()}
      />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function NestJoinComponent({ data, emit }: NodeProps<NestJoinNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function CubeColumnsComponent({ data, emit }: NodeProps<CubeColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["names"]}
        valueKeys={data.valueInputKeys()}
      />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

export function CubeRollupComponent({ data, emit }: NodeProps<CubeRollupNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} options={AGG_OP_OPTIONS} onChange={setOp} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
