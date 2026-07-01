import type { NumberValueNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const NumberValueComponent = makeNodeComponent<NumberValueNode>((n) => n.cachedResult);
