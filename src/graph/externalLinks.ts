import { openExternal } from "./fileBridge";

// Rendered markdown (Notes, imported vault notes, Reports, help) carries arbitrary
// <a href>s. Left alone, a click NAVIGATES the desktop webview away from the app with
// no way back, so one document-level guard hands every off-app link to the system
// browser instead (web: a new tab).

/** The URL a click on `href` should open OUTSIDE the app, or null when the link is
 *  in-app (same origin, a hash, a relative path) or not a browser scheme. */
export function externalLinkTarget(href: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.protocol === "mailto:") return url.href;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin === origin ? null : url.href;
}

/** Install the guard on `document`; returns the uninstaller. Capture phase, so a
 *  card's own stopPropagation can't let a link through. */
export function installExternalLinkGuard(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const target = externalLinkTarget(a.getAttribute("href") ?? "", window.location.origin);
    if (!target) return;
    e.preventDefault();
    void openExternal(target);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
