// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
import type { App } from "obsidian";

let app: App | null = null;

/** Obsidian's `app`, for the shims that call its API (set once in `onload`). */
export const obsidianApp = (): App | null => app;
export function setObsidianApp(next: App): void {
  app = next;
}
