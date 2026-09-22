// [[C107]] obsidianPlugin
// Obsidian knows its platform; a plugin asks it instead of reading the user agent.
import { Platform } from "obsidian";

export const IS_MOBILE_UA = Platform.isMobile;
