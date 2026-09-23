// [[C100]] chartIsAValue
import { createValueStore } from "./storeKit";
import type { ChartShape } from "./components/chartView";
import type { ChartOptions } from "./nodes/chartOptions";
import type { ChartValue } from "./chartValue";

export interface ChartPopupState {
  title: string;
  /** When set, the series fields below are ignored. */
  value?: ChartValue;
  op?: ChartShape;
  axes?: boolean;
  series?: { i: number; v: number }[];
  labels?: (string | number)[];
  opts?: ChartOptions;
  signColors?: { pos: string; neg: string };
  accent?: string;
  pinNodeId?: string;
}

export const chartPopup = createValueStore<ChartPopupState>();
