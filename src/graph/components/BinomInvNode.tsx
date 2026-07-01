import type { BinomInvNode } from "../nodes/dist-discrete";
import { makeNodeComponent } from "./standardNode";

export const BinomInvComponent = makeNodeComponent<BinomInvNode>((n) => n.cachedResult);
