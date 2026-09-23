// [[C93]] gestureByPointerType. Touch-vs-mouse helpers shared across node chrome.
import { IS_MOBILE_UA } from "./mobileUa";

export const IS_COARSE =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** Read on each call, not cached, so a mid-session OS toggle takes effect. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The single gate for every mobile behavior; main.tsx mirrors it onto `html.is-mobile`. Derive, never duplicate. */
export const IS_MOBILE = IS_COARSE && IS_MOBILE_UA;

/** Coarse but not mobile, so a device is never both and never neither; a tablet runs the desktop model. */
export const IS_TABLET = IS_COARSE && !IS_MOBILE;

/** Swallowed on desktop so a click can't start a node drag, left to bubble on mobile so a pan still works
 *  (tree/specs/canvas/pointer-gestures.md lists the controls that keep a hard stop). */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!IS_MOBILE) e.stopPropagation();
};
