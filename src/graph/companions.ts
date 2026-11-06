// [[C76]] formulaPackDefault
// A card's companions land to its left, stacked top down, each cabled into the input it names.
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";
import type { View } from "./view";
import type { Companion } from "./AddNodeMenu";
import { GraphConnection } from "./graphModel";
import { SolenoidSocket } from "./sockets";
import { nodeNameStore } from "./nodeNameStore";

const GAP_X = 80;
const GAP_Y = 24;

export async function placeCompanions(
  editor: GraphEditor<Schemes>,
  view: Pick<View, "moveNode">,
  host: Schemes["Node"],
  at: { x: number; y: number },
  companions: Companion[],
): Promise<void> {
  let y = at.y;
  for (const c of companions) {
    const node = c.node as Schemes["Node"] & { width?: number; height?: number };
    await editor.addNode(node);
    nodeNameStore.ensure(node.id, node.constructor.name);
    await view.moveNode(node.id, { x: Math.round(at.x - (node.width ?? 240) - GAP_X), y: Math.round(y) });
    y += (node.height ?? 110) + GAP_Y;
    const src = node.outputs[c.output]?.socket;
    const tgt = host.inputs[c.input]?.socket;
    if (src instanceof SolenoidSocket && tgt instanceof SolenoidSocket && src.canConnectTo(tgt)) {
      await editor.addConnection(new GraphConnection(node, c.output, host, c.input) as Schemes["Connection"]);
    }
  }
}
