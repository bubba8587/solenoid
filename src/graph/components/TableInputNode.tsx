import { useEffect, useState } from "react";
import type { TableInputNode as TableInputNodeType, TableElemType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { rawCellsToText } from "../nodes/matrix";
import { TableDisplay } from "./TableDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { nodeDisplayName } from "../catalogUtils";

const TYPE_OPTIONS: ReadonlyArray<{ value: TableElemType; label: string; title: string }> = [
  { value: "number",  label: "Num",  title: "Number table" },
  { value: "string",  label: "Text", title: "Text table" },
  { value: "date",    label: "Date", title: "Date table" },
  { value: "logical", label: "Bool", title: "TRUE / FALSE table" },
];

/** Switch the element type in place (the List Input pattern): an in-place retype
 *  must drop the cables it can't feed and re-adapt downstream FCs itself. */
async function applyTableType(node: TableInputNodeType, dt: TableElemType): Promise<void> {
  if (!node.setDataType(dt)) return;
  const editor = getActiveEditor();
  const view = getActiveView();
  if (editor && view) await retypeOutputCables(editor, view, node.id, "table");
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

// A LITERAL source (tableInputRawText): the popup edits the RAW text cells, so a bad cell is
// never coerced away — it derives to NaN and Source still shows what was typed.
export function TableInputComponent({ data, emit }: NodeProps<TableInputNodeType>) {
  const [dt, setDt] = useState<TableElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);

  return (
    <NodeShell
      node={data}
      emit={emit}
    >
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
        popupOverrides={{
          data: data.rawCells().length ? data.rawCells() : [[""]],
          cellType: dt,
          onSaveRaw: (cells) => {
            data.tableText = rawCellsToText(cells);
            void processGraph(data.id);
          },
          // A NUMBER table is a unit-taggable source (unitGranularity): the unit dropdown
          // writes the homogeneous unit onto the node so it rides the value.
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
