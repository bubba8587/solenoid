import { cubePopup } from "../cubePopupStore";
import { cubeRowCount, cubeDepth, type CubeValue } from "../frame";
import { useHostNodeId } from "./nodeContext";
import "./ArrayChip.css";

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
      title={`${rows}×${cols}×${depth} cube (rows × cols × depth).${depth > 1 ? ` Nests ${depth} levels deep.` : ""} Click to view.`}
      onClick={(e) => {
        e.stopPropagation();
        const cs = getComputedStyle(e.currentTarget);
        // Explicit prop, else host accent, else the cube TYPE colour — so a chip
        // opened with no node context (e.g. inline in a Report) still gets the
        // standard coloured header (see FrameChip).
        const popupAccent =
          accent ||
          cs.getPropertyValue("--node-accent").trim() ||
          cs.getPropertyValue("--sock-cube").trim() ||
          undefined;
        const groupColor = cs.getPropertyValue("--group-color").trim();
        const groupColorDark = cs.getPropertyValue("--group-color-dark").trim();
        cubePopup.open(
          { kind: "cube", cube: value, label: label || "Cube" },
          {
            accent: popupAccent,
            groupColor: groupColor || undefined,
            groupColorDark: groupColorDark || undefined,
            pinNodeId: hostId ?? undefined,
          },
        );
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{rows}×{cols}×{depth} Cube]
    </button>
  );
}
