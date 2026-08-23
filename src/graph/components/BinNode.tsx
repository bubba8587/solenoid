import type { BinNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const BinComponent = makeNodeComponent<BinNode>((n) => n.cachedList);
