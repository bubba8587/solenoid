// [[C127]] pivotView
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildPivotModel, emptyText, filterPivotBody, groupKey, totalsModes, valueCaption,
  type GrandMode, type PivotBodyRow, type PivotEmpty, type PivotForm, type PivotLayout, type PivotTotals, type PivotViewOptions, type SubtotalMode,
} from "../pivotLayout";
import { formatFrameCell, type FrameCell } from "../frame";
import { MinusSquareIcon, PlusSquareIcon, SlidersIcon } from "./Icons";
import { PopupChoice, segmentsWidth, useFreeWidth } from "./PopupChoice";
import { useEscapeLayer } from "./escapeLayers";
import { IS_COARSE } from "../coarse";
import { APP_LOCALE } from "../locale";
import { ColumnFormatButton } from "./columnHeadControls";
import "./PivotTableView.css";

const FORM_OPTIONS: { value: PivotForm; label: string }[] = [
  { value: "compact", label: "Compact" }, { value: "outline", label: "Outline" }, { value: "tabular", label: "Tabular" },
];
const SUB_OPTIONS: { value: SubtotalMode; label: string }[] = [
  { value: "none", label: "No Subtotals" }, { value: "bottom", label: "Subtotals Below" }, { value: "top", label: "Subtotals Above" },
];
const GRAND_OPTIONS: { value: GrandMode; label: string }[] = [
  { value: "off", label: "No Grand Totals" }, { value: "both", label: "Grand Totals" },
  { value: "rows", label: "Grand Total Column" }, { value: "cols", label: "Grand Total Row" },
];
const EMPTY_OPTIONS: { value: PivotEmpty; label: string }[] = [
  { value: "blank", label: "Empty: Blank" }, { value: "zero", label: "Empty: 0" }, { value: "dash", label: "Empty: –" },
];
type Banding = "none" | "rows" | "cols" | "both";
const BAND_OPTIONS: { value: Banding; label: string }[] = [
  { value: "none", label: "No Bands" }, { value: "rows", label: "Banded Rows" }, { value: "cols", label: "Banded Columns" }, { value: "both", label: "Banded Both" },
];

const MAX_ROWS = 1000;

export interface PivotTotalsControl {
  totals: PivotTotals;
  setSubtotals: (mode: SubtotalMode) => void;
  setGrand: (mode: GrandMode) => void;
}

/** The fields' text in their own type: a date key reads as a date, not its serial. */
const itemText = (types: readonly string[]) => (field: number, cell: FrameCell): string => {
  if (cell == null) return "(blank)";
  const f = formatFrameCell((types[field] ?? "string") as never, cell);
  return f == null ? "(blank)" : String(f);
};

export interface PivotRibbonProps {
  layout: PivotLayout;
  options: PivotViewOptions;
  onOptions: (next: PivotViewOptions) => void;
  /** The node's own totals, when the popup can reach the Pivot node. */
  totals?: PivotTotalsControl;
  /** The Number format pick for one value field. */
  valueFormat?: (v: number) => ReactNode;
  /** Whether any value field carries a format pick, marking the paintbrush. */
  formatPicked?: boolean;
  onFields?: () => void;
}

/** The layout controls: one line over the table on a wide popup, or stacked in the footer's sheet on a phone (`sheet`). */
export function PivotRibbon({ layout, options, onOptions, totals, valueFormat, formatPicked = false, onFields, sheet = false }: PivotRibbonProps & { sheet?: boolean }) {
  const { ref: barRef, free } = useFreeWidth(".pivot-view__layout");
  const set = (patch: Partial<PivotViewOptions>) => onOptions({ ...options, ...patch });
  const keyCols = layout.rowFields.length;
  const compact = options.form === "compact";
  const modes = totals ? totalsModes(totals.totals) : null;
  const foldKeys = keyCols >= 2 ? [...new Set(layout.rows.filter((it) => it.kind === "sub").map((it) => groupKey(it.tuple.slice(0, it.fill))))] : [];
  const banding: Banding = options.bandedRows ? (options.bandedCols ? "both" : "rows") : options.bandedCols ? "cols" : "none";
  const select = <T extends string>(value: T, opts: { value: T; label: string }[], onChange: (v: T) => void, title: string) => (
    <PopupChoice value={value} options={opts} onChange={onChange} label={title} segmented={false} />
  );
  const toggle = (key: "repeatLabels" | "blankRows" | "fieldHeaders", label: string, title: string, disabled = false) => (
    <button type="button" aria-pressed={options[key]} disabled={disabled} title={title} onClick={() => set({ [key]: !options[key] })}>{label}</button>
  );
  return (
    <div ref={barRef} className={sheet ? "pivot-sheet__body" : "pivot-view__bar"} role="toolbar" aria-label="Pivot table layout">
      <PopupChoice
        className="pivot-view__layout"
        label="Report layout"
        value={options.form}
        options={FORM_OPTIONS}
        onChange={(form) => set({ form })}
        segmented={sheet || free >= segmentsWidth(FORM_OPTIONS.map((o) => o.label), IS_COARSE)}
      />
      {modes && totals && select(modes.sub, SUB_OPTIONS, totals.setSubtotals, "Subtotals. They change the Pivot's output.")}
      {modes && totals && select(modes.grand, GRAND_OPTIONS, totals.setGrand, "Grand totals. They change the Pivot's output.")}
      {select(options.emptyAs, EMPTY_OPTIONS, (emptyAs) => set({ emptyAs }), "What an empty value cell shows")}
      {select(banding, BAND_OPTIONS, (b) => set({ bandedRows: b === "rows" || b === "both", bandedCols: b === "cols" || b === "both" }), "Shade every other row or column")}
      <div className="table-popup__view" role="group" aria-label="Layout options">
        {toggle("repeatLabels", "Repeat Labels", "Repeat each item's label on every row of its group", compact || keyCols < 2)}
        {toggle("blankRows", "Blank Rows", "Put a blank row after each group", keyCols < 2)}
        {toggle("fieldHeaders", "Headers", "Show the field names over the labels")}
      </div>
      <div className="pivot-view__tail">
        {foldKeys.length > 0 && (
          <div className="table-popup__view" role="group" aria-label="Groups">
            <button type="button" className="sol-pill-btn--icon" onClick={() => set({ collapsed: [] })} disabled={options.collapsed.length === 0} title="Expand all groups" aria-label="Expand all groups"><PlusSquareIcon size={14} /></button>
            <button type="button" className="sol-pill-btn--icon" onClick={() => set({ collapsed: foldKeys })} title="Collapse all groups" aria-label="Collapse all groups"><MinusSquareIcon size={14} /></button>
          </div>
        )}
        {valueFormat && (
          <ColumnFormatButton picked={formatPicked} title="Value format" buttonClassName="sol-pill-btn">
            {layout.values.map((_, v) => (
              <label key={v} className="pivot-view__format">
                <span className="pivot-view__format-name">{valueCaption(layout, v)}</span>
                {valueFormat(v)}
              </label>
            ))}
          </ColumnFormatButton>
        )}
        {onFields && <button type="button" className="sol-pill-btn pivot-view__fields" onClick={onFields}>Fields</button>}
      </div>
    </div>
  );
}

/** A phone's way to the ribbon: a footer button whose sheet opens above the footer. */
export function PivotSheetButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = (e.composedPath()[0] ?? e.target) as Element | null;
      // The paintbrush's panel portals to the body, and still belongs to the sheet.
      if (wrapRef.current?.contains(t as Node) || t?.closest?.(".table-popup__fmtpanel")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  return (
    <div className="pivot-sheet" ref={wrapRef}>
      <button
        type="button"
        className="sol-pill-btn sol-pill-btn--icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Pivot table layout"
        aria-label="Pivot table layout"
        onClick={() => setOpen((o) => !o)}
      ><SlidersIcon size={14} /></button>
      {open && <div className="pivot-sheet__panel" role="dialog" aria-label="Pivot table layout">{children}</div>}
    </div>
  );
}

export function PivotTableView({ layout, options, onOptions, cellText, isErrorAt, query, ribbon }: {
  layout: PivotLayout;
  options: PivotViewOptions;
  onOptions: (next: PivotViewOptions) => void;
  /** A value cell's shown text, by frame row and frame column. */
  cellText: (r: number, c: number) => string;
  isErrorAt: (r: number, c: number) => boolean;
  query: string;
  ribbon: ReactNode;
}) {
  const model = buildPivotModel(layout, options, itemText(layout.rowTypes), itemText(layout.colTypes));
  const set = (patch: Partial<PivotViewOptions>) => onOptions({ ...options, ...patch });
  const keyCols = layout.rowFields.length;
  const compact = options.form === "compact";
  const toggleFold = (key: string) => {
    const cur = new Set(options.collapsed);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    set({ collapsed: [...cur] });
  };
  const allRows = query.trim() ? filterPivotBody(model.body, query) : model.body;
  // Drawing stops at the Grid's cap; a grand total at the bottom stays in view under it.
  const capped = allRows.length > MAX_ROWS;
  const shownBody = capped
    ? [...allRows.slice(0, MAX_ROWS), ...(allRows[allRows.length - 1].kind === "grand" ? [allRows[allRows.length - 1]] : [])]
    : allRows;

  const labelCell = (row: PivotBodyRow, col: number) => {
    const label = row.labels[col];
    const fold = row.folds?.find((f) => f.col === col);
    const indent = compact ? row.level * 16 + (model.foldable && !fold && row.kind !== "grand" ? 18 : 0) : 0;
    return (
      <th
        key={`l${col}`}
        scope="row"
        className={`pivot-view__label${label?.total ? " pivot-view__label--total" : ""}${compact && col === 0 ? " pivot-view__label--sticky" : ""}`}
        style={indent ? { paddingLeft: 6 + indent } : undefined}
      >
        <span className="pivot-view__labelin">
          {fold && (
            <button
              type="button"
              className="pivot-view__fold"
              onClick={() => toggleFold(fold.key)}
              title={fold.collapsed ? "Expand this group" : "Collapse this group"}
              aria-label={fold.collapsed ? "Expand" : "Collapse"}
              aria-expanded={!fold.collapsed}
            >
              {fold.collapsed ? <PlusSquareIcon size={12} /> : <MinusSquareIcon size={12} />}
            </button>
          )}
          {label?.text ?? ""}
        </span>
      </th>
    );
  };

  const empty = emptyText(options.emptyAs);
  return (
    <div className="pivot-view">
      {ribbon}
      <div className="pivot-view__scroll sol-popup__scroll">
        <table className={`pivot-view__table${options.bandedRows ? " pivot-view__table--band-rows" : ""}${options.bandedCols ? " pivot-view__table--band-cols" : ""}`}>
          <thead>
            {model.head.map((row, i) => (
              <tr key={i}>
                {row.map((h, k) => (
                  <th
                    key={k}
                    colSpan={h.colSpan}
                    rowSpan={h.rowSpan}
                    scope={h.role === "field" || h.role === "corner" ? undefined : "col"}
                    className={`pivot-view__head pivot-view__head--${h.role}${h.colSpan > 1 ? " pivot-view__head--span" : ""}${h.role === "corner" || h.role === "field" ? (compact ? " pivot-view__label--sticky" : "") : ""}`}
                  >{h.text}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {shownBody.map((row, i) => (
              <tr
                key={i}
                className={`pivot-view__row pivot-view__row--${row.kind}${options.bandedRows && row.band !== undefined && row.band % 2 === 1 ? " pivot-view__row--band" : ""}`}
              >
                {row.kind === "blank" ? (
                  <td colSpan={model.labelCols + layout.cols.length} className="pivot-view__blank" />
                ) : (
                  <>
                    {row.kind === "grand" && model.labelCols > 1
                      ? <th scope="row" colSpan={model.labelCols} className="pivot-view__label pivot-view__label--total">{row.labels[0]?.text}</th>
                      : Array.from({ length: model.labelCols }, (_, c) => labelCell(row, c))}
                    {layout.cols.map((col, j) => {
                      const c = keyCols + j;
                      const text = row.src === null ? "" : cellText(row.src, c);
                      const err = row.src !== null && isErrorAt(row.src, c);
                      return (
                        <td
                          key={j}
                          className={`pivot-view__value${col.kind !== "leaf" ? " pivot-view__value--total" : ""}${options.bandedCols && j % 2 === 1 ? " pivot-view__value--band" : ""}`}
                        >
                          {err ? <span className="sol-error-chip">{text}</span> : text === "" && row.src !== null ? empty : text}
                        </td>
                      );
                    })}
                  </>
                )}
              </tr>
            ))}
            {capped && (
              <tr className="pivot-view__row pivot-view__row--note">
                <td colSpan={model.labelCols + layout.cols.length} className="pivot-view__note">
                  First {MAX_ROWS.toLocaleString(APP_LOCALE)} of {allRows.length.toLocaleString(APP_LOCALE)} rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
