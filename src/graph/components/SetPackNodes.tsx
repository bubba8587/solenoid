import { IsInNode as IsInNodeType, TallyNode as TallyNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const IsInComponent = makeNodeComponent<IsInNodeType>((n) => n.cachedList);
export const TallyComponent = makeNodeComponent<TallyNodeType>((n) => n.cachedResult);
