// [[B20]], [[layout-chrome#A phone turned sideways runs the tablet layout, scaled to fit]]
import { useSyncExternalStore } from "react";
import { deviceModeStore } from "./coarse";

/** `isMobile()` for a render: re-renders when a phone rotates between the phone and tablet layouts. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(deviceModeStore.subscribe, deviceModeStore.get, deviceModeStore.get);
}
