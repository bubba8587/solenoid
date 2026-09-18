import type { PromoNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const PromoComponent = makeNodeComponent<PromoNode>((n) => n.cachedText);
