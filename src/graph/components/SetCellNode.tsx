import type { SetCellNode as SetCellNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import { TableDisplay } from "./TableDisplay";

export function SetCellComponent({ data, emit }: NodeProps<SetCellNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      {/* Table on top, then the extensible (Value, Row, Column) rows. */}
      <PairedExtensibleInputs node={data} emit={emit} leadingKeys={["matrix"]} rowNoun="row" />
      {/* Element-agnostic: the result carries whatever family the input table held. */}
      <TableDisplay table={data.cachedResult} label={data.label} elem={undefined} />
    </NodeShell>
  );
}
