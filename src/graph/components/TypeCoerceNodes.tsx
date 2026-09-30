// T / N / TYPE are covered by Cast + the socket type system + the Test node.
import type { FormatDollarNode as FormatDollarNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const FormatDollarComponent = makeNodeComponent<FormatDollarNodeType>((n) => n.cachedText);
