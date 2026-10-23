import { ColebrookNode as ColebrookNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ColebrookComponent =
  makeNodeComponent<ColebrookNodeType>((n) => n.cachedResult);
