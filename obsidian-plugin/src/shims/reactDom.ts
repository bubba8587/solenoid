// [[C107]] obsidianPlugin
// A portal aimed at document.body would leave the shadow root and lose every style,
// so it lands in the popup layer instead.
import { createPortal as realCreatePortal, flushSync } from "react-dom";
import type { ReactNode, ReactPortal } from "react";
import { popupPortalRoot } from "../shadow";

export { flushSync };

export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal {
  return realCreatePortal(children, container === document.body ? popupPortalRoot() : container, key);
}
