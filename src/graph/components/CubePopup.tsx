import { useSyncExternalStore, type ReactNode } from "react";
import { cubePopup, type DrillView } from "../cubePopupStore";
import { appThemeStore } from "../appTheme";
import { cubeRowCount, cubeDepth, frameRowCount, type CubeCell } from "../frame";
import { CubeCellChip, frameCellNode, cubeCellToken } from "./cubeCell";
import { PopupShell, popupCardVars } from "./PopupShell";
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { useColumnSort, sortedOrder, sortKeyOf, sortDirOf, SortIndicator, type SortKey } from "./columnSort";
import { copyText } from "../clipboard";
import { saveCsvFileDialog } from "../fileBridge";
import { APP_LOCALE } from "../locale";
import "./TablePopup.css";

// The current drill level, normalized across the three view kinds so the table
// markup below is written once.
function describe(view: DrillView): {
  headers: string[] | null; // null → numeric column labels (grid view)
  rows: number;
  cols: number;
  depth: number | null;     // cube only
  cell: (r: number, c: number) => ReactNode;
  /** The RAW cell reduced for sorting — never the rendered node. */
  sortKey: (r: number, c: number) => SortKey;
} {
  if (view.kind === "cube") {
    const cube = view.cube;
    return {
      headers: cube.columns.map((c) => c.name),
      rows: cubeRowCount(cube),
      cols: cube.columns.length,
      depth: cubeDepth(cube),
      cell: (r, c) => <CubeCellChip cell={cube.columns[c].cells[r] ?? null} crumb={cube.columns[c].name} size="sm" type={cube.columns[c].type} />,
      sortKey: (r, c) => sortKeyOf(cube.columns[c].cells[r] ?? null),
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
      sortKey: (r, c) => sortKeyOf(f.columns[c].values[r] ?? null),
    };
  }
  const g = view.cells;
  return {
    headers: null,
    rows: g.length,
    cols: g.reduce((m, row) => Math.max(m, row.length), 0),
    depth: null,
    cell: (r, c) => <CubeCellChip cell={g[r]?.[c] ?? null} crumb="item" size="sm" />,
    sortKey: (r, c) => sortKeyOf(g[r]?.[c] ?? null),
  };
}

/** The current level's cell as export text — same reducer as the compact
 *  preview, so a nested container serializes as its chip token
 *  ("Cube 3x2x1", "Frame 5x2"), never expanded. */
function tokenAt(view: DrillView, r: number, c: number): string {
  if (view.kind === "cube") {
    const col = view.cube.columns[c];
    return cubeCellToken((col.cells[r] ?? null) as CubeCell, col.type);
  }
  if (view.kind === "frame") {
    const col = view.frame.columns[c];
    return cubeCellToken((col.values[r] ?? null) as CubeCell, col.type);
  }
  return cubeCellToken(view.cells[r]?.[c] ?? null);
}

// RFC 4180 quoting; the viewer is read-only, so formula-trigger text is
// apostrophe-neutralized on export (the TablePopup read-only posture).
function csvEsc(s: string): string {
  let out = s;
  if (/^[=+\-@\t\r]/.test(out) && Number.isNaN(Number(out))) out = `'${out}`;
  return /[",\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}
function mdEsc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
/** Full source-order serialization of the CURRENT drill level — every row, not
 *  just the rendered window (text is cheap; only the DOM needed the cap). */
/** The level as text — every row, in the given (visual-sort) order. */
function levelText(view: DrillView, headers: string[] | null, order: readonly number[], cols: number, kind: "csv" | "md"): string {
  const head = headers ?? Array.from({ length: cols }, (_, c) => `Col ${c + 1}`);
  const row = (r: number) => Array.from({ length: cols }, (_, c) => tokenAt(view, r, c));
  if (kind === "csv") {
    const lines = [head.map(csvEsc).join(",")];
    for (const r of order) lines.push(row(r).map(csvEsc).join(","));
    return lines.join("\n");
  }
  const md = [head.map(mdEsc), head.map(() => "---")];
  for (const r of order) md.push(row(r).map(mdEsc));
  return md.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

/** The one read-only viewer for every nesting kind: a nested-container cell drills
 *  DEEPER IN PLACE via the breadcrumb, so a second window never opens. */
export function CubePopup() {
  const state = useSyncExternalStore(cubePopup.subscribe, cubePopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  // Keyed on the DRILL LEVEL, so the sort drops instead of carrying a column
  // index across to an unrelated table.
  const { sort, cycle: cycleSort } = useColumnSort(state?.stack[state.stack.length - 1]);

  if (!state) return null;
  const view = state.stack[state.stack.length - 1];
  const { headers, rows, cols, depth, cell, sortKey } = describe(view);
  // Cap rendered rows — a large nested frame would otherwise put the whole table
  // in the DOM and kill the renderer.
  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  // Visual-only sort over EVERY row: `cell()` is handed the SOURCE row index, so
  // drilling still lands on the right nested value; the render shows the first
  // MAX_VISIBLE_ROWS of the order, Copy emits all of it.
  const sortOrder = sortedOrder(rows, sort, sortKey);
  const visibleOrder = rowsTruncated ? sortOrder.slice(0, MAX_VISIBLE_ROWS) : sortOrder;

  const grouped = !!state.groupColor;
  const cardStyle = popupCardVars(state);

  return (
    <PopupShell
      title={view.label}
      onClose={() => cubePopup.close()}
      // Esc pops one drill level; at the root it closes.
      onEscape={() => {
        if (state.stack.length > 1) cubePopup.backTo(state.stack.length - 2);
        else cubePopup.close();
      }}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      headerExtra={
        <>
          <span className="table-popup__dims">{rows}×{cols}{rowsTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>
          {depth !== null && (
            <span
              className="table-popup__dims"
              title={depth > 1
                ? `This cube nests ${depth} levels of cubes deep. Drill into the chips to reach them.`
                : "A flat cube, with no cube nested inside"}
            >
              Depth {depth}
            </span>
          )}
        </>
      }
      pinNodeId={state.stack.length === 1 ? state.pinNodeId : undefined}
      headerActions={
        <PopupOverflowMenu
          items={[
            { label: "Copy CSV", onClick: () => void copyText(levelText(view, headers, sortOrder, cols, "csv")) },
            { label: "Copy as Markdown", onClick: () => void copyText(levelText(view, headers, sortOrder, cols, "md")) },
            {
              label: "Export CSV…",
              onClick: () => {
                const base = (view.label || "cube").replace(/[^\w.-]+/g, "_") || "cube";
                void saveCsvFileDialog(`${base}.csv`, levelText(view, headers, sortOrder, cols, "csv"));
              },
            },
          ]}
        />
      }
    >
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
                <th
                  key={c}
                  title={headers?.[c]}
                  onClick={() => cycleSort(c)}
                  className={`${headers ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"} table-popup__colhead--sortable`}
                >
                  {headers ? headers[c] : c + 1}
                  <SortIndicator dir={sortDirOf(sort, c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleOrder.map((r) => (
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
    </PopupShell>
  );
}
