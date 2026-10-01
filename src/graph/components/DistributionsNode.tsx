// [[B11]]
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getOwningView } from "../activeGraph";
import {
  DIST_SPECS, DIST_FORM_META,
  type DistributionsNode as DistributionNodeType, type DistKey, type DistForm,
} from "../nodes/distribution";

const DIST_OPTIONS = (Object.keys(DIST_SPECS) as DistKey[]).map((op) => ({
  value: op, label: DIST_SPECS[op].label, group: DIST_SPECS[op].group,
}));

export function DistributionsComponent({ data, emit }: NodeProps<DistributionNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  const [form, setFormField] = useNodeField(data, "form");

  async function pickDist(next: DistKey) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    setFormField(data.form); // the switch may have remapped the form
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }

  async function pickForm(next: DistForm) {
    if (next === data.form) return;
    const departing = data.keysDroppedByForm(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setForm(next);
    if (departing.length > 0) await getOwningView(data.id)?.rerenderNode(data.id);
    setFormField(next);
  }

  const spec = DIST_SPECS[op];
  const formOptions = spec.forms.map((f) => ({ value: f, label: DIST_FORM_META[f].label }));
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickDist(o)} options={DIST_OPTIONS} />
      <ArgSelect value={form} onChange={(f) => void pickForm(f)} options={formOptions} />
      <InlineInputs
        node={data}
        emit={emit}
        keys={data.inputKeys}
      />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
