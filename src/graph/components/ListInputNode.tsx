import { useEffect, useState } from "react";
import type { ListInputNode as ListInputNodeType, ListElemType } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { SolenoidSocket, canConnect } from "../sockets";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import type { DisplayValue } from "./valueDisplayFormat";
import { ArrayChip } from "./ArrayChip";
import { dropInputCables } from "./cablePrune";
import { listRowsFromCells } from "../literalEditors";

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
  const view = getActiveView();
  if (editor && view) {
    // The row INPUT sockets were retyped too, and retypeOutputCables only walks outputs.
    const inType = (node.valueSocket as SolenoidSocket).dataType;
    for (const c of [...editor.getConnections()]) {
      if (c.target !== node.id) continue;
      const outSock = editor.getNode(c.source)?.outputs?.[c.sourceOutput]?.socket;
      const outType = outSock instanceof SolenoidSocket ? outSock.dataType : undefined;
      if (!outType || !canConnect(outType, inType)) await editor.removeConnection(c.id);
    }
    await retypeOutputCables(editor, view, node.id, "list");
  }
  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

/** Rewrite the typed rows from the popup's one column: existing keys keep their order (and
 *  their cables), extra lines add rows, dropped lines remove rows (cables pruned first). */
export async function applyListRows(node: ListInputNodeType, rows: string[]): Promise<void> {
  const keys = Object.keys(node.inputs);
  const keep = keys.slice(0, rows.length);
  const departing = keys.slice(rows.length);
  if (departing.length > 0) await dropInputCables(node.id, departing);
  for (const k of departing) node.removeValueInput(k);
  keep.forEach((k, i) => { node.stringLiterals[k] = rows[i]; });
  for (let i = keep.length; i < rows.length; i++) node.stringLiterals[node.addValueInput()] = rows[i];
  if (rows.length === 0) node.addValueInput(); // a list keeps one row to type into
  await getActiveView()?.rerenderNode(node.id);
  await processGraph();
}

export function ListInputComponent({ data, emit }: NodeProps<ListInputNodeType>) {
  // Local mirror so the toggle re-renders on change; the handler swaps the socket types.
  const [dt, setDt] = useState<ListElemType>(data.dataType);
  useEffect(() => { setDt(data.dataType); }, [data.dataType]);
  // The popup editor (the Table / Frame / Cube Input surface): one raw column, a row per
  // typed line; Save rewrites the rows.
  const rows = Object.keys(data.inputs).map((k) => data.stringLiterals[k] ?? "");
  const popupOverrides = {
    title: data.label || "List Input",
    data: rows.length ? rows.map((r) => [r]) : [[""]],
    headers: [data.label || "List"],
    cellType: dt,
    list: false,
    fixedCols: true, // a list is one column; the popup offers ± Row only
    onSaveRaw: (cells: string[][]) => { void applyListRows(data, listRowsFromCells(cells)); },
  };

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle
        value={dt}
        options={TYPE_OPTIONS}
        onChange={(next) => { setDt(next); void applyListType(data, next); }}
      />
      <ExtensibleInputs node={data} emit={emit} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ValueDisplay value={data.cachedList as DisplayValue} />
        </div>
        <ArrayChip value={[[0]]} label={data.label || "List"} size="sm" elem={undefined} popupOverrides={popupOverrides} />
      </div>
    </NodeShell>
  );
}
