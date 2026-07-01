/**
 * Runtime environment detection.
 *
 * `isTauri` is true when the app is running inside its Tauri desktop shell,
 * false when it's served as the plain web frontend (e.g. the Vercel demo).
 * Tauri v2 injects `__TAURI_INTERNALS__` onto `window` before any app code
 * runs, so checking for it is a reliable, synchronous test. We use this to
 * tell web-demo visitors they're on the demo and can download the desktop
 * build instead.
 */
export const isTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;

/** True only on the web frontend (the inverse of {@link isTauri}). */
export const isWebDemo = !isTauri;

/** Where web-demo visitors can download the desktop build. */
export const DOWNLOAD_URL = "https://github.com/jortscity/solenoid/releases";
