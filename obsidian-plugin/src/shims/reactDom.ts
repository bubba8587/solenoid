// [[C107]] obsidianPlugin
import { createPortal as realCreatePortal, flushSync } from "react-dom";
import type { ReactNode, ReactPortal } from "react";
import { popupPortalRoot } from "../shadow";

export { flushSync };

export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal {
  return realCreatePortal(children, container === document.body ? popupPortalRoot() : container, key);
}
