import type { PromoNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const PromoComponent = makeNodeComponent<PromoNode>((n) => n.cachedText);
