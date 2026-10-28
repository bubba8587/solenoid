// [[B11]] maximalMerge
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { dashboardStore } from "../dashboardStore";
import { cableValueStore } from "../cableValueStore";
import { appThemeStore } from "../appTheme";
import { getOwningEditor } from "../activeGraph";
import { flyToNode } from "../flyToNode";
import { scheduleAutosave } from "../persistence";
import { themeAccent, resolveColor, contrastInk, darkenAccent, hexToRgba } from "../palette";
import { DashboardNode } from "../nodeClasses";
import { writeRecordLayout, type RecordPlacement } from "../recordLayout";
import { InlineRefValue } from "./inlineRefDisplay";
import { TableCards } from "./TableCards";
import type { ColumnSort } from "./columnSort";
import { isFrameValue, formatFrameCell, type FrameValue, type FrameColumn } from "../frame";
import { formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatScalar } from "./format";
import { commitDashboardLayout } from "./DashboardNode";
import { SwatchGrid } from "./SwatchGrid";
import { CloseIcon } from "./CloseIcon";
import { FocusIcon, TableIcon, Maximize2Icon, Minimize2Icon, FullscreenIcon, ExitFullscreenIcon, PencilIcon } from "./Icons";
import { useEscapeToClose } from "./useEscapeToClose";
import { useEscapeLayer } from "./escapeLayers";
import { useDismissOnOutside } from "./useDismissOnOutside";
import "./Markdown.css";
import "./ReportOverlay.css";
import "./DashboardOverlay.css";

const GAP = 12;

/** A box's rendered contents as static markup, canvases as pictures: edit mode shows this, so nothing re-renders
 *  or re-measures under a drag. It is the app's own render, already sanitized at its seams ([[C103]] untrustedContentSeams). */
type Snapshot = { html: string; w: number; h: number };

function snapshotOf(el: HTMLElement): Snapshot {
  const clone = el.cloneNode(true) as HTMLElement;
  const live = el.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((copy, i) => {
    try {
      const img = document.createElement("img");
      img.src = live[i].toDataURL();
      img.style.cssText = live[i].style.cssText;
      img.width = live[i].clientWidth;
      img.height = live[i].clientHeight;
      copy.replaceWith(img);
    } catch { /* a tainted canvas stays blank */ }
  });
  return { html: clone.innerHTML, w: el.clientWidth, h: el.clientHeight };
}

function FrozenBox({ snap }: { snap?: Snapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = snap && box.w && box.h ? Math.min(box.w / snap.w, box.h / snap.h) : 0;
  return (
    <div ref={ref} className="dashboard-box__frozen">
      {snap && s > 0 && (
        <div
          className="dashboard-box__value sol-md"
          style={{ width: snap.w, height: snap.h, transform: `scale(${s})`, left: (box.w - snap.w * s) / 2, top: (box.h - snap.h * s) / 2 }}
          dangerouslySetInnerHTML={{ __html: snap.html }}
        />
      )}
    </div>
  );
}

/** A Frame as the Table popup's Cards view, read-only: the box's alternative to the grid. */
function FrameCards({ frame }: { frame: FrameValue }) {
  const [sort, setSort] = useState<ColumnSort>([]);
  const cols = frame.columns;
  const rows = cols[0]?.values.length ?? 0;
  const shown = (c: FrameColumn, r: number): string => {
    const v = formatFrameCell(c.type, c.values[r] ?? null, c.format);
    return typeof v === "number" ? (c.format ? formatNumberWithAnnotation(v, c.format) : formatScalar(v)) : v ?? "";
  };
  return (
    <TableCards
      names={cols.map((c) => c.name)}
      types={cols.map((c) => c.type)}
      computed={NO_COLS}
      chipCols={NO_COLS}
      rowCount={rows}
      order={Array.from({ length: rows }, (_, r) => r)}
      rawAt={(r, c) => cols[c].raw?.[r] ?? shown(cols[c], r)}
      shownRow={(r) => cols.map((c) => shown(c, r))}
      dataKey={frame}
      sort={sort}
      onSort={setSort}
      query=""
    />
  );
}
const NO_COLS: ReadonlySet<number> = new Set();

function BoxMenu({ color, cards, onCards, onExpand, onLocate, onColor, onRename, onRemove }: {
  color?: string;
  /** Present only on a box holding a Frame: whether it shows as cards, and the switch. */
  cards?: boolean;
  onCards?: () => void;
  onExpand: () => void;
  onLocate?: () => void;
  onColor: (slot: string | null) => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), [btn, pop]);
  useEscapeLayer(open, () => setOpen(false));
  const act = (f: () => void) => () => { setOpen(false); f(); };
  const r = open ? btn.current?.getBoundingClientRect() : undefined;
  return (
    <span className="dashboard-box__menu">
      <button ref={btn} type="button" className="dashboard-box__dots" aria-label="Box actions" title="Box actions" onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && r && createPortal(
        <div ref={pop} className="dashboard-box__pop" style={{ top: r.bottom + 4, right: window.innerWidth - r.right }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="dashboard-box__item" onClick={act(onExpand)}><Maximize2Icon size={14} />Expand</button>
          {onLocate && <button type="button" className="dashboard-box__item" onClick={act(onLocate)}><FocusIcon size={14} />Show on Canvas</button>}
          {onCards && <button type="button" className="dashboard-box__item" onClick={act(onCards)}><TableIcon size={14} />{cards ? "Show as Table" : "Show as Cards"}</button>}
          <div className="dashboard-box__swatches">
            <SwatchGrid value={color} onPick={(slot) => { setOpen(false); onColor(slot); }} />
            {color && <button type="button" className="dashboard-box__item" onClick={act(() => onColor(null))}>No Color</button>}
          </div>
          <button type="button" className="dashboard-box__item" onClick={act(onRename)}><PencilIcon size={14} />Rename</button>
          <button type="button" className="dashboard-box__item dashboard-box__item--danger" onClick={act(onRemove)}><CloseIcon size={14} />Remove</button>
        </div>,
        // Inside the overlay, not the body: in full screen only the overlay shows.
        btn.current?.closest(".dashboard-overlay") ?? document.body,
      )}
    </span>
  );
}

type EditState = { layout: Layout; snaps: Map<string, Snapshot>; rowHeight: number; cols: number };

/** Its own component, so the width hook measures an element that exists from its first render. */
function EditGrid({ edit, setEdit, box }: {
  edit: EditState;
  setEdit: (f: (e: EditState | null) => EditState | null) => void;
  box: (name: string) => ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const rows = Math.max(1, ...edit.layout.map((l) => l.y + l.h)) + 1;
  const colW = (width - GAP * 2 - GAP * (edit.cols - 1)) / edit.cols;
  return (
    <div ref={containerRef} className="dashboard-edit">
      {mounted && (
        <>
          {Array.from({ length: rows * edit.cols }, (_, k) => (
            <div
              key={k}
              className="dashboard-edit__cell"
              style={{
                left: GAP + (k % edit.cols) * (colW + GAP), top: GAP + Math.floor(k / edit.cols) * (edit.rowHeight + GAP),
                width: colW, height: edit.rowHeight,
              }}
            />
          ))}
          <ReactGridLayout
            width={width}
            layout={edit.layout}
            gridConfig={{ cols: edit.cols, rowHeight: edit.rowHeight, margin: [GAP, GAP], containerPadding: [GAP, GAP] }}
            resizeConfig={{ handles: ["se", "e", "s"] }}
            onLayoutChange={(layout) => setEdit((e) => e && { ...e, layout: [...layout] })}
          >
            {edit.layout.map((l) => box(l.i))}
          </ReactGridLayout>
        </>
      )}
    </div>
  );
}

export function DashboardOverlay() {
  const nodeId = useSyncExternalStore(dashboardStore.subscribe, dashboardStore.openNodeId);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const found = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  const node = found instanceof DashboardNode ? found : undefined;

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => { setFocus(null); setEdit(null); setRenaming(null); }, [nodeId]);
  useEscapeLayer(!!renaming, () => setRenaming(null));
  useEscapeLayer(!!focus, () => setFocus(null));
  useEscapeLayer(!!edit, () => setEdit(null));
  useEscapeToClose(() => dashboardStore.close(), !!node);
  // A covered canvas stops painting ([[html-in-canvas#The GPU texture budget]]), a drill-in's included.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sol-dashboard-open", !!node);
    return () => root.classList.remove("sol-dashboard-open");
  }, [node]);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (!node) return null;

  const placed = node.placements();
  const cols = placed.length ? Math.max(...placed.map((p) => p.col + p.colSpan - 1)) : 1;
  const rows = placed.length ? Math.max(...placed.map((p) => p.row + p.rowSpan - 1)) : 1;
  const mode = appThemeStore.getMode();
  // A Group's colors ([[C88]] collapsedGroupCard's header and fill, GroupNode.tsx): a solid header in the slot's
  // color with contrast ink, a border darkened in light mode, and the body washed with the color.
  const tint = (name: string): CSSProperties | undefined => {
    const slot = node.boxColors[name];
    if (!slot) return undefined;
    const base = resolveColor(slot);
    const color = themeAccent(base, mode);
    return {
      "--box-color": color,
      "--box-ink": contrastInk(color),
      "--box-border": mode === "light" ? darkenAccent(base) : color,
      "--box-fill": hexToRgba(color, mode === "light" ? 0.14 : 0.08),
    } as CSSProperties;
  };
  const sourceOf = (name: string) => getOwningEditor(node.id)?.getConnections().find((c) => c.target === node.id && c.targetInput === name)?.source;

  function startEdit() {
    const grid = gridRef.current;
    if (!grid) return;
    const snaps = new Map<string, Snapshot>();
    grid.querySelectorAll<HTMLElement>(".dashboard-box[data-name]").forEach((el) => {
      const value = el.querySelector<HTMLElement>(".dashboard-box__value");
      if (value) snaps.set(el.dataset.name!, snapshotOf(value));
    });
    const rowHeight = Math.max(80, Math.floor((grid.clientHeight - GAP * 2 - GAP * (rows - 1)) / rows));
    setFocus(null);
    setEdit({ layout: placed.map((p) => ({ i: p.name, x: p.col - 1, y: p.row - 1, w: p.colSpan, h: p.rowSpan })), snaps, rowHeight, cols: Math.max(cols, 2) });
  }

  async function finishEdit() {
    if (!edit || !node) return;
    const byName = new Map(placed.map((p) => [p.name, p]));
    const next: RecordPlacement[] = edit.layout.map((l) => ({
      ...byName.get(l.i), name: l.i, row: l.y + 1, col: l.x + 1, rowSpan: l.h, colSpan: l.w,
    }));
    setEdit(null);
    await commitDashboardLayout(node, writeRecordLayout(next));
  }

  /** A new name the layout can hold: not blank, not another box's, and free of the grammar's marks. */
  async function renameBox(from: string, raw: string) {
    setRenaming(null);
    const to = raw.trim();
    if (!node || !to || to === from || to === "." || /[|*:\n]/.test(to) || to.startsWith("#")) return;
    if (placed.some((p) => p.name !== from && p.name.toLowerCase() === to.toLowerCase())) return;
    const next = placed.map((p) => (p.name === from ? { ...p, name: to } : p));
    await commitDashboardLayout(node, writeRecordLayout(next), new Map([[to, from]]));
  }

  async function removeBox(name: string) {
    if (!node) return;
    await commitDashboardLayout(node, writeRecordLayout(placed.filter((p) => p.name !== name)));
  }

  function setColor(name: string, slot: string | null) {
    if (!node) return;
    if (slot) node.boxColors = { ...node.boxColors, [name]: slot };
    else { const { [name]: _gone, ...rest } = node.boxColors; node.boxColors = rest; }
    node.edited();
    scheduleAutosave();
    cableValueStore.bump();
  }

  function toggleCards(name: string) {
    if (!node) return;
    if (node.boxViews[name]) { const { [name]: _gone, ...rest } = node.boxViews; node.boxViews = rest; }
    else node.boxViews = { ...node.boxViews, [name]: "cards" };
    node.edited();
    scheduleAutosave();
    cableValueStore.bump();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }

  const shown = focus ? placed.filter((p) => p.name === focus) : placed;

  return (
    <div ref={rootRef} className="dashboard-overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div className="report-header">
        <span className="report-title">
          {node.label?.trim() || "Dashboard"}
          {focus && <span className="dashboard-crumb"> › {focus}</span>}
        </span>
        <div className="report-header-actions">
          {edit ? (
            <>
              <span className="dashboard-cols">
                Columns
                <button type="button" className="dashboard-step" aria-label="Fewer columns" disabled={edit.cols <= 1} onClick={() => setEdit({ ...edit, cols: edit.cols - 1 })}>−</button>
                <span className="dashboard-cols__n">{edit.cols}</span>
                <button type="button" className="dashboard-step" aria-label="More columns" disabled={edit.cols >= 12} onClick={() => setEdit({ ...edit, cols: edit.cols + 1 })}>+</button>
              </span>
              <button type="button" className="report-embed-btn" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="report-embed-btn dashboard-done" onClick={() => void finishEdit()}>Done</button>
            </>
          ) : (
            <>
              {focus && (
                <button type="button" className="report-close" onClick={() => setFocus(null)} title="Back to the board (Esc)" aria-label="Back to the board">
                  <Minimize2Icon size={16} />
                </button>
              )}
              {placed.length > 0 && !focus && (
                <button type="button" className="report-embed-btn dashboard-edit-btn" onClick={startEdit}>
                  <PencilIcon size={12} />Edit Layout
                </button>
              )}
              {document.fullscreenEnabled && (
                <button type="button" className="report-close" onClick={toggleFullscreen} title={fullscreen ? "Exit full screen" : "Full screen"} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>
                  {fullscreen ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
                </button>
              )}
            </>
          )}
          <button className="report-close" onClick={() => dashboardStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      {edit ? (
        <EditGrid
          edit={edit}
          setEdit={setEdit}
          box={(name) => (
            <section key={name} className={`dashboard-box dashboard-box--edit${node.boxColors[name] ? " dashboard-box--tinted" : ""}`} style={tint(name)}>
              <div className="dashboard-box__label">{name}</div>
              <FrozenBox snap={edit.snaps.get(name)} />
            </section>
          )}
        />
      ) : placed.length > 0 ? (
        <div
          ref={gridRef}
          className="dashboard-grid"
          style={{ gridTemplateColumns: focus ? "minmax(0, 1fr)" : `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {shown.map((p) => {
            const source = sourceOf(p.name);
            const value = node.refValue(p.name);
            const asCards = !!node.boxViews[p.name] && isFrameValue(value);
            return (
              <section
                key={p.name}
                data-name={p.name}
                className={`dashboard-box${node.boxColors[p.name] ? " dashboard-box--tinted" : ""}`}
                style={{ ...(focus ? { gridRow: "1 / -1", gridColumn: "1" } : { gridRow: `${p.row} / span ${p.rowSpan}`, gridColumn: `${p.col} / span ${p.colSpan}` }), ...tint(p.name) }}
              >
                <div className="dashboard-box__label" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button, input")) setFocus(focus ? null : p.name); }}>
                  {renaming === p.name ? (
                    <input
                      className="dashboard-box__rename"
                      defaultValue={p.name}
                      autoFocus
                      spellCheck={false}
                      aria-label="Box name"
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      onBlur={(e) => { if (renaming === p.name) void renameBox(p.name, e.currentTarget.value); }}
                    />
                  ) : <span className="dashboard-box__name">{p.name}</span>}
                  <BoxMenu
                    color={node.boxColors[p.name]}
                    cards={asCards}
                    onCards={isFrameValue(value) ? () => toggleCards(p.name) : undefined}
                    onExpand={() => setFocus(p.name)}
                    onLocate={source ? () => { dashboardStore.close(); flyToNode(source); } : undefined}
                    onColor={(slot) => setColor(p.name, slot)}
                    onRename={() => setRenaming(p.name)}
                    onRemove={() => void removeBox(p.name)}
                  />
                </div>
                <div className="dashboard-box__value sol-md">
                  {value === undefined
                    ? <span className="dashboard-box__hint">{p.hint || "—"}</span>
                    : asCards && isFrameValue(value)
                      ? <FrameCards frame={value} />
                      : <InlineRefValue nodeId={node.id} refKey={p.name} rich fill />}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="dashboard-empty">Empty layout</div>
      )}
    </div>
  );
}
