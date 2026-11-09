import type { NotNode as NotNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const NotComponent = makeNodeComponent<NotNodeType>((n) => n.cachedResult);
