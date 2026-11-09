import type { MultinomialNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const MultinomialComponent = makeNodeComponent<MultinomialNode>((n) => n.cachedResult);
