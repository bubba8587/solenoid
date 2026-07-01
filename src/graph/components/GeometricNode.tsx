import type { GeometricNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const GeometricComponent = makeNodeComponent<GeometricNode>((n) => n.cachedList);
