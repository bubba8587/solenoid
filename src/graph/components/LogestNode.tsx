import type { LogestNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const LogestComponent = makeNodeComponent<LogestNode>((n) => n.cachedList);
