import { EPOCH_UNIT_OPTIONS } from "../rete-nodes";
import type { EpochNode as EpochNodeType } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const EpochComponent = makeToggleNodeComponent<EpochNodeType, EpochNodeType["unit"]>(
  { read: (n) => n.unit, write: (n, u) => { n.unit = u; }, options: EPOCH_UNIT_OPTIONS },
  (n) => n.cachedResult,
);
