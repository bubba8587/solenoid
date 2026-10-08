// [[C107]] obsidianPlugin
import { themeVersion } from "../shadow";

export const appThemeStore = {
  subscribe: themeVersion.subscribe,
  version: themeVersion.get,
};
