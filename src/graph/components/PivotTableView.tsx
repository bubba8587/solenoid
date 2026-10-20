// [[C127]] pivotView
import { useState, type ReactNode } from "react";
import {
  buildPivotModel, emptyText, filterPivotBody, groupKey, totalsModes, valueCaption,
  type GrandMode, type PivotBodyRow, type PivotEmpty, type PivotForm, type PivotLayout, type PivotTotals, type PivotViewOptions, type SubtotalMode,
} from "../pivotLayout";
import { formatFrameCell, type FrameCell } from "../frame";
import { MinusSquareIcon, PlusSquareIcon } from "./Icons";
import "./PivotTableView.css";

const FORM_OPTIONS: { value: PivotForm; label: string }[] = [
  { value: "compact", label: "Compact Form" }, { value: "outline", label: "Outline Form" }, { value: "tabular", label: "Tabular Form" },
];
const SUB_OPTIONS: { value: SubtotalMode; label: string }[] = [
  { value: "none", label: "No Subtotals" }, { value: "bottom", label: "Subtotals at Bottom" }, { value: "top", label: "Subtotals at Top" },
];
const GRAND_OPTIONS: { value: GrandMode; label: string }[] = [
  { value: "off", label: "No Grand Totals" }, { value: "both", label: "Grand Totals for Rows and Columns" },
  { value: "rows", label: "Grand Totals for Rows Only" }, { value: "cols", label: "Grand Totals for Columns Only" },
];
const EMPTY_OPTIONS: { value: PivotEmpty; label: string }[] = [
  { value: "blank", label: "Empty Cells Blank" }, { value: "zero", label: "Empty Cells as 0" }, { value: "dash", label: "Empty Cells as –" },
];

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

export function PivotTableView({ layout, options, onOptions, totals, cellText, isErrorAt, valueFormat, onFields, query }: {
  layout: PivotLayout;
  options: PivotViewOptions;
  onOptions: (next: PivotViewOptions) => void;
  /** The node's own totals, when the popup can reach the Pivot node. */
  totals?: PivotTotalsControl;
  /** A value cell's shown text, by frame row and frame column. */
  cellText: (r: number, c: number) => string;
  isErrorAt: (r: number, c: number) => boolean;
  /** The Number format pick for one value field, drawn after its caption. */
  valueFormat?: (v: number) => ReactNode;
  onFields?: () => void;
  query: string;
}) {
  // On a narrow screen the options beyond the layout fold away behind Options.
  const [moreOpen, setMoreOpen] = useState(false);
  const model = buildPivotModel(layout, options, itemText(layout.rowTypes), itemText(layout.colTypes));
  const set = (patch: Partial<PivotViewOptions>) => onOptions({ ...options, ...patch });
  const keyCols = layout.rowFields.length;
  const compact = options.form === "compact";
  const modes = totals ? totalsModes(totals.totals) : null;
  const allFoldKeys = (): string[] => {
    const keys = new Set<string>();
    for (const it of layout.rows) {
      if (it.kind === "sub") keys.add(groupKey(it.tuple.slice(0, it.fill)));
    }
    return [...keys];
  };
  const toggleFold = (key: string) => {
    const cur = new Set(options.collapsed);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    set({ collapsed: [...cur] });
  };

  const shownBody = query.trim() ? filterPivotBody(model.body, query) : model.body;

  const select = <T extends string>(value: T, opts: { value: T; label: string }[], onChange: (v: T) => void, title: string) => (
    <select className="pivot-view__select" value={value} title={title} aria-label={title} onChange={(e) => onChange(e.target.value as T)}>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const toggle = (key: "repeatLabels" | "blankRows" | "bandedRows" | "bandedCols" | "fieldHeaders", label: string, title: string, disabled = false) => (
    <button type="button" className="pivot-view__toggle" aria-pressed={options[key]} disabled={disabled} title={title} onClick={() => set({ [key]: !options[key] })}>{label}</button>
  );

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
    <div className={`pivot-view${moreOpen ? " pivot-view--more" : ""}`}>
      <div className="pivot-view__bar" role="toolbar" aria-label="Pivot table layout">
        {select(options.form, FORM_OPTIONS, (form) => set({ form }), "Report layout")}
        <button type="button" className="pivot-view__toggle pivot-view__more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>Options</button>
        <span className="pivot-view__extra">
        {modes && totals && select(modes.sub, SUB_OPTIONS, totals.setSubtotals, "Subtotals. They change the Pivot's output.")}
        {modes && totals && select(modes.grand, GRAND_OPTIONS, totals.setGrand, "Grand totals. They change the Pivot's output.")}
        {select(options.emptyAs, EMPTY_OPTIONS, (emptyAs) => set({ emptyAs }), "What an empty value cell shows")}
        <span className="pivot-view__group" role="group" aria-label="Layout options">
          {toggle("repeatLabels", "Repeat Labels", "Repeat each item's label on every row of its group", compact || keyCols < 2)}
          {toggle("blankRows", "Blank Rows", "Put a blank row after each group", keyCols < 2)}
          {toggle("fieldHeaders", "Field Headers", "Show the field names over the labels")}
        </span>
        <span className="pivot-view__group" role="group" aria-label="Banding">
          {toggle("bandedRows", "Banded Rows", "Shade every other row")}
          {toggle("bandedCols", "Banded Columns", "Shade every other column")}
        </span>
        {model.foldable && (
          <span className="pivot-view__group" role="group" aria-label="Groups">
            <button type="button" className="pivot-view__toggle" onClick={() => set({ collapsed: [] })} disabled={options.collapsed.length === 0}>Expand All</button>
            <button type="button" className="pivot-view__toggle" onClick={() => set({ collapsed: allFoldKeys() })}>Collapse All</button>
          </span>
        )}
        </span>
        {onFields && <button type="button" className="pivot-view__toggle pivot-view__fields" onClick={onFields}>Fields</button>}
      </div>
      {valueFormat && (
        <div className="pivot-view__formats">
          <span className="pivot-view__formats-lead">Format</span>
          {layout.values.map((_, v) => (
            <span key={v} className="pivot-view__format">
              <span className="pivot-view__format-name">{valueCaption(layout, v)}</span>
              {valueFormat(v)}
            </span>
          ))}
        </div>
      )}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
