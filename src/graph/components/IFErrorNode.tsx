import type { IFErrorNode as IFErrorNodeType, IFErrorMode } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

const MODES: Record<IFErrorMode, { label: string }> = {
  iferror: { label: "IFERROR: catch any error" },
  ifna:    { label: "IFNA: catch #N/A" },
};

export const IFErrorComponent = makeOpNodeComponent<IFErrorMode, IFErrorNodeType>(MODES, (n) => n.cachedResult);
