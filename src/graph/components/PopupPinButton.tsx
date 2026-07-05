import { useSyncExternalStore } from "react";
import { pinStore, pinNodeValue } from "../pinStore";
import { flyToNodeAndFlash } from "../flyToNode";

// Lucide "pin" — https://lucide.dev/icons/pin. Even size in an even (24px) button
// so it centers on a whole pixel (see CLAUDE.md icon-parity rule).
const PinGlyph = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

/**
 * The Pin action shared by the value popups (Table/Frame/List, Formula, Chart) —
 * pins the host node's value to the HUD, the same gesture as the node's right-click
 * "Pin value". Subscribes to pinStore so it reflects the pinned state live (a
 * filled look + "Unpin" label when already pinned). The popups pass the host node
 * id, which they learn from NodeFormatContext when opened from a node body.
 */
export function PopupPinButton({ nodeId }: { nodeId: string }) {
  useSyncExternalStore(pinStore.subscribe, pinStore.version);
  const pinned = pinStore.has(nodeId);
  return (
    <button
      type="button"
      className={`sol-popup__pin${pinned ? " sol-popup__pin--on" : ""}`}
      onClick={() => pinNodeValue(nodeId)}
      title={pinned ? "Unpin value from the HUD" : "Pin value to the HUD"}
      aria-label={pinned ? "Unpin value" : "Pin value"}
      aria-pressed={pinned}
    >
      <PinGlyph />
    </button>
  );
}

// Lucide "crosshair" — even 16px in the same even button, per the icon-parity rule.
const LocateGlyph = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="22" x2="18" y1="12" y2="12" />
    <line x1="6" x2="2" y1="12" y2="12" />
    <line x1="12" x2="12" y1="6" y2="2" />
    <line x1="12" x2="12" y1="22" y2="18" />
  </svg>
);

/**
 * "Go to node" — closes the popup and flies the camera to the host node with
 * the same flash ring as the error click-to-jump. Sits beside the Pin action
 * in every value popup (the backlog's "+ more" follow-up on Pin).
 */
export function PopupGoToButton({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  return (
    <button
      type="button"
      className="sol-popup__pin"
      onClick={() => { onClose(); flyToNodeAndFlash(nodeId); }}
      title="Go to node on the canvas"
      aria-label="Go to node"
    >
      <LocateGlyph />
    </button>
  );
}
