// When true the canvas is view-only: no node drag, cable or socket interaction
// (FlowSurface's RF flags), and the keyboard mutators stand down too — Delete,
// nudge, paste, Tidy / Cleanup, group create / autofit / expand (canvasKeyboard,
// onBeforeDelete). F9 and the view keys stay live.
import { createToggleStore } from "./storeKit";

export const canvasLockStore = createToggleStore();
