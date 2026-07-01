// Mobile app-menu sheet open/closed. The trigger is the logo button in the app
// bar (TopBar) but the menu definitions live in MenuBar, so this little store
// lets the button toggle the sheet the MenuBar renders. Desktop never uses it.
import { createToggleStore } from "./storeKit";

export const mobileMenuStore = createToggleStore();
