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

/** A phone: touch-primary with a mobile user agent. Turned sideways it runs the tablet layout ([[C119]] landscapePhoneIsTablet). */
export const IS_PHONE = IS_COARSE && IS_MOBILE_UA;

/** The screen's own orientation, never the viewport's shape: the on-screen keyboard makes a portrait viewport wider than tall. */
function screenIsLandscape(): boolean {
  if (typeof screen === "undefined") return false;
  const type = screen.orientation?.type;
  if (type) return type.startsWith("landscape");
  return screen.width > screen.height;
}

let _mobile = IS_PHONE && !screenIsLandscape();
const _modeListeners = new Set<() => void>();
if (IS_PHONE && typeof screen !== "undefined") {
  const update = () => {
    const next = !screenIsLandscape();
    if (next === _mobile) return;
    _mobile = next;
    for (const l of _modeListeners) l();
  };
  if (screen.orientation) screen.orientation.addEventListener("change", update);
  else window.addEventListener("orientationchange", update);
}

/** The single gate for every mobile behavior, read live because a phone switches on rotation; main.tsx mirrors it onto `html.is-mobile`. Derive, never duplicate. */
export function isMobile(): boolean {
  return _mobile;
}

/** Coarse but not mobile, so a device is never both and never neither; a tablet runs the desktop model. */
export function isTablet(): boolean {
  return IS_COARSE && !_mobile;
}

export const deviceModeStore = {
  get: isMobile,
  subscribe: (l: () => void) => {
    _modeListeners.add(l);
    return () => { _modeListeners.delete(l); };
  },
};

/** The page scale a sideways phone runs the tablet layout at: the desktop top bar fits one row from 1100 px wide, and the canvas wants about 380 px of height. */
export function landscapePhoneScale(width: number, usableHeight: number): number {
  return Math.min(1, Math.max(0.6, Math.min(width / 1100, usableHeight / 380)));
}

/** Swallowed on desktop so a click can't start a node drag, left to bubble on mobile so a pan still works
 *  (tree/specs/canvas/pointer-gestures.md lists the controls that keep a hard stop). */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!_mobile) e.stopPropagation();
};
