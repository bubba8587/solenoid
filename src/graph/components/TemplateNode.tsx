import type { TemplateNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TemplateComponent = makeNodeComponent<TemplateNode>((n) => n.cachedText);
