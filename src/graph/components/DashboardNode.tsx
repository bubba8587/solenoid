// [[B11]] maximalMerge, [[C95]] commitOnEnter
import { useSyncExternalStore } from "react";
import type { DashboardNode as DashboardNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { RecordLayoutField } from "./RecordLayoutField";
import { CardOpenButton } from "./CardOpenButton";
import { ReportRefRow } from "./ReportNode";
import { collapseStore } from "../collapseStore";
import { cableValueStore } from "../cableValueStore";
import { dashboardStore } from "../dashboardStore";
import { getOwningView } from "../activeGraph";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import "./ReportNode.css";

/** Every layout change, from the card's field or the dashboard's edit mode, lands through here. */
export async function commitDashboardLayout(node: DashboardNodeType, text: string, renames?: ReadonlyMap<string, string>): Promise<void> {
  await node.setLayout(text.trim() ? text : "", renames);
  node.edited();
  scheduleAutosave();
  await getOwningView(node.id)?.rerenderNode(node.id);
  await processGraph(node.id);
}

export function DashboardComponent({ data, emit }: NodeProps<DashboardNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const refKeys = data.refKeys();

  return (
    <NodeShell node={data} emit={emit}>
      <CardOpenButton label="Open Dashboard" onOpen={() => dashboardStore.open(data.id)} />
      {collapsed ? (
        <CollapsedInputPill node={data} emit={emit} keys={refKeys} />
      ) : (
        <>
          <RecordLayoutField value={data.layout} onCommit={(next) => void commitDashboardLayout(data, next)} />
          {refKeys.length > 0 && <div className="solenoid-node__section-divider" />}
          {refKeys.map((key) => (
            <ReportRefRow key={key} data={data} emit={emit} refKey={key} label={key} value={data.refValue(key)} />
          ))}
        </>
      )}
    </NodeShell>
  );
}
