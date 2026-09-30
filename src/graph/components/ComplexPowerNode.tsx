import type { ComplexPowerNode as ComplexPowerNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ComplexPowerComponent = makeNodeComponent<ComplexPowerNodeType>((n) => n.cachedResult);
