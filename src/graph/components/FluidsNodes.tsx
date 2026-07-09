import { ColebrookNode as ColebrookNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ColebrookComponent =
  makeNodeComponent<ColebrookNodeType>((n) => n.cachedResult);
