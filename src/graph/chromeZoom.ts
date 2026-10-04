// [[C119]] landscapePhoneIsTablet
import { useSyncExternalStore } from "react";
import { IS_PHONE, deviceModeStore, isMobile, landscapePhoneScale } from "./coarse";
import "./chromeZoom.css";

// Roughly the browser's toolbar and the system bars, which a sideways screen still loses from its height.
export const BROWSER_CHROME_H = 80;

/** The page scale a sideways phone lays out at, from its screen. */
export function landscapeFit(): number {
  const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
  return landscapePhoneScale(long, short - BROWSER_CHROME_H);
}

let _zoom = 1;
const _listeners = new Set<() => void>();

/** Fullscreen pins the page scale to 1, so a sideways phone there shrinks the app chrome instead (`chromeZoom.css`). */
function update(): void {
  const next = IS_PHONE && !isMobile() && !!document.fullscreenElement ? landscapeFit() : 1;
  if (next === _zoom) return;
  _zoom = next;
  const html = document.documentElement;
  html.classList.toggle("chrome-zoomed", next !== 1);
  if (next === 1) html.style.removeProperty("--chrome-zoom");
  else html.style.setProperty("--chrome-zoom", next.toFixed(3));
  for (const l of _listeners) l();
}

export function installChromeZoom(): void {
  if (!IS_PHONE) return;
  document.addEventListener("fullscreenchange", update);
  deviceModeStore.subscribe(update);
  update();
}

export const chromeZoomStore = {
  get: () => _zoom,
  subscribe: (l: () => void) => {
    _listeners.add(l);
    return () => { _listeners.delete(l); };
  },
};

/** The chrome zoom for a render (1 unless a sideways phone is fullscreen), for chrome React draws at a pixel size. */
export function useChromeZoom(): number {
  return useSyncExternalStore(chromeZoomStore.subscribe, chromeZoomStore.get, chromeZoomStore.get);
}
