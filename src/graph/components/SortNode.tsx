import { useState } from "react";
import type { SortNode as SortNodeType, SortDir } from "../rete-nodes";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveView } from "../activeGraph";
import { useConnectedInputs, InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import { dropInputCables } from "./cablePrune";
import type { DisplayValue } from "./valueDisplayFormat";

const DIRS: { value: SortDir; label: string }[] = [
  { value: "asc",  label: "Ascending ↑" },
  { value: "desc", label: "Descending ↓" },
];
type Axis = "rows" | "cols";
const AXES: { value: Axis; label: string; title: string }[] = [
  { value: "rows", label: "Rows",    title: "Sort the rows by one column, as Excel's SORT does" },
  { value: "cols", label: "Columns", title: "Sort the columns by one row; a list's items are its columns" },
];

// SORT sorts by the card's own values; each key row is one of SORTBY's by_arrays with its own order.
export function SortComponent({ data, emit }: NodeProps<SortNodeType>) {
  const connected = useConnectedInputs(data.id);
  const [order, setOrder] = useNodeField(data, "order");
  const [axis, setAxisState] = useState<Axis>(data.byCol ? "cols" : "rows");
  const [keyOrder, setKeyOrder] = useState<Record<string, SortDir>>(() => ({ ...data.keyOrder }));
  const keys = data.valueInputKeys();

  async function setAxis(next: Axis) {
    data.setByCol(next === "cols");
    setAxisState(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }
  const setKeyDir = (id: string, dir: SortDir) => {
    data.keyOrder[id] = dir;
    setKeyOrder((o) => ({ ...o, [id]: dir }));
    void processGraph();
  };
  async function addKey() {
    data.addValueInput();
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }
  async function removeKey(key: string) {
    await dropInputCables(data.id, [key]);
    data.removeValueInput(key);
    await getActiveView()?.rerenderNode(data.id);
    bumpConnectionVersion();
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["list", "index"]} />
      {/* Keys decide the order and the direction once there are any, so the card's own pair would do nothing. */}
      {keys.length === 0 && (
        <>
          <SegToggle value={axis} options={AXES} onChange={(v) => void setAxis(v)} />
          <ArgSelect value={order} onChange={setOrder} options={DIRS} />
        </>
      )}
      {keys.map((key) => {
        const id = key.slice(3);
        return (
          <div key={key} className="solenoid-node__pair-group">
            <ArgSelect value={keyOrder[id] ?? data.keyOrder[id] ?? "asc"} options={DIRS} onChange={(d) => setKeyDir(id, d)} />
            <MeasuredSocketRow side="input" socketKey={key} nodeId={data.id} emit={emit} payload={data.inputs[key]!.socket}>
              <span className="solenoid-node__io-label">{data.inputs[key]!.label}</span>
              {connected.has(key) && <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>}
              <button
                type="button"
                className="solenoid-node__row-remove"
                title="Remove this sort key"
                onClick={(e) => { e.stopPropagation(); void removeKey(key); }}
              >
                ×
              </button>
            </MeasuredSocketRow>
          </div>
        );
      })}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addKey(); }}
      >
        Add Sort Key
      </button>
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
