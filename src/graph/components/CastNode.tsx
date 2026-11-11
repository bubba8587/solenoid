// [[B11]] maximalMerge
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CastNode as CastNodeType } from "../nodeClasses";
import { CAST_OP_META, type CastOp } from "../nodeClasses";
import { dropInputCables } from "./cablePrune";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { InlineInputs } from "./inlineInput";
import { CardSection, useRowsInUse } from "./CardSection";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";
import { collapseStore } from "../collapseStore";
import { DateOrderToggle } from "./DateOrderToggle";

const SEPARATOR_KEYS = ["decimal_sep", "group_sep"];

const CAST_OP_OPTIONS = (Object.keys(CAST_OP_META) as CastOp[]).map((value) => ({
  value,
  label: <TypeIcon type={value} />,
  title: `${CAST_OP_META[value].label}: ${CAST_OP_META[value].title}`,
}));

async function applyCastOp(node: CastNodeType, op: CastOp): Promise<void> {
  if (node.op === op) return;
  const departing = node.keysDroppedBySwitch(op);
  if (departing.length > 0) await dropInputCables(node.id, departing);
  node.setOp(op);

  // Active graph: a Cast inside a drill-in retypes its own graph's cables.
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "result");

  if (view) await view.rerenderNode(node.id);
  node.edited(); await processGraph();
}

export function CastComponent({ data, emit }: NodeProps<CastNodeType>) {
  const [op, setOp] = useState<CastOp>(data.op);
  useEffect(() => { setOp(data.op); }, [data.op]);
  const seps = useRowsInUse(data, SEPARATOR_KEYS);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={collapsed ? undefined : Object.keys(data.inputs).filter((k) => !SEPARATOR_KEYS.includes(k))} />
      {op === "number" && !collapsed && (
        <CardSection label="Separators" className="solenoid-node__cast-seps" collapsible defaultOpen={seps} sockets={{ node: data, emit, keys: SEPARATOR_KEYS }}>
          <InlineInputs node={data} emit={emit} keys={SEPARATOR_KEYS} />
        </CardSection>
      )}
      <OpToggle
        value={op}
        options={CAST_OP_OPTIONS}
        onChange={(next) => { setOp(next); void applyCastOp(data, next); }}
      />
      {op === "date" && !collapsed && <DateOrderToggle node={data} />}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
