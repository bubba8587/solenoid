// Touch "select mode": the one flag standing in for both Shift (lasso) and Ctrl
// (accumulate), which a phone has no keys for.
import { createToggleStore } from "./storeKit";

export const touchSelectStore = createToggleStore();
