import {
  ElementNode as ElementNodeType,
  MolarMassNode as MolarMassNodeType,
  ELEMENT_BY_SYMBOL,
} from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { makeNodeComponent } from "./standardNode";
import { elementPicker } from "../elementPickerStore";
import { getActiveArea } from "../activeGraph";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

// The picker popup lives in App (ElementPicker.tsx, module store) because this
// card renders in rete's separate React root.
export function ElementComponent({ data, emit }: NodeProps<ElementNodeType>) {
  const el = ELEMENT_BY_SYMBOL.get(data.symbol)!;
  const openPicker = () => {
    elementPicker.open({
      symbol: data.symbol,
      onPick: (symbol) => {
        data.symbol = symbol;
        void getActiveArea()?.rerenderNode(data.id);
        void processGraph();
      },
    });
  };
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <button
        type="button"
        className="solenoid-node__select el-picker__open"
        onClick={(e) => { e.stopPropagation(); openPicker(); }}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        title="Search or pick from the periodic table"
      >
        {el.n} · {el.symbol} — {el.name}
      </button>
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "mass",   label: "G/MOL", value: el.mass },
          { key: "number", label: "Z",     value: el.n },
        ]}
      />
    </NodeShell>
  );
}

export const MolarMassComponent = makeNodeComponent<MolarMassNodeType>((n) => n.cachedResult);
