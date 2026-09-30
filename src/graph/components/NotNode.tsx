import type { NotNode as NotNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const NotComponent = makeNodeComponent<NotNodeType>((n) => n.cachedResult);
