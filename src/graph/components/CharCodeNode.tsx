import type { CharCodeNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const CharCodeComponent = makeNodeComponent<CharCodeNode>((n) => n.cachedResult);
