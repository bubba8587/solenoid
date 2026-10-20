// [[B14]] oneDesignSystem
import { useSyncExternalStore } from "react";
import { pinStore, pinNodeValue } from "../pinStore";
import { flyToNodeAndFlash } from "../flyToNode";
import { getOwningEditor } from "../activeGraph";
import { resolveValueOrigin } from "../unitFlow";
import type { PopupMenuItem } from "./PopupOverflowMenu";

/** The overflow menu's host-node items: Go to Source and Pin, or none without a host. */
export function usePopupNodeItems(nodeId: string | undefined, onClose: () => void): PopupMenuItem[] {
  useSyncExternalStore(pinStore.subscribe, pinStore.version);
  if (!nodeId) return [];
  const pinned = pinStore.has(nodeId);
  return [
    {
      label: "Go to Source",
      divider: true,
      onClick: () => {
        onClose();
        const editor = getOwningEditor(nodeId);
        flyToNodeAndFlash(editor ? resolveValueOrigin(editor, nodeId) : nodeId);
      },
    },
    { label: pinned ? "Unpin from HUD" : "Pin to HUD", onClick: () => pinNodeValue(nodeId) },
  ];
}
