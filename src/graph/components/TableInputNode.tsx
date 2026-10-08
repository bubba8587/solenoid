// [[C58]] tableInputRawText, [[B11]] maximalMerge
import { useEffect, useState, type ReactNode } from "react";
import type { TableInputNode as TableInputNodeType, TableElemType } from "../rete-nodes";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { rawCellsToText } from "../nodes/matrix";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";
import { nodeDisplayName } from "../catalogUtils";
import { openArrayPopup } from "../valuePopup";
import type { TablePopupState } from "../tablePopupStore";
import { readChipPopupStyle } from "./chipStyle";
import { CardOpenButton } from "./CardOpenButton";

const TYPE_OPTIONS: ReadonlyArray<{ value: TableElemType; label: ReactNode; title: string }> = [
  { value: "number",  label: <TypeIcon type="number" />, title: "Number table" },
  { value: "string",  label: <TypeIcon type="string" />, title: "Text table" },
  { value: "date",    label: <TypeIcon type="date" />, title: "Date table" },
  { value: "logical", label: <TypeIcon type="logical" />, title: "Boolean table: TRUE or FALSE" },
];

/** An in-place retype drops the cables it can't feed and re-adapts downstream FCs itself. */
async function applyTableType(node: TableInputNodeType, dt: TableElemType): Promise<void> {
  if (!node.setDataType(dt)) return;
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "table");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

export function TableInputComponent({ data, emit }: NodeProps<TableInputNodeType>) {
  const [dt, setDt] = useState<TableElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);
  const popupOverrides: Partial<TablePopupState> = {
    data: data.rawCells().length ? data.rawCells() : [[""]],
    cellType: dt,
    onSaveRaw: (cells) => {
      data.tableText = rawCellsToText(cells);
      void processGraph(data.id);
    },
    ...(dt === "number"
      ? {
          unitTaggable: true,
          onSaveMatrixUnit: (u: string) => {
            data.unit = u;
            void processGraph(data.id);
          },
        }
      : {}),
  };
  function openEditor(el: HTMLElement) {
    const table = Array.isArray(data.cachedResult) && data.cachedResult.length ? data.cachedResult : [[0]];
    openArrayPopup(table, { label: nodeDisplayName(data), hostId: data.id, elem: dt, popupOverrides, ...readChipPopupStyle(el, "--sock-table") });
  }

  return (
    <NodeShell
      node={data}
      emit={emit}
    >
      <CardOpenButton label="Edit Table" onOpen={openEditor} />
      <SegToggle
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyTableType(data, next); }}
      />
      <TableDisplay
        table={data.cachedResult}
        label={nodeDisplayName(data)}
        elem={dt}
        kind={dt === "date" ? "date" : dt === "string" ? "text" : undefined}
        popupOverrides={popupOverrides}
      />
    </NodeShell>
  );
}
