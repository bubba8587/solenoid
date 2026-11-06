// [[C103]] untrustedContentSeams, [[B18]] safeToShare
// The one sanitizer for rendered note markdown, network gate included (`reports-and-notes.md` § What is sanitized).
import DOMPurify from "dompurify";
import { useSyncExternalStore } from "react";
import { docMetaStore } from "./docMetaStore";
import { settingsStore } from "./settingsStore";
import { foreignCardStore } from "./foreignCardStore";
import { askNetwork, networkAllowed } from "./connectionStore";
import { CSS_FETCH, isWebUrl, srcsetReachesWeb } from "./webUrl";

const HELD_TITLE = "This image loads once the document is allowed to fetch.";
// SVG elements whose href is a picture the browser fetches; an <a>'s href is a link, which waits for a click.
const HREF_FETCHES = new Set(["image", "use", "feimage"]);

let _holding = false;
let _held = 0;
let _installed = false;

function hold(node: Element, attr: string, v: string): void {
  node.removeAttribute(attr);
  node.setAttribute(`data-held-${attr.replace(":", "-")}`, v);
  _held++;
}

function install(): void {
  if (_installed) return;
  _installed = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!_holding || !(node instanceof Element)) return;
    for (const attr of ["src", "srcset", "poster", "background"]) {
      const v = node.getAttribute(attr);
      if (v !== null && (attr === "srcset" ? srcsetReachesWeb(v) : isWebUrl(v))) hold(node, attr, v);
    }
    if (HREF_FETCHES.has(node.tagName.toLowerCase())) {
      for (const attr of ["href", "xlink:href"]) {
        const v = node.getAttribute(attr);
        if (v !== null && isWebUrl(v)) hold(node, attr, v);
      }
    }
    if (node.hasAttribute("data-held-src") && node.tagName === "IMG") {
      node.setAttribute("title", HELD_TITLE);
      node.classList.add("sol-md__held-img");
    }
    const style = node.getAttribute("style");
    if (style && CSS_FETCH.test(style)) { node.removeAttribute("style"); _held++; }
  });
  DOMPurify.addHook("afterSanitizeElements", (node) => {
    if (_holding && node instanceof Element && node.tagName === "STYLE" && CSS_FETCH.test(node.textContent ?? "")) {
      node.textContent = "";
      _held++;
    }
  });
}

/** Rendered note HTML, made safe to insert; `nodeId` names the card it renders for. Re-render when the grant arrives
 *  (`useNetworkGrant`). */
export function sanitizeNoteHtml(html: string, nodeId?: string): string {
  install();
  _holding = !networkAllowed(nodeId);
  _held = 0;
  try {
    return DOMPurify.sanitize(html);
  } finally {
    if (_holding && _held > 0) askNetwork("note-images");
    _holding = false;
  }
}

/** Whether this document may fetch, for a memo of sanitized HTML to re-run on when the grant arrives. */
export function useNetworkGrant(nodeId?: string): boolean {
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  useSyncExternalStore(docMetaStore.subscribe, docMetaStore.version);
  useSyncExternalStore(foreignCardStore.subscribe, foreignCardStore.version);
  return networkAllowed(nodeId);
}
