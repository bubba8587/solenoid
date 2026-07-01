import type { MultinomialNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const MultinomialComponent = makeNodeComponent<MultinomialNode>((n) => n.cachedResult);
