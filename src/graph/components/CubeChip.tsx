import { cubePopup } from "../cubePopupStore";
import { cubeRowCount, cubeDepth, type CubeValue } from "../frame";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

/**
 * A clickable chip for a Cube value — `[R×C Cube · dN]` — that opens the cube
 * popup. Mirrors FrameChip (same chip styling + accent inheritance). The depth
 * suffix (dN) is shown when the cube nests cubes (depth > 1), so a deeply nested
 * value advertises itself before you even open it.
 */
export function CubeChip({ value, label, size = "md", accent, pinNodeId }: {
  value: CubeValue;
  label?: string;
  size?: "sm" | "md";
  accent?: string;
  pinNodeId?: string;
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
      title={`${rows}×${cols}×${depth} cube (rows × cols × depth).${depth > 1 ? ` Nests ${depth} levels deep.` : ""} View.`}
      onClick={(e) => {
        e.stopPropagation();
        // Explicit prop, else the inherited node/group style (cube TYPE color
        // when there's no node context — see FrameChip).
        const st = readChipPopupStyle(e.currentTarget, "--sock-cube");
        cubePopup.open(
          { kind: "cube", cube: value, label: label || "Cube" },
          {
            accent: accent || st.accent,
            groupColor: st.groupColor,
            groupColorDark: st.groupColorDark,
            pinNodeId: hostId ?? undefined,
          },
        );
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{rows}×{cols}×{depth} Cube]
    </button>
  );
}
