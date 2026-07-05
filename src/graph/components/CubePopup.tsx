import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cubePopup, type DrillView } from "../cubePopupStore";
import { appThemeStore } from "../appTheme";
import { cubeRowCount, cubeDepth, frameRowCount } from "../frame";
import { CubeCellChip, frameCellNode } from "./cubeCell";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import "./popupChrome.css";
import "./TablePopup.css";

// What to render for the current drill level, normalized across the three view
// kinds so the table markup below is written once.
function describe(view: DrillView): {
  headers: string[] | null; // null → numeric column labels (grid view)
  rows: number;
  cols: number;
  depth: number | null;     // cube only
  cell: (r: number, c: number) => ReactNode;
} {
  if (view.kind === "cube") {
    const cube = view.cube;
    return {
      headers: cube.columns.map((c) => c.name),
      rows: cubeRowCount(cube),
      cols: cube.columns.length,
      depth: cubeDepth(cube),
      cell: (r, c) => <CubeCellChip cell={cube.columns[c].cells[r] ?? null} crumb={cube.columns[c].name} size="sm" />,
    };
  }
  if (view.kind === "frame") {
    const f = view.frame;
    return {
      headers: f.columns.map((c) => c.name),
      rows: frameRowCount(f),
      cols: f.columns.length,
      depth: null,
      cell: (r, c) => frameCellNode(f.columns[c].type, f.columns[c].values[r] ?? null),
    };
  }
  const g = view.cells;
  return {
    headers: null,
    rows: g.length,
    cols: g.reduce((m, row) => Math.max(m, row.length), 0),
    depth: null,
    cell: (r, c) => <CubeCellChip cell={g[r]?.[c] ?? null} crumb="item" size="sm" />,
  };
}

/**
 * Read-only viewer for nested data — the one popup for every nesting kind. The grid
 * shows the current drill level (a Cube, a nested Frame, or a list/matrix); any
 * nested-container cell drills DEEPER IN PLACE via the breadcrumb (no second
 * window ever opens). A cube view also shows its cached DEPTH in the header so
 * nesting is never hidden. Mounted once in App, like TablePopup.
 */
export function CubePopup() {
  const state = useSyncExternalStore(cubePopup.subscribe, cubePopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Esc pops one drill level; at the root it closes.
      if (state.stack.length > 1) cubePopup.backTo(state.stack.length - 2);
      else cubePopup.close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);

  if (!state) return null;
  const view = state.stack[state.stack.length - 1];
  const { headers, rows, cols, depth, cell } = describe(view);
  // Cap rendered rows: a cube cell holding a large nested frame would otherwise put
  // the whole table in the DOM and kill the renderer (same hazard as TablePopup).
  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  const shownRows = rowsTruncated ? MAX_VISIBLE_ROWS : rows;

  const grouped = !!state.groupColor;
  const cardStyle: CSSProperties = {};
  const cardVars = cardStyle as Record<string, string>;
  if (state.accent) cardVars["--node-accent"] = state.accent;
  if (state.groupColor) cardVars["--group-color"] = state.groupColor;
  if (state.groupColorDark) cardVars["--group-color-dark"] = state.groupColorDark;

  return (
    <div className="sol-popup-overlay" onPointerDown={() => cubePopup.close()}>
      <div
        className={`sol-popup table-popup${grouped ? " sol-popup--grouped" : ""}`}
        style={cardStyle}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sol-popup__header">
          <div className="sol-popup__title">{view.label}</div>
          <span className="table-popup__dims">{rows}×{cols}{rowsTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString()}` : ""}</span>
          {depth !== null && (
            <span
              className="table-popup__dims"
              title={depth > 1
                ? `This cube nests ${depth} levels of cubes deep — drill into the chips to reach them`
                : "A flat cube (no cube nested inside a cube)"}
            >
              Depth {depth}
            </span>
          )}
          {state.stack.length === 1 && state.pinNodeId && <PopupGoToButton nodeId={state.pinNodeId} onClose={() => cubePopup.close()} />}
          {state.stack.length === 1 && state.pinNodeId && <PopupPinButton nodeId={state.pinNodeId} />}
          <button className="sol-popup__close" onClick={() => cubePopup.close()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        {state.stack.length > 1 && (
          <div className="cube-popup__crumbs">
            {state.stack.map((v, i) => (
              <span key={i}>
                {i > 0 && <span className="cube-popup__crumb-sep"> ▸ </span>}
                {i === state.stack.length - 1 ? (
                  <span className="cube-popup__crumb cube-popup__crumb--here">{v.label}</span>
                ) : (
                  <button type="button" className="cube-popup__crumb" onClick={() => cubePopup.backTo(i)}>{v.label}</button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="table-popup__grid-scroll">
          <table className="table-popup__grid">
            <thead>
              <tr>
                <th className="table-popup__corner" />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} className={headers ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"} title={headers?.[c]}>
                    {headers ? headers[c] : c + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: shownRows }, (_, r) => (
                <tr key={r}>
                  <th className="table-popup__rowhead">{r + 1}</th>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} className="table-popup__cell" style={{ padding: "2px 6px", textAlign: "left" }}>
                      {cell(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-popup__footer">
          <div className="table-popup__spacer" />
          <button className="table-popup__btn table-popup__btn--primary" onClick={() => cubePopup.close()}>Done</button>
        </div>
      </div>
    </div>
  );
}
