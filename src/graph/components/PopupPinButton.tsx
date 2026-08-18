import { useSyncExternalStore } from "react";
import { pinStore, pinNodeValue } from "../pinStore";
import { flyToNodeAndFlash } from "../flyToNode";
import { getOwningEditor } from "../activeGraph";
import { resolveValueOrigin } from "../unitFlow";

// Lucide "pin". EVEN size in an even (24px) button so it centers on a whole pixel.
const PinGlyph = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

/** The Pin action shared by the value popups; the host node id comes from the popup,
 *  which learns it from NodeFormatContext. */
export function PopupPinButton({ nodeId }: { nodeId: string }) {
  useSyncExternalStore(pinStore.subscribe, pinStore.version);
  const pinned = pinStore.has(nodeId);
  return (
    <button
      type="button"
      className={`sol-popup__pin${pinned ? " sol-popup__pin--on" : ""}`}
      onClick={() => pinNodeValue(nodeId)}
      title={pinned ? "Unpin the value from the HUD" : "Pin the value to the HUD"}
      aria-label={pinned ? "Unpin the value" : "Pin the value"}
      aria-pressed={pinned}
    >
      <PinGlyph />
    </button>
  );
}

// Lucide "crosshair" — even 16px, per the icon-parity rule.
const LocateGlyph = () => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="22" x2="18" y1="12" y2="12" />
    <line x1="6" x2="2" y1="12" y2="12" />
    <line x1="12" x2="12" y1="6" y2="2" />
    <line x1="12" x2="12" y1="22" y2="18" />
  </svg>
);

/** "Go to source" — flies the camera to the node that PRODUCED the shown value, resolved
 *  upstream through passthroughs/FCs/selectors; a producer resolves to itself. */
export function PopupGoToButton({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  return (
    <button
      type="button"
      className="sol-popup__pin"
      onClick={() => {
        onClose();
        // A popup opened inside a drill-in resolves its origin within the SUBGRAPH.
        const editor = getOwningEditor(nodeId);
        flyToNodeAndFlash(editor ? resolveValueOrigin(editor, nodeId) : nodeId);
      }}
      title="Go to the value's source node"
      aria-label="Go to the source node"
    >
      <LocateGlyph />
    </button>
  );
}
