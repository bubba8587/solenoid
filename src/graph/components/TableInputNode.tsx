import { useEffect, useState } from "react";
import type { TableInputNode as TableInputNodeType, TableElemType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { rawCellsToText, TABLE_ELEM_SOCKET } from "../nodes/matrix";
import { SOCKET_COLORS } from "../sockets";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";

const TYPE_OPTIONS: ReadonlyArray<{ value: TableElemType; label: string; title: string }> = [
  { value: "number",  label: "Num",  title: "Number table" },
  { value: "string",  label: "Text", title: "Text table" },
  { value: "date",    label: "Date", title: "Date table" },
  { value: "logical", label: "Bool", title: "TRUE / FALSE table" },
];

/** Switch the table's element type in place — the List Input pattern: re-type
 *  the output socket, drop downstream cables the new type can't feed, re-adapt
 *  downstream Format Controllers, recompute. */
async function applyTableType(node: TableInputNodeType, dt: TableElemType): Promise<void> {
  if (!node.setDataType(dt)) return;
  const editor = getActiveEditor();
  const area = getActiveArea();
  if (editor && area) await retypeOutputCables(editor, area, node.id, "table");
  if (area) await area.update("node", node.id);
  await processGraph();
}

// A LITERAL source, like Frame Input: the grid popup edits the RAW text cells
// (via onSaveRaw — Source is the editable truth, Formatted the derived preview),
// so a bad cell is never silently coerced away; it derives to NaN (dirty data)
// and the Source view still shows what was typed.
export function TableInputComponent({ data, emit }: NodeProps<TableInputNodeType>) {
  // Local mirror so the toggle re-renders on change; the handler swaps the socket type.
  const [dt, setDt] = useState<TableElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);

  return (
    <NodeShell
      node={data}
      emit={emit}
      labelPlaceholder="Table"
      // Header accent tracks the element family, matching the output socket.
      accentOverride={SOCKET_COLORS[TABLE_ELEM_SOCKET[dt].dataType]}
    >
      <SegToggle
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyTableType(data, next); }}
      />
      <TableDisplay
        table={data.cachedResult}
        label={data.label}
        elem={dt}
        kind={dt === "date" ? "date" : dt === "string" ? "text" : undefined}
        popupOverrides={{
          data: data.rawCells().length ? data.rawCells() : [[""]],
          cellType: dt,
          onSaveRaw: (cells) => {
            data.tableText = rawCellsToText(cells);
            void processGraph(data.id);
          },
          // A NUMBER table is a unit-taggable source (D20), like a Frame Input
          // column: the matrix bar's unit dropdown writes the homogeneous unit onto
          // the node so it rides the value downstream. (formatControls/columnUnits
          // are derived from the tagged cachedResult by the chip.)
          ...(dt === "number"
            ? {
                unitTaggable: true,
                onSaveMatrixUnit: (u: string) => {
                  data.unit = u;
                  void processGraph(data.id);
                },
              }
            : {}),
        }}
      />
    </NodeShell>
  );
}
