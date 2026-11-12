// [[obsidian-plugin]]
import { themeVersion } from "../shadow";

export const appThemeStore = {
  subscribe: themeVersion.subscribe,
  version: themeVersion.get,
};
