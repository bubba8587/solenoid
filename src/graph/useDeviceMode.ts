// [[C119]] landscapePhoneIsTablet
import { useSyncExternalStore } from "react";
import { deviceModeStore } from "./coarse";

/** `isMobile()` for a render: re-renders when a phone rotates between the phone and tablet layouts. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(deviceModeStore.subscribe, deviceModeStore.get, deviceModeStore.get);
}
