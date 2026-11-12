// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
import { themeVersion } from "../shadow";

export const appThemeStore = {
  subscribe: themeVersion.subscribe,
  version: themeVersion.get,
};
