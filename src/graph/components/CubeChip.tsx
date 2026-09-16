import { cubeRowCount, cubeDepth, type CubeValue } from "../frame";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { openCubePopup } from "../valuePopup";
import type { CubeEditBinding } from "../cubePopupStore";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

export function CubeChip({ value, label, size = "md", accent, pinNodeId, edit }: {
  value: CubeValue;
  label?: string;
  size?: "sm" | "md";
  accent?: string;
  pinNodeId?: string;
  /** A Cube Input's records seam — the popup opens as an editor. */
  edit?: CubeEditBinding;
}) {
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const rows = cubeRowCount(value);
  const cols = value.columns.length;
  const depth = cubeDepth(value);

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--cube${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={`${rows}×${cols}×${depth} cube (rows × cols × depth).${depth > 1 ? ` Nests ${depth} levels deep.` : ""} ${edit ? "Edit" : "View"}.`}
      onClick={(e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, "--sock-cube");
        openCubePopup(value, {
          label, hostId, edit,
          accent: accent || st.accent, groupColor: st.groupColor, groupColorDark: st.groupColorDark,
        });
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{rows}×{cols}×{depth} Cube]
    </button>
  );
}
