import type { ComplexUnpackNode as ComplexUnpackNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function ComplexUnpackComponent({ data, emit }: NodeProps<ComplexUnpackNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "re",  label: "Real",   value: data.cachedRe  },
          { key: "im",  label: "Imag",   value: data.cachedIm  },
          { key: "abs", label: "|z|",    value: data.cachedAbs },
          { key: "arg", label: "arg(z)", value: data.cachedArg },
        ]}
      />
    </NodeShell>
  );
}
