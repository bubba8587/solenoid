// [[B19]] spreadsheetHabits, [[categorize]]
import type { MouseEvent } from "react";
import type { CategorizeNode as CategorizeNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { FrameDisplay } from "./FrameDisplay";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import { categorizeEditor } from "../categorizeEditorStore";
import { categoryOf } from "../categorizeConfig";
import { readChipPopupStyle } from "./chipStyle";
import { stopDragStart } from "../coarse";

function summary(n: CategorizeNodeType): string {
  const total = n.sortItems.length;
  if (!total) return "No items yet";
  const sorted = n.sortItems.filter(([k]) => { const c = categoryOf(n.assigned, k); return c !== null && n.sortCategories.includes(c); }).length;
  return sorted === total ? `All ${total} items sorted` : `${sorted} of ${total} items sorted`;
}

export function CategorizeComponent({ data, emit }: NodeProps<CategorizeNodeType>) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const { accent } = readChipPopupStyle(e.currentTarget);
    categorizeEditor.open({ node: data, title: nodeDisplayName(data), accent });
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <button type="button" className="solenoid-node__pivot-config" onClick={open} onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}>
        Sort Items…
      </button>
      <div className="solenoid-node__pivot-summary">{summary(data)}</div>
      <FrameDisplay frame={previewed(() => data.cachedResult)} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
