import type { CubeInputNode as CubeInputNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { CubeDisplay } from "./CubeDisplay";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { nodeDisplayName } from "../catalogUtils";
import { parseCubeSource, cubeSourceToText, type CubeSource } from "../literalEditors";
import { cubePopup, type CubeEditBinding } from "../cubePopupStore";

// [[C28]] literalsIffEditable
export function CubeInputComponent({ data, emit }: NodeProps<CubeInputNodeType>) {
  const source = (): CubeSource => { const p = parseCubeSource(data.cubeText); return "source" in p ? p.source : { columns: [], rows: [] }; };
  const edit: CubeEditBinding = {
    source,
    save: (next) => {
      data.cubeText = cubeSourceToText(next);
      scheduleAutosave();
      // The popup shows the card's answer, which the pass recomputes.
      void processGraph().then(() => cubePopup.refresh());
    },
    cube: () => data.cachedResult,
  };
  return (
    <NodeShell node={data} emit={emit}>
      <CubeDisplay cube={data.cachedResult} label={nodeDisplayName(data)} edit={edit} />
    </NodeShell>
  );
}
