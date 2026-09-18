// [[C27]] noDataInComponents
import type { MirrNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const MirrComponent = makeNodeComponent<MirrNode>((n) => n.cachedResult);
