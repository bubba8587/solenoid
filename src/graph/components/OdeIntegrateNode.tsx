import type { OdeIntegrateNode as OdeIntegrateNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { FormulaBox, FormulaError, FORMULA_KEYS } from "./TableLambdaNodes";
import { nodeDisplayName } from "../catalogUtils";

export function OdeIntegrateComponent({ data, emit }: NodeProps<OdeIntegrateNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <FormulaBox node={data} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}
