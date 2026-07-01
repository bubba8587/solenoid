import type { ChooseNode } from "../rete-nodes";
import type { NodeProps } from "./nodeKit";
import { NodeShell, ValueDisplay } from "./nodeKit";
import { ExtensibleInputs } from "./ExtensibleInputs";
import type { DisplayValue } from "./valueDisplayFormat";

// CHOOSE: a fixed `index` selector + an extensible set of value rows. The index
// row renders above; the `v*` rows get add/remove. `valueInputKeys()` keeps the
// pill/rows in sync with whatever rows currently exist.
export function ChooseComponent({ data, emit }: NodeProps<ChooseNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["index"]}
        valueKeys={data.valueInputKeys()}
      />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
