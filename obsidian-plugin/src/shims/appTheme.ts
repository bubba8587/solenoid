// [[C107]] obsidianPlugin
// The app's theme store writes its tokens onto `<html>`. Here they live in the shadow hosts
// (`shadow.ts`), so a component that follows the store follows the plugin's own theme tick.
import { themeVersion } from "../shadow";

export const appThemeStore = {
  subscribe: themeVersion.subscribe,
  version: themeVersion.get,
};
