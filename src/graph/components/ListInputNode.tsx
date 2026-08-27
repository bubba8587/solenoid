import { useEffect, useState } from "react";
import type { ListInputNode as ListInputNodeType, ListElemType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { SolenoidSocket, canConnect } from "../sockets";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import type { DisplayValue } from "./valueDisplayFormat";

const TYPE_OPTIONS: ReadonlyArray<{ value: ListElemType; label: string; title: string }> = [
  { value: "number",  label: "Num",  title: "Number list" },
  { value: "string",  label: "Text", title: "Text list" },
  { value: "date",    label: "Date", title: "Date list" },
  { value: "logical", label: "Bool", title: "TRUE or FALSE list" },
];

/** Switch the list's element type in place — an in-place retype fires no connection
 *  event, so the cable drops and downstream FC re-adaptation must happen here. */
export async function applyListType(node: ListInputNodeType, dt: ListElemType): Promise<void> {
  if (!node.setDataType(dt)) return;
  // Active graph: a List Input inside a Composite drill-in retypes its own graph's cables.
  const editor = getActiveEditor();
  const area = getActiveArea();
  if (editor && area) {
    // The row INPUT sockets were retyped too, and retypeOutputCables only walks outputs.
    const inType = (node.valueSocket as SolenoidSocket).dataType;
    for (const c of [...editor.getConnections()]) {
      if (c.target !== node.id) continue;
      const outSock = editor.getNode(c.source)?.outputs?.[c.sourceOutput]?.socket;
      const outType = outSock instanceof SolenoidSocket ? outSock.dataType : undefined;
      if (!outType || !canConnect(outType, inType)) await editor.removeConnection(c.id);
    }
    await retypeOutputCables(editor, area, node.id, "list");
  }
  if (area) await area.rerenderNode(node.id);
  await processGraph();
}

export function ListInputComponent({ data, emit }: NodeProps<ListInputNodeType>) {
  // Local mirror so the toggle re-renders on change; the handler swaps the socket types.
  const [dt, setDt] = useState<ListElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyListType(data, next); }}
      />
      <ExtensibleInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
