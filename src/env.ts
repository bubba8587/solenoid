/**
 * True inside the Tauri desktop shell, false on the plain web frontend. Tauri v2
 * injects `__TAURI_INTERNALS__` onto `window` before any app code runs, so this
 * is a reliable synchronous test.
 */
export const isTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;

/** True only on the web frontend (the inverse of {@link isTauri}). */
export const isWebDemo = !isTauri;

/** Where web-demo visitors can download the desktop build. */
export const DOWNLOAD_URL = "https://github.com/jortscity/solenoid/releases";
