// [[C127]] pivotView
import { useState, useSyncExternalStore } from "react";
import { PivotTableView } from "./PivotTableView";
import { fmtCell } from "./FrameDisplay";
import { frameFormatStore } from "../frameFormatStore";
import { getPivotHostAction } from "../tablePopupStore";
import { DEFAULT_PIVOT_VIEW, livePivotFolds, pivotAddress, type PivotLayout, type PivotViewOptions } from "../pivotLayout";
import { isSolError } from "../errorValue";
import type { FrameValue } from "../frame";

/** A PIVOTBY output where a Dashboard box or a Report shows a value: the popup's Pivot view in the Pivot node's own
 *  options, without the ribbon. A fold here is the node's, as in the popup. */
export function PivotFigure({ frame, layout, sourceId }: { frame: FrameValue; layout: PivotLayout; sourceId?: string }) {
  useSyncExternalStore(frameFormatStore.subscribe, frameFormatStore.version);
  const host = sourceId ? getPivotHostAction()?.find(sourceId) ?? null : null;
  const [options, setOptions] = useState<PivotViewOptions>(() => {
    const seeded = host?.view ?? DEFAULT_PIVOT_VIEW;
    return { ...seeded, collapsed: livePivotFolds(layout, seeded.collapsed) };
  });
  const onOptions = (next: PivotViewOptions) => { setOptions(next); host?.setView(next); };
  // The totals ride on the layout, the rest is the Frame's ([[C127]] pivotView).
  const addr = pivotAddress(layout);
  const at = (r: number, c: number) => addr.cell(r, c, (or, oc) => frame.columns[oc]?.values[or] ?? null);
  const cellText = (r: number, c: number): string => {
    const col = frame.columns[addr.styleCol(c)];
    if (!col) return "";
    const ann = (sourceId ? frameFormatStore.get(sourceId, col.name) : undefined) ?? col.format;
    return fmtCell(at(r, c) ?? null, col.type, ann);
  };
  return (
    <div className="pivot-figure">
      <PivotTableView
        layout={layout}
        options={options}
        onOptions={onOptions}
        cellText={cellText}
        isErrorAt={(r, c) => isSolError(at(r, c))}
        query=""
        ribbon={null}
      />
    </div>
  );
}
