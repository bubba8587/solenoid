import { EPOCH_UNIT_OPTIONS } from "../nodeClasses";
import type { EpochNode as EpochNodeType } from "../nodeClasses";
import { makeToggleNodeComponent } from "./standardNode";

export const EpochComponent = makeToggleNodeComponent<EpochNodeType, EpochNodeType["unit"]>(
  { read: (n) => n.unit, write: (n, u) => { n.unit = u; }, options: EPOCH_UNIT_OPTIONS },
  (n) => n.cachedResult,
);
