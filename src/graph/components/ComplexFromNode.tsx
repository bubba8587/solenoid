import type { ComplexFromNode as ComplexFromNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ComplexFromComponent = makeNodeComponent<ComplexFromNodeType>((n) => n.cachedResult);
