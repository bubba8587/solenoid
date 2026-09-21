// [[B10]] reactFlowView (module-singleton store, storeKit)
// Lets TopBar's logo button toggle the sheet MenuBar renders; unused on desktop.
import { createToggleStore } from "./storeKit";

export const mobileMenuStore = createToggleStore();
