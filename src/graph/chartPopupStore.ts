// The currently-open chart popup (a big read-only view of a Sparkline/Chart),
// or null. Module store like tablePopup / formulaPopup: opened from inside a
// node (separate React root), mounted once in App.
import { createNotifier } from "./storeKit";
import type { ChartShape } from "./components/chartView";
import type { ChartOptions } from "./nodes/chartOptions";
import type { ChartValue } from "./chartValue";

export interface ChartPopupState {
  title: string;
  /** A full chart VALUE — the general path (renders via ChartFigure, so it covers
   *  every op incl. treemap / sankey / composed / bubble). When set, the series
   *  fields below are ignored. Used by the collapsed [Chart] chip. */
  value?: ChartValue;
  /** The series path (Sparkline / Chart expand button): op + points. */
  op?: ChartShape;
  /** Whether to draw gridlines + axes (Chart) or a clean sparkline. */
  axes?: boolean;
  series?: { i: number; v: number }[];
  /** matplotlib-style overrides (Chart only); undefined for a Sparkline. */
  opts?: ChartOptions;
  /** Host node accent so the popup header matches the node it opened from. */
  accent?: string;
  /** Host node id, when opened from a node body — enables the header Pin action. */
  pinNodeId?: string;
}

let _state: ChartPopupState | null = null;
const { notify, subscribe } = createNotifier();

export const chartPopup = {
  get: (): ChartPopupState | null => _state,
  open(state: ChartPopupState) {
    _state = state;
    notify();
  },
  close() {
    if (_state === null) return;
    _state = null;
    notify();
  },
  subscribe,
};
