import type { ShiftNode } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const ShiftComponent = makeToggleNodeComponent<ShiftNode, ShiftNode["wrap"]>(
  {
    read: (n) => n.wrap,
    write: (n, w) => { n.wrap = w; },
    options: [
      { value: "blank", label: "blank", title: "Vacated slots are blank; elements pushed off the end drop away" },
      { value: "wrap", label: "wrap", title: "Elements pushed off one end wrap around to the other (numpy.roll)" },
    ],
  },
  (n) => n.cachedList,
);
