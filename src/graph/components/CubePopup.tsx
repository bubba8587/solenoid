// [[C10]] socketLattice
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cubePopup, gridPosOf, type DrillView, type CellRef } from "../cubePopupStore";
import { CubeEditCell, ListEditCell, GridEditCell, CubeEditChip, cubeEditAxes, CubeEditHeader } from "./cubeEditCell";
import { TableEditMenus, TableContextMenu, useEditShortcuts } from "./TableEditMenu";
import { pickIndex, type AxisSelection } from "../tableEdit";
import { appThemeStore } from "../appTheme";
import { cubeRowCount, cubeDepth, frameRowCount, type CubeCell } from "../frame";
import { CubeCellChip, frameCellNode, cubeCellToken, cubeCellShown } from "./cubeCell";
import { cubeLevelColumns, statValues, isContainer } from "../cubeLevelTable";
import { cardMatches } from "../cardLayout";
import { TableCards } from "./TableCards";
import { SearchIcon, ChevronDownIcon } from "./Icons";
import { settingsStore } from "../settingsStore";
import { type FooterStat, FOOTER_STAT_LABEL, STATS_BY_TYPE, footerStatFor, footerStatValue, formatFooterStat, summarizeColumn } from "./tableFooterStats";
import { PopupShell, popupCardVars } from "./PopupShell";
import { PopupOverflowMenu } from "./PopupOverflowMenu";
import { useColumnSort, sortedOrder, sortKeyOf, sortDirOf, SortButton, type SortKey } from "./columnSort";
import { HeaderHelpButton } from "./columnHeadControls";
import { copyText } from "../clipboard";
import { saveCsvFileDialog } from "../fileBridge";
import { csvField } from "../csvSafety";
import { APP_LOCALE } from "../locale";
import "./TablePopup.css";

/** What was typed, for the Source switch: a value as its text, a nested container still a chip. */
function sourceItem(v: unknown, crumb: string, at: CellRef): ReactNode {
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
    const item = (i: number) => (source
      ? sourceItem(items[i] ?? null, "item", { item: i })
      : <CubeCellChip cell={(items[i] ?? null) as CubeCell} crumb="item" size="sm" type={view.type} at={{ item: i }} />);
    if (!listVertical) {
      return {
        headers: null,
        rows: 1,
        cols: items.length,
        depth: null,
        cell: (_r, c) => item(c),
        sortKey: (_r, c) => sortKeyOf(items[c] ?? null),
      };
    }
    return {
      headers: [view.label],
      rows: items.length,
      cols: 1,
      depth: null,
      cell: (r) => item(r),
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
  const { sort, cycle: cycleSort, set: setSort } = useColumnSort(state?.stack[state.stack.length - 1]);
  const [listVertical, setListVertical] = useState(false);
  const armEditShortcuts = useEditShortcuts();
  const [sourceMode, setSourceMode] = useState(false);
  const [sel, setSel] = useState<AxisSelection | null>(null);
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [layout, setLayout] = useState<"grid" | "cards">("grid");
  const [query, setQuery] = useState("");
  const [colStat, setColStat] = useState<Record<number, FooterStat>>({});
  const showSummary = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("tablePopupSummary"));
  // A cube or frame level reads as a table: filter, Cards and the summary footer.
  const table = useMemo(() => (last ? cubeLevelColumns(last) : null), [last]);
  const summaries = useMemo(
    () => (table && showSummary ? table.columns.map((col) => summarizeColumn(statValues(col), col.type)) : null),
    [table, showSummary],
  );
  // A new level starts with nothing selected.
  const levelKey = state ? `${state.stack.length}:${JSON.stringify(state.stack[state.stack.length - 1]?.path ?? null)}` : "";
  const [seenLevel, setSeenLevel] = useState(levelKey);
  if (levelKey !== seenLevel) { setSeenLevel(levelKey); setSel(null); setFocusCell(null); setCtxMenu(null); setQuery(""); setColStat({}); }

  const gridRef = useRef<HTMLDivElement>(null);
  const listVerticalRef = useRef(listVertical);
  listVerticalRef.current = listVertical;
  const focus = state?.stack[state.stack.length - 1]?.focus;
  useEffect(() => {
    if (!focus || !gridRef.current) return;
    const at = gridPosOf(focus, listVerticalRef.current);
    const sel = at.c === undefined ? `[data-r="${at.r}"]` : `[data-r="${at.r}"][data-c="${at.c}"]`;
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
  const MAX_VISIBLE = 1000;
  const rowsTruncated = rows > MAX_VISIBLE;
  const colsTruncated = cols > MAX_VISIBLE;
  const shownCols = colsTruncated ? MAX_VISIBLE : cols;
  const sortOrder = sortedOrder(rows, sort, sortKey);
  const rowText = (r: number): string[] => (table?.columns ?? []).map((col) => cubeCellShown(col.cells[r] ?? null, col.declared, col.format));
  const filtering = !!table && query.trim() !== "";
  const matchedOrder = filtering ? sortOrder.filter((r) => cardMatches(rowText(r), query)) : sortOrder;
  const visibleOrder = matchedOrder.length > MAX_VISIBLE ? matchedOrder.slice(0, MAX_VISIBLE) : matchedOrder;
  const cards = !!table && layout === "cards";

  const grouped = !!state.groupColor;
  const cardStyle = popupCardVars(state);

  // A list across a row shows its items as columns; the menus still count items.
  const itemsAcross = view.kind === "list" && !listVertical;
  const editAxes = editView && state.edit ? cubeEditAxes(state.edit, editView, {
    rows: sel?.axis === "row" ? sel.indices : focusCell ? [itemsAcross ? focusCell.c : focusCell.r] : [],
    cols: sel?.axis === "col" ? sel.indices : focusCell ? [focusCell.c] : [],
  }) : null;
  const menuRow = sel?.axis === "col" ? undefined : editAxes?.row;
  const menuCol = sel?.axis === "row" && !itemsAcross ? undefined : editAxes?.col;
  armEditShortcuts(cards ? undefined : menuRow, cards ? undefined : menuCol, sel?.axis === "col");
  const selRows = new Set(sel?.axis === "row" ? sel.indices : []);
  const selCols = new Set(sel?.axis === "col" ? sel.indices : []);
  const isSel = (r: number, c: number) => (itemsAcross ? selRows.has(c) : selRows.has(r) || selCols.has(c));
  const onControl = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest("button, input, select, textarea, label");
  const openMenuAt = (e: React.MouseEvent) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); };
  const pick = (e: React.MouseEvent, axis: "row" | "col", i: number, order: readonly number[]) => {
    if (onControl(e)) return;
    setSel((prev) => pickIndex(prev, axis, i, e.shiftKey, order));
    setFocusCell(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const allCols = Array.from({ length: shownCols }, (_, c) => c);

  return (
    <PopupShell
      title={view.label}
      onClose={() => cubePopup.close()}
      onEscape={() => {
        if (sel) setSel(null);
        else if (focusCell) setFocusCell(null);
        else if (state.stack.length > 1) cubePopup.backTo(state.stack.length - 2);
        else cubePopup.close();
      }}
      cardClassName="table-popup"
      grouped={grouped}
      cardStyle={cardStyle}
      resizable={{ min: { w: 320, h: 220 } }}
      headerExtra={
        <>
          <span className="table-popup__dims">{view.kind === "list" ? `${view.items.length} items` : `${rows}×${cols}`}{rowsTruncated || colsTruncated ? ` · first ${MAX_VISIBLE.toLocaleString(APP_LOCALE)}` : ""}</span>
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
            ...(table ? [{ label: showSummary ? "Hide summary footer" : "Show summary footer", onClick: () => settingsStore.set("tablePopupSummary", !showSummary) }] : []),
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

      {!cards && table && rows > 1 && (
        <div className="table-cards__bar table-popup__filterbar">
          <label className="table-cards__filter">
            <SearchIcon size={12} />
            <input value={query} placeholder="Filter" aria-label="Filter rows" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {filtering && <span className="table-cards__count">{matchedOrder.length} of {rows}</span>}
        </div>
      )}
      {cards && table ? (
        <TableCards
          names={table.columns.map((c) => c.name)}
          types={table.columns.map((c) => c.type)}
          computed={new Set()}
          chipCols={new Set()}
          nestedCols={new Set(table.columns.flatMap((col, c) => (col.nested ? [c] : [])))}
          listCols={new Set(table.columns.flatMap((col, c) => (col.lists ? [c] : [])))}
          rowCount={rows}
          order={sortOrder}
          rawAt={(r, c) => {
            const v = table.columns[c]?.cells[r] ?? null;
            return v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "object" ? cubeCellToken(v) : String(v);
          }}
          shownRow={rowText}
          itemsAt={(r, c) => {
            const v = table.columns[c]?.cells[r];
            return Array.isArray(v) ? v.map((x) => cubeCellToken(x as CubeCell)).filter((t) => t !== "") : null;
          }}
          cellNodeAt={(r, c) => {
            const col = table.columns[c];
            const v = col?.cells[r] ?? null;
            if (!col || !isContainer(v)) return null;
            if (editView && state.edit && editView.kind === "cube") return <CubeEditChip edit={state.edit} path={editView.path!} row={r} column={col.name} />;
            return <CubeCellChip cell={v} crumb={col.name} size="sm" type={col.declared} format={col.format} at={{ r, c }} />;
          }}
          dataKey={table}
          sort={sort}
          onSort={setSort}
          query={query}
          onQuery={setQuery}
        />
      ) : (
      <div ref={gridRef} className="table-popup__grid-scroll sol-popup__scroll">
        <table className="table-popup__grid">
          <thead>
            <tr>
              <th className="table-popup__corner">
                {editView && state.edit && headers && editView.kind !== "list" && editView.kind !== "grid" && (
                  <HeaderHelpButton formulas={(editView.path ?? []).length === 0 && !state.edit.noFormulaColumns} lambdas={false} cube />
                )}
              </th>
              {Array.from({ length: shownCols }, (_, c) => (
                <th
                  key={c}
                  title={headers?.[c]}
                  className={`${headers ? "table-popup__colhead table-popup__colhead--name" : "table-popup__colhead"}${sortable ? " table-popup__colhead--sortpad" : ""}${isSel(-1, c) && !itemsAcross ? " table-popup__colhead--sel" : ""}`}
                  onClick={editAxes ? (e) => (itemsAcross ? pick(e, "row", c, allCols) : editAxes.col && pick(e, "col", c, allCols)) : undefined}
                  onContextMenu={editAxes ? (e) => {
                    if ((e.target as HTMLElement).closest("input, textarea")) return;
                    const axis = itemsAcross ? "row" : "col";
                    if (!itemsAcross && !editAxes.col) return;
                    if (!(axis === "row" ? selRows : selCols).has(c)) { setSel({ axis, indices: [c], anchor: c }); setFocusCell(null); }
                    openMenuAt(e);
                  } : undefined}
                >
                  {editView && state.edit && headers && editView.kind !== "list"
                    ? <CubeEditHeader edit={state.edit} path={editView.path!} column={headers[c]} />
                    : (headers ? headers[c] : c + 1)}
                  {sortable && <SortButton dir={sortDirOf(sort, c)} onCycle={() => cycleSort(c)} label={headers?.[c]} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            onFocus={editAxes ? (e) => {
              const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
              if (!el) return;
              setFocusCell({ r: Number(el.dataset.r), c: Number(el.dataset.c) });
              setSel(null);
            } : undefined}
            onContextMenu={editAxes ? (e) => {
              const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
              if (!el) return;
              const r = Number(el.dataset.r), c = Number(el.dataset.c);
              if (!isSel(r, c)) { setSel(null); setFocusCell({ r, c }); }
              openMenuAt(e);
            } : undefined}
          >
            {visibleOrder.map((r) => (
              <tr key={r}>
                <th
                  className={`table-popup__rowhead${editAxes && !itemsAcross ? " table-popup__rowhead--pick" : ""}${!itemsAcross && selRows.has(r) ? " table-popup__rowhead--sel" : ""}`}
                  onClick={editAxes && !itemsAcross ? (e) => pick(e, "row", r, visibleOrder) : undefined}
                  onContextMenu={editAxes && !itemsAcross ? (e) => {
                    e.stopPropagation();
                    if (!selRows.has(r)) { setSel({ axis: "row", indices: [r], anchor: r }); setFocusCell(null); }
                    openMenuAt(e);
                  } : undefined}
                >{r + 1}</th>
                {Array.from({ length: shownCols }, (_, c) => (
                  <td key={c} className={`table-popup__cell${editAxes && isSel(r, c) ? " table-popup__cell--sel" : ""}${editAxes && focusCell?.r === r && focusCell.c === c ? " table-popup__cell--active" : ""}`} data-r={r} data-c={c} style={{ padding: "2px 6px", textAlign: "left" }}>
                    {editView && state.edit
                      ? (editView.kind === "list"
                          ? <ListEditCell edit={state.edit} path={editView.path!} row={listVertical ? r : c} source={sourceMode} />
                          : editView.kind === "grid"
                            ? <GridEditCell edit={state.edit} path={editView.path!} row={r} col={c} source={sourceMode} />
                            : <CubeEditCell edit={state.edit} path={editView.path!} row={r} column={headers?.[c] ?? String(c)} source={sourceMode} />)
                      : cell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {table && summaries && (
            <tfoot className="table-popup__sumfoot">
              <tr>
                <th className="table-popup__corner" />
                {table.columns.slice(0, shownCols).map((col, c) => {
                  const stat = footerStatFor(col.type, colStat[c]);
                  return (
                    <td key={c} className="table-popup__statcell">
                      <span className="table-popup__statpick">
                        <span className="table-popup__statlabel">{FOOTER_STAT_LABEL[stat]}<ChevronDownIcon size={10} strokeWidth={2} /></span>
                        <select
                          className="table-popup__statselect"
                          value={stat}
                          aria-label="Summary statistic"
                          onChange={(e) => setColStat((m) => ({ ...m, [c]: e.target.value as FooterStat }))}
                        >
                          {STATS_BY_TYPE[col.type].map((k) => <option key={k} value={k}>{FOOTER_STAT_LABEL[k]}</option>)}
                        </select>
                      </span>
                      <span className="table-popup__statvalue">{formatFooterStat(stat, footerStatValue(stat, summaries[c]))}</span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      {ctxMenu && editAxes && <TableContextMenu at={ctxMenu} row={menuRow} col={menuCol} onClose={() => setCtxMenu(null)} />}
      <div className="table-popup__footer">
        {table && (
          <div className="table-popup__view" role="group" aria-label="View">
            <button type="button" aria-pressed={!cards} onClick={() => setLayout("grid")}>Grid</button>
            <button type="button" aria-pressed={cards} onClick={() => setLayout("cards")}>Cards</button>
          </div>
        )}
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
        {editAxes && !cards && <TableEditMenus row={menuRow} col={menuCol} />}
        <div className="table-popup__spacer" />
        <div className="table-popup__actions">
          <button className="table-popup__btn table-popup__btn--primary" onClick={() => cubePopup.close()}>Done</button>
        </div>
      </div>
    </PopupShell>
  );
}
