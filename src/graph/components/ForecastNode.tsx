import type { ForecastNode, ForecastOp } from "../nodeClasses";
import { makeToggleNodeComponent } from "./standardNode";

export const ForecastComponent = makeToggleNodeComponent<ForecastNode, ForecastOp>(
  {
    read: (n) => n.op,
    write: (n, o) => { n.op = o; },
    options: [
      { value: "linear", label: "linear", title: "Straight-line fit (Excel FORECAST.LINEAR / TREND)" },
      { value: "exponential", label: "exp", title: "Growth-curve fit y = b·mˣ (Excel GROWTH)" },
    ],
  },
  (n) => n.cachedResult,
);
