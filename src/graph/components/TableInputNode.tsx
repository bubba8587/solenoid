import { useCallback } from "react";
import type { TableInputNode as TableInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { tableToText } from "../nodes/matrix";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";

// Like a scalar Input node, the Table Input has a single value box — here the
// result box doubles as the editor: its chip opens the grid popup (editable), and
// Save writes the matrix back as the node's text. No separate text entry box.
export function TableInputComponent({ data, emit }: NodeProps<TableInputNodeType>) {
  const onSave = useCallback((next: (number | null)[][]) => {
    data.tableText = tableToText(next);
    void processGraph(data.id);
  }, [data]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Table">
      <TableDisplay table={data.cachedResult} label={data.label} onSave={onSave} />
    </NodeShell>
  );
}
