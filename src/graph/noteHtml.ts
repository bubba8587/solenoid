// [[C103]] untrustedContentSeams, [[B18]] safeToShare
// The one sanitizer for rendered note markdown (`reports-and-notes.md` § What is sanitized). While a foreign document
// has no network grant, a web image (or video, audio, a style's `url(…)`) is held back, since loading it is a fetch
// that tells the image's host the document was opened.
import DOMPurify from "dompurify";
import { useSyncExternalStore } from "react";
import { docMetaStore } from "./docMetaStore";
import { settingsStore } from "./settingsStore";
import { askNetwork, networkAllowed } from "./connectionStore";

const REMOTE = /^\s*(?:https?:)?\/\//i;
const STYLE_URL = /url\s*\(/i;
const HELD_TITLE = "This image loads once the document is allowed to fetch.";

let _holding = false;
let _held = 0;
let _installed = false;

function install(): void {
  if (_installed) return;
  _installed = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!_holding || !(node instanceof Element)) return;
    for (const attr of ["src", "srcset", "poster"]) {
      const v = node.getAttribute(attr);
      if (v === null || !(attr === "srcset" ? /(?:^|,)\s*(?:https?:)?\/\//i.test(v) : REMOTE.test(v))) continue;
      node.removeAttribute(attr);
      node.setAttribute(`data-held-${attr}`, v);
      _held++;
    }
    if (node.hasAttribute("data-held-src") && node.tagName === "IMG") {
      node.setAttribute("title", HELD_TITLE);
      node.classList.add("sol-md__held-img");
    }
    const style = node.getAttribute("style");
    if (style && STYLE_URL.test(style)) { node.removeAttribute("style"); _held++; }
  });
}

/** Rendered note HTML, made safe to insert. Re-render when `networkAllowed()` turns true (`useNetworkGrant`). */
export function sanitizeNoteHtml(html: string): string {
  install();
  _holding = !networkAllowed();
  _held = 0;
  try {
    return DOMPurify.sanitize(html);
  } finally {
    if (_holding && _held > 0) askNetwork("note-images");
    _holding = false;
  }
}

/** Whether this document may fetch, for a memo of sanitized HTML to re-run on when the grant arrives. */
export function useNetworkGrant(): boolean {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  useSyncExternalStore(docMetaStore.subscribe, docMetaStore.version);
  return networkAllowed();
}
