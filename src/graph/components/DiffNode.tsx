import type { DiffNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const DiffComponent = makeNodeComponent<DiffNode>((n) => n.cachedList);
