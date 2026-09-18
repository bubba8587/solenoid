import type { TemplateNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TemplateComponent = makeNodeComponent<TemplateNode>((n) => n.cachedText);
