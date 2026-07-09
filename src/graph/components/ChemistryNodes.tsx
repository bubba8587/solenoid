import {
  ElementNode as ElementNodeType,
  MolarMassNode as MolarMassNodeType,
  ELEMENTS, ELEMENT_BY_SYMBOL,
} from "../rete-nodes";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { makeNodeComponent } from "./standardNode";

const ELEMENT_OPS = ELEMENTS.map((e) => ({
  value: e.symbol,
  label: `${e.n}  ${e.symbol} — ${e.name}`,
  group: `Period ${e.period}`,
}));

export function ElementComponent({ data, emit }: NodeProps<ElementNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const el = ELEMENT_BY_SYMBOL.get(op)!;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect value={op} onChange={setOp} options={ELEMENT_OPS} />
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
