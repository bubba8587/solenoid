// [[C10]] socketLattice
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cubePopup, type DrillView } from "../cubePopupStore";
import { CubeEditCell, ListEditCell, CubeEditRows, CubeEditHeader } from "./cubeEditCell";
import { appThemeStore } from "../appTheme";
import { cubeRowCount, cubeDepth, frameRowCount, type CubeCell } from "../frame";
import { CubeCellChip, frameCellNode, cubeCellToken } from "./cubeCell";
import { PopupShell, popupCardVars } from "./PopupShell";
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { useColumnSort, sortedOrder, sortKeyOf, sortDirOf, SortButton, type SortKey } from "./columnSort";
import { copyText } from "../clipboard";
import { saveCsvFileDialog } from "../fileBridge";
import { csvField } from "../csvSafety";
import { APP_LOCALE } from "../locale";
import "./TablePopup.css";

/** What was typed, for the Source switch: a value as its text, a nested container still a chip. */
function sourceItem(v: unknown, crumb: string, at: { r: number; c: number }): ReactNode {
  if (v !== null && typeof v === "object") return <CubeCellChip cell={v as CubeCell} crumb={crumb} size="sm" at={at} />;
  return v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
}

function describe(view: DrillView, listVertical: boolean, source: boolean): {
  headers: string[] | null;
  rows: number;
  cols: number;
  depth: number | null;
  cell: (r: number, c: number) => ReactNode;
  sortKey: (r: number, c: number) => SortKey;
} {
  if (view.kind === "cube") {
    const cube = view.cube;
    return {
      headers: cube.columns.map((c) => c.name),
      rows: cubeRowCount(cube),
      cols: cube.columns.length,
      depth: cubeDepth(cube),
      cell: (r, c) => <CubeCellChip cell={cube.columns[c].cells[r] ?? null} crumb={cube.columns[c].name} size="sm" type={cube.columns[c].type} format={cube.columns[c].format} at={{ r, c }} />,
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
  if (view.kind === "list") {
    const items = view.items;
    const item = (i: number, at: { r: number; c: number }) => (source
      ? sourceItem(items[i] ?? null, "item", at)
      : <CubeCellChip cell={(items[i] ?? null) as CubeCell} crumb="item" size="sm" type={view.type} at={at} />);
    if (!listVertical) {
      return {
        headers: null,
        rows: 1,
        cols: items.length,
        depth: null,
        cell: (_r, c) => item(c, { r: 0, c }),
        sortKey: (_r, c) => sortKeyOf(items[c] ?? null),
      };
    }
    return {
      headers: [view.label],
      rows: items.length,
      cols: 1,
      depth: null,
      cell: (r) => item(r, { r, c: 0 }),
      sortKey: (r) => sortKeyOf(items[r] ?? null),
    };
  }
  const g = view.cells;
  return {
    headers: null,
    rows: g.length,
    cols: g.reduce((m, row) => Math.max(m, row.length), 0),
    depth: null,
    cell: (r, c) => <CubeCellChip cell={g[r]?.[c] ?? null} crumb="item" size="sm" at={{ r, c }} />,
    sortKey: (r, c) => sortKeyOf(g[r]?.[c] ?? null),
  };
}

function tokenAt(view: DrillView, r: number, c: number, listVertical: boolean): string {
  if (view.kind === "cube") {
    const col = view.cube.columns[c];
    return cubeCellToken(col.cells[r] ?? null, col.type);
  }
  if (view.kind === "frame") {
    const col = view.frame.columns[c];
    return cubeCellToken(col.values[r] ?? null, col.type);
  }
  if (view.kind === "list") return cubeCellToken((view.items[listVertical ? r : c] ?? null) as CubeCell);
  return cubeCellToken(view.cells[r]?.[c] ?? null);
}

const csvEsc = (s: string): string => csvField(s, true);
function mdEsc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function levelText(view: DrillView, headers: string[] | null, order: readonly number[], cols: number, kind: "csv" | "md", listVertical: boolean): string {
  const head = headers ?? Array.from({ length: cols }, (_, c) => `Col ${c + 1}`);
  const row = (r: number) => Array.from({ length: cols }, (_, c) => tokenAt(view, r, c, listVertical));
  if (kind === "csv") {
    const lines = [head.map(csvEsc).join(",")];
    for (const r of order) lines.push(row(r).map(csvEsc).join(","));
    return lines.join("\n");
  }
  const md = [head.map(mdEsc), head.map(() => "---")];
  for (const r of order) md.push(row(r).map(mdEsc));
  return md.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

export function CubePopup() {
  const state = useSyncExternalStore(cubePopup.subscribe, cubePopup.get);
  const last = state?.stack[state.stack.length - 1];
  const editView = state?.edit && last && last.path ? last : null;
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const { sort, cycle: cycleSort } = useColumnSort(state?.stack[state.stack.length - 1]);
  const [listVertical, setListVertical] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const focus = state?.stack[state.stack.length - 1]?.focus;
  useEffect(() => {
    if (!focus || !gridRef.current) return;
    const sel = focus.c === undefined ? `[data-r="${focus.r}"]` : `[data-r="${focus.r}"][data-c="${focus.c}"]`;
    const el = gridRef.current.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.classList.add("table-popup__cell--return");
    const t = window.setTimeout(() => el.classList.remove("table-popup__cell--return"), 1200);
    return () => window.clearTimeout(t);
  }, [focus]);

  if (!state) return null;
  const view = state.stack[state.stack.length - 1];
  const { headers, rows, cols, depth, cell, sortKey } = describe(view, listVertical, sourceMode);
  const sortable = !(view.kind === "list" && !listVertical);
  const MAX_VISIBLE_ROWS = 1000;
  const rowsTruncated = rows > MAX_VISIBLE_ROWS;
  const sortOrder = sortedOrder(rows, sort, sortKey);
  const visibleOrder = rowsTruncated ? sortOrder.slice(0, MAX_VISIBLE_ROWS) : sortOrder;

  const grouped = !!state.groupColor;
  const cardStyle = popupCardVars(state);

  return (
    <PopupShell
      title={view.label}
      onClose={() => cubePopup.close()}
      onEscape={() => {
        if (state.stack.length > 1) cubePopup.backTo(state.stack.length - 2);
        else cubePopup.close();
      }}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      resizable={{ min: { w: 320, h: 220 } }}
      headerExtra={
        <>
          <span className="table-popup__dims">{view.kind === "list" ? `${view.items.length} items` : `${rows}×${cols}`}{rowsTruncated ? ` · first ${MAX_VISIBLE_ROWS.toLocaleString(APP_LOCALE)}` : ""}</span>
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
            { label: "Copy CSV", onClick: () => void copyText(levelText(view, headers, sortOrder, cols, "csv", listVertical)) },
            { label: "Copy as Markdown", onClick: () => void copyText(levelText(view, headers, sortOrder, cols, "md", listVertical)) },
            {
              label: "Export CSV…",
              onClick: () => {
                const base = (view.label || "cube").replace(/[^\w.-]+/g, "_") || "cube";
                void saveCsvFileDialog(`${base}.csv`, levelText(view, headers, sortOrder, cols, "csv", listVertical));
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

      <div ref={gridRef} className="table-popup__grid-scroll sol-popup__scroll">
        <table className="table-popup__grid">
          <thead>
            <tr>
              <th className="table-popup__corner" />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  title={headers?.[c]}
                  className={`${headers ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}${sortable ? " table-popup__colhead--sortpad" : ""}`}
                >
                  {editView && state.edit && headers && editView.kind !== "list"
                    ? <CubeEditHeader edit={state.edit} path={editView.path!} column={headers[c]} />
                    : (headers ? headers[c] : c + 1)}
                  {sortable && <SortButton dir={sortDirOf(sort, c)} onCycle={() => cycleSort(c)} label={headers?.[c]} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleOrder.map((r) => (
              <tr key={r}>
                <th className="table-popup__rowhead">{r + 1}</th>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="table-popup__cell" data-r={r} data-c={c} style={{ padding: "2px 6px", textAlign: "left" }}>
                    {editView && state.edit
                      ? (editView.kind === "list"
                          ? <ListEditCell edit={state.edit} path={editView.path!} row={listVertical ? r : c} source={sourceMode} />
                          : <CubeEditCell edit={state.edit} path={editView.path!} row={r} column={headers?.[c] ?? String(c)} source={sourceMode} />)
                      : cell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-popup__footer">
        {view.kind === "list" && (
          <div className="table-popup__view" role="group" aria-label="List layout">
            <button type="button" aria-pressed={!listVertical} onClick={() => setListVertical(false)} title="Show the list across a row">Row</button>
            <button type="button" aria-pressed={listVertical} onClick={() => setListVertical(true)} title="Show the list down a column. Display only; the value doesn't change.">Column</button>
          </div>
        )}
        {(editView || view.kind === "list") && (
          <label
            className="table-popup__source-check"
            title={editView ? "Show and edit exactly what you typed, instead of each column's typed reading." : "Show the source text instead of the formatted value."}
          >
            <input type="checkbox" checked={sourceMode} onChange={(e) => setSourceMode(e.target.checked)} />
            Source
          </label>
        )}
        {editView && state.edit && <CubeEditRows edit={state.edit} view={editView} />}
        <div className="table-popup__spacer" />
        <div className="table-popup__actions">
          <button className="table-popup__btn table-popup__btn--primary" onClick={() => cubePopup.close()}>Done</button>
        </div>
      </div>
    </PopupShell>
  );
}
