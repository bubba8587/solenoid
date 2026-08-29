import { PAD_SIDE_META } from "../rete-nodes";
import type { PadTextNode as PadTextNodeType, PadSide } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

const SIDES = (Object.keys(PAD_SIDE_META) as PadSide[]).map((s) => ({
  value: s, label: PAD_SIDE_META[s].label, title: PAD_SIDE_META[s].description,
}));

export const PadTextComponent = makeToggleNodeComponent<PadTextNodeType, PadSide>(
  { read: (n) => n.side, write: (n, v) => { n.side = v; }, options: SIDES },
  (n) => n.cachedText,
);
