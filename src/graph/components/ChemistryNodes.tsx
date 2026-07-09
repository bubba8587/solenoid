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

// The Element card: one button showing the pick (`26 · Fe — Iron`) that opens
// the picker popup (search + clickable periodic table) — 118 entries outgrew a
// dropdown. The popup lives in App (ElementPicker.tsx, module store), since
// this card renders in rete's separate React root.
export function ElementComponent({ data, emit }: NodeProps<ElementNodeType>) {
  const el = ELEMENT_BY_SYMBOL.get(data.op)!;
  const openPicker = () => {
    elementPicker.open({
      symbol: data.op,
      onPick: (symbol) => {
        data.op = symbol;
        void getActiveArea()?.update("node", data.id);
        void processGraph();
      },
    });
  };
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <button
        type="button"
        className="solenoid-node__op-select el-picker__open"
        onClick={(e) => { e.stopPropagation(); openPicker(); }}
        onPointerDown={(e) => e.stopPropagation()}
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
