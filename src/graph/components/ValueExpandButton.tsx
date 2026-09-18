import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { openValuePopup, accentFallbackVar, type ElemFamily } from "../valuePopup";
import "./ExpressionNode.css"; // .solenoid-expr__expand — the shared expand-pill look
import { stopDragStart } from "../coarse";

/** The corner expand affordance on an EXPANDED Display's frame / table / list — the
 *  counterpart to ChartExpandButton, opening the same table popup the collapsed chip
 *  opens (through the shared valuePopup opener). Rendered in NodeShell's non-scrolling
 *  cornerBadge slot so it stays pinned over a body that scrolls when the card is sized
 *  down; pinNodeId defaults to the host node, so formatNodeId semantics are unchanged. */
export function ValueExpandButton({ value, label, elem }: {
  value: unknown;
  label?: string;
  /** The host output socket's element family, forwarded to the array popup so a matrix
   *  gets its format+unit row (mirrors ArrayChip's `elem`); ignored for a frame. */
  elem?: ElemFamily;
}) {
  const hostId = useHostNodeId();
  return (
    <button
      type="button"
      className="solenoid-expr__expand"
      title="Expand"
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, accentFallbackVar(value));
        openValuePopup(value, { label, hostId, elem, ...st });
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" aria-hidden="true">
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      </svg>
    </button>
  );
}
