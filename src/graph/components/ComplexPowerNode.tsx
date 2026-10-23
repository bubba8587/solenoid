import type { ComplexPowerNode as ComplexPowerNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ComplexPowerComponent = makeNodeComponent<ComplexPowerNodeType>((n) => n.cachedResult);
