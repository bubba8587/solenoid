import type { FibonacciNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const FibonacciComponent = makeNodeComponent<FibonacciNode>((n) => n.cachedList);
