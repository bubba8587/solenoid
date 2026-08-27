import type {
  TodayNowNode as TodayNowNodeType,
  DateConstructNode as DateConstructNodeType,
  TimeConstructNode as TimeConstructNodeType,
  DateTimeValueNode as DateTimeValueNodeType,
  DatePartNode as DatePartNodeType,
  WeekInfoNode as WeekInfoNodeType,
  DateDiffNode as DateDiffNodeType,
  DateAddNode as DateAddNodeType,
  WorkdaysNode as WorkdaysNodeType,
  TodayNowOp, DateTimeValueOp, DatePartOp, WeekInfoOp, DateDiffOp, DateAddOp, WorkdaysOp,
} from "../rete-nodes";
import {
  TODAY_NOW_OP_META, DATE_TIME_VALUE_OP_META, DATE_PART_OP_META, WEEK_INFO_OP_META,
  DATE_DIFF_OP_META, DATE_ADD_OP_META, WORKDAYS_OP_META, dateDiffNeedsBasis,
} from "../rete-nodes";
import { getActiveArea, getActiveEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { InlineInputs } from "./inlineInput";
import { RecalcButton } from "./RecalcButton";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";

// Date nodes never format their own serials — ValueDisplay does it for any date-typed
// output socket, so scalars and lists format consistently.

const TODAY_NOW_OPS = (Object.keys(TODAY_NOW_OP_META) as TodayNowOp[]).map(op => ({
  value: op, label: TODAY_NOW_OP_META[op].label,
}));

export function TodayNowComponent({ data, emit }: NodeProps<TodayNowNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: TodayNowOp) {
    setOp(next);
    setLabel(TODAY_NOW_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={handleOp} options={TODAY_NOW_OPS} />
      <ValueDisplay value={data.cachedResult} />
      <RecalcButton title="Refresh to current date/time" />
    </NodeShell>
  );
}

export function DateConstructComponent({ data, emit }: NodeProps<DateConstructNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

export function TimeConstructComponent({ data, emit }: NodeProps<TimeConstructNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const DATE_TIME_VALUE_OPS = (Object.keys(DATE_TIME_VALUE_OP_META) as DateTimeValueOp[]).map(op => ({
  value: op, label: DATE_TIME_VALUE_OP_META[op].label,
}));

export function DateTimeValueComponent({ data, emit }: NodeProps<DateTimeValueNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");

  async function pickOp(next: DateTimeValueOp) {
    if (next === data.op) return;
    data.setOp(next);
    // The output retyped in place (date ↔ number): drop cables the new type
    // can't feed, and let docked FCs re-resolve — no connection event fires.
    const editor = getActiveEditor();
    const area = getActiveArea();
    if (editor && area) await retypeOutputCables(editor, area, data.id, "result");
    if (area) await area.rerenderNode(data.id);
    setOpField(next);
    setLabel(DATE_TIME_VALUE_OP_META[next].label);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={DATE_TIME_VALUE_OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const DATE_PART_OPS = (Object.keys(DATE_PART_OP_META) as DatePartOp[]).map(op => ({
  value: op, label: DATE_PART_OP_META[op].label,
}));

export function DatePartComponent({ data, emit }: NodeProps<DatePartNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: DatePartOp) {
    setOp(next);
    setLabel(DATE_PART_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={DATE_PART_OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const WEEK_INFO_OPS = (Object.keys(WEEK_INFO_OP_META) as WeekInfoOp[]).map(op => ({
  value: op, label: WEEK_INFO_OP_META[op].label,
}));

export function WeekInfoComponent({ data, emit }: NodeProps<WeekInfoNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: WeekInfoOp) {
    setOp(next);
    setLabel(WEEK_INFO_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={WEEK_INFO_OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const DATE_DIFF_OPS = (Object.keys(DATE_DIFF_OP_META) as DateDiffOp[]).map(op => ({
  value: op, label: DATE_DIFF_OP_META[op].label,
  group: dateDiffNeedsBasis(op) || op === "days" ? "Day count" : "Calendar (DATEDIF)",
}));

export function DateDiffComponent({ data, emit }: NodeProps<DateDiffNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  async function handleOp(next: DateDiffOp) {
    // removeInput while a cable still references the socket is unsafe, so drop it first.
    if (!dateDiffNeedsBasis(next) && data.inputs.basis) {
      await dropInputCables(data.id, ["basis"]);
    }
    setOp(next); // sets data.op + reconciles + recomputes (useNodeField)
    setLabel(DATE_DIFF_OP_META[next].label);
    if (data.syncBasisInput()) await getActiveArea()?.rerenderNode(data.id);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={DATE_DIFF_OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const DATE_ADD_OPS = (Object.keys(DATE_ADD_OP_META) as DateAddOp[]).map(op => ({
  value: op, label: DATE_ADD_OP_META[op].label,
}));

export function DateAddComponent({ data, emit }: NodeProps<DateAddNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: DateAddOp) {
    setOp(next);
    setLabel(DATE_ADD_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={DATE_ADD_OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const WORKDAYS_OPS = (Object.keys(WORKDAYS_OP_META) as WorkdaysOp[]).map(op => ({
  value: op, label: WORKDAYS_OP_META[op].label,
}));

export function WorkdaysComponent({ data, emit }: NodeProps<WorkdaysNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: WorkdaysOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    // The output retyped in place (date ↔ number): drop cables the new type
    // can't feed, and let docked FCs re-resolve — no connection event fires.
    const editor = getActiveEditor();
    const area = getActiveArea();
    if (editor && area) await retypeOutputCables(editor, area, data.id, "result");
    if (area) await area.rerenderNode(data.id);
    setOpField(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={WORKDAYS_OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

