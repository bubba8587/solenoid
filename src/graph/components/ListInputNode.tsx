// [[D93]] oneTextReading, [[B11]] maximalMerge, [[C26]] opArgDistinct (the type toggle is an argument)
import { useEffect, useState, type ReactNode } from "react";
import type { ListInputNode as ListInputNodeType, ListElemType } from "../nodeClasses";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeInputCables, retypeOutputCables } from "../fcReconcile";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";
import type { DisplayValue } from "./valueDisplayFormat";

const TYPE_OPTIONS: ReadonlyArray<{ value: ListElemType; label: ReactNode; title: string }> = [
  { value: "number",  label: <TypeIcon type="number" />, title: "Number list" },
  { value: "string",  label: <TypeIcon type="string" />, title: "Text list" },
  { value: "date",    label: <TypeIcon type="date" />, title: "Date list" },
  { value: "logical", label: <TypeIcon type="logical" />, title: "Boolean list: TRUE or FALSE" },
];

async function applyListType(node: ListInputNodeType, dt: ListElemType): Promise<void> {
  if (!node.setDataType(dt)) return;
  // Active graph: a List Input inside a drill-in retypes its own graph's cables.
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) {
    // The row input sockets were retyped too, and retypeOutputCables only walks outputs.
    for (const key of new Set(editor.getConnections().filter((c) => c.target === node.id).map((c) => c.targetInput))) {
      await retypeInputCables(editor, view, node.id, key);
    }
    await retypeOutputCables(editor, view, node.id, "list");
  }
  if (view) await view.rerenderNode(node.id);
  node.edited(); await processGraph();
}

export function ListInputComponent({ data, emit }: NodeProps<ListInputNodeType>) {
  const [dt, setDt] = useState<ListElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyListType(data, next); }}
      />
      <ExtensibleInputs node={data} emit={emit} />
      <ValueDisplay
        value={data.cachedList as DisplayValue}
        popupOverrides={data.cachedSource.some((t) => t !== null) ? { sourceCells: [data.cachedSource] } : undefined}
      />
    </NodeShell>
  );
}
