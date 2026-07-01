// Touch "select mode" — there is no Shift (for the lasso) or Ctrl (to
// accumulate) on a phone, so a mobile toggle drives both through this flag.
// When on, a one-finger drag on the background draws the lasso instead of
// panning, and tapping a node adds/removes it from the selection (the same as
// holding Ctrl on desktop). The Canvas reads it; MobileControls toggles it.
import { createToggleStore } from "./storeKit";

export const touchSelectStore = createToggleStore();
