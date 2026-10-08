// [[C103]] untrustedContentSeams
import { openExternal } from "./fileBridge";


export function externalLinkTarget(href: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.protocol === "mailto:") return url.href;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin === origin ? null : url.href;
}

/** Capture phase, so a card's own stopPropagation cannot let a link through. */
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
