import { useCallback, useState } from "react";
import { SlicerNode, type SlicerCell } from "../nodes/control";
import { NodeShell, OpSelect, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { processGraph } from "../process";
import { formatScalar } from "./format";
import "./SlicerNode.css";

function label(v: SlicerCell): string {
  return typeof v === "number" ? formatScalar(v) : v;
}

// Intelligent sizing: long values / many values need a wider card. The classes
// override the default frame "wide" tier via higher specificity (see CSS).
function widthClass(vals: SlicerCell[]): string | undefined {
  if (vals.length === 0) return undefined;
  const maxLen = vals.reduce<number>((m, v) => Math.max(m, label(v).length), 0);
  const n = vals.length;
  if (maxLen > 18 || n > 30) return "solenoid-node--slicer-w3";
  if (maxLen > 9 || n > 10) return "solenoid-node--slicer-w2";
  return undefined;
}

export function SlicerComponent({ data, emit }: NodeProps<SlicerNode>) {
  // Selection / column / mode are React state mirrored onto the instance (the
  // controlled UI). The unique values + column list are recomputed by data() and
  // read straight off the instance — processGraph re-renders the node each run.
  const [selected, setSelected] = useState<SlicerCell[]>(data.selectedValues);
  const [multiSelect, setMultiSelect] = useState(data.multiSelect);
  const [column, setColumn] = useState(data.selectedColumn);

  const columns = data.cachedColumns;
  const uniqueVals = data.cachedUniqueValues;
  // Resolve the displayed column the same way data() does (selected if it still
  // exists, else the first), so the dropdown and the buttons always agree.
  const activeColumn = column && columns.includes(column) ? column : columns[0] ?? "";

  const isSelected = useCallback(
    (v: SlicerCell) => selected.length === 0 || selected.some((x) => x === v),
    [selected],
  );

  const toggleValue = useCallback(
    (v: SlicerCell) => {
      let next: SlicerCell[];
      if (multiSelect) {
        const inSet = selected.some((x) => x === v);
        if (inSet) {
          next = selected.filter((x) => x !== v);
        } else {
          next = [...selected, v];
          if (next.length === uniqueVals.length) next = []; // all → "all" sentinel
        }
      } else {
        const alreadySolo = selected.length === 1 && selected[0] === v;
        next = alreadySolo ? [] : [v];
      }
      setSelected(next);
      data.selectedValues = next;
      void processGraph(data.id);
    },
    [selected, multiSelect, uniqueVals.length, data],
  );

  const changeColumn = useCallback(
    (next: string) => {
      setColumn(next);
      data.selectedColumn = next;
      // A new column's values are unrelated to the old selection — reset it.
      setSelected([]);
      data.selectedValues = [];
      void processGraph(data.id);
    },
    [data],
  );

  const toggleMultiSelect = useCallback(() => {
    const next = !multiSelect;
    setMultiSelect(next);
    data.multiSelect = next;
  }, [multiSelect, data]);

  const hasFrame = columns.length > 0;
  const allSelected = selected.length === 0;
  const selCount = allSelected ? uniqueVals.length : selected.length;

  return (
    <NodeShell node={data} emit={emit} collapsible={false} labelPlaceholder="Slicer" className={widthClass(uniqueVals)}>
      <InlineInputs node={data} emit={emit} />
      <div className="slicer-node">
        <div className="slicer-node__toolbar">
          {hasFrame ? (
            <OpSelect
              value={activeColumn}
              onChange={changeColumn}
              options={columns.map((c) => ({ value: c, label: c }))}
            />
          ) : (
            <span className="slicer-node__count">No frame</span>
          )}
          <button
            className={`slicer-node__multiselect${multiSelect ? " slicer-node__multiselect--on" : ""}`}
            onClick={toggleMultiSelect}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            title="Toggle multi-select"
          >
            multi
          </button>
        </div>
        {hasFrame && (
          <div className="slicer-node__subbar">
            <span className="slicer-node__count">
              {uniqueVals.length === 0 ? "No values" : `${selCount} / ${uniqueVals.length}`}
            </span>
          </div>
        )}
        <div
          className="slicer-node__values"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!hasFrame ? (
            <span className="slicer-node__empty">Wire a Frame to slice</span>
          ) : uniqueVals.length === 0 ? (
            <span className="slicer-node__empty">Column has no values</span>
          ) : (
            uniqueVals.map((v) => (
              <button
                key={String(v)}
                className={`slicer-node__pill${isSelected(v) ? " slicer-node__pill--selected" : ""}`}
                title={label(v)}
                onClick={() => toggleValue(v)}
              >
                {label(v)}
              </button>
            ))
          )}
        </div>
      </div>
    </NodeShell>
  );
}
