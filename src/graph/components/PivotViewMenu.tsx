// [[C127]] pivotView
// The Pivot view's right-click menu: what Excel's PivotTable menu offers on an item, a value or a field, acting on the
// Pivot card's own settings, so the output changes as Configure Fields would change it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AggOp } from "../frameOps";
import { formatFrameCell, type FrameCell } from "../frame";
import type { FormatAnnotation } from "../formatAnnotationStore";
import type { PivotConfig } from "../pivotConfig";
import { DATE_GROUPS, dateGroupOf, pivotKey, regroupField } from "../pivotConfig";
import { FUNC_CAPTION, groupKey, valueCaption, type PivotLayout, type PivotViewOptions } from "../pivotLayout";
import { useOutsideClose, type PointerMenuItem, type PointerMenuSection } from "./TableEditMenu";
import { useEscapeLayer } from "./escapeLayers";
import { PivotFilterList } from "./PivotFilterList";

/** What a right-click landed on. */
export type PivotMenuTarget =
  | { kind: "item"; axis: "rows" | "cols"; field: number; key: FrameCell; text: string }
  | { kind: "field"; axis: "rows" | "cols"; field: number }
  | { kind: "value"; value: number; text?: string };

/** The Pivot card behind the view, which the menu edits. */
export interface PivotMenuHost {
  /** The card's function for a value field with none of its own. */
  agg: AggOp;
  /** An input column's type, for a field the layout does not place (a filter alone). */
  typeOf(field: string): string;
  config(): PivotConfig;
  apply(next: PivotConfig): void;
  keysOf(field: string): Promise<{ keys: string[]; total: number }>;
}

/** Excel's short list; the rest are in Configure Fields, and a field already on one of them lists it too. */
const SUMMARIZE: AggOp[] = ["sum", "count", "avg", "max", "min", "median"];
const SHOW_AS: { label: string; relativeTo: number }[] = [
  { label: "% of Grand Total", relativeTo: 2 }, { label: "% of Column Total", relativeTo: 0 }, { label: "% of Row Total", relativeTo: 1 },
  { label: "% of Parent Row Total", relativeTo: 4 }, { label: "% of Parent Column Total", relativeTo: 3 },
];

const copyOf = (c: PivotConfig): PivotConfig => ({
  ...c, rows: [...c.rows], cols: [...c.cols], vals: [...c.vals], details: [...c.details], funcs: { ...c.funcs }, exclude: { ...c.exclude },
});

/** The words a sort reads in, by the field's type. */
function sortWords(type: string): [string, string] {
  if (type === "number") return ["Smallest to Largest", "Largest to Smallest"];
  if (type === "date") return ["Oldest to Newest", "Newest to Oldest"];
  return ["A to Z", "Z to A"];
}

/** A value field's Number format pick, the paintbrush's: `""` is none (the value's own), null a value not a number. */
export interface PivotValueFormat {
  get(value: number): string | null;
  set(value: number, format: string): void;
}
const QUICK_FORMATS: { id: string; label: string }[] = [
  { id: "", label: "Auto" }, { id: "decimal", label: "Decimal" }, { id: "integer", label: "Integer" },
  { id: "percent", label: "Percent" }, { id: "scientific", label: "Scientific" },
];

export function pivotMenuSections({ target, layout, host, options, onOptions, copyText, format }: {
  target: PivotMenuTarget;
  layout: PivotLayout;
  host: PivotMenuHost;
  options: PivotViewOptions;
  onOptions: (next: PivotViewOptions) => void;
  copyText: (text: string) => void;
  /** Number format picks, where the popup can write them. */
  format?: PivotValueFormat;
}): PointerMenuSection[] {
  const cfg = host.config();
  const edit = (change: (c: PivotConfig) => void) => { const next = copyOf(host.config()); change(next); host.apply(next); };
  const sections: PointerMenuSection[] = [];

  const sortKey = (axis: "rows" | "cols") => (axis === "rows" ? "rowSort" : "colSort");
  // By its own values; a sort by a value is on the value's own menu.
  const sortItems = (axis: "rows" | "cols", fieldName: string | null, type: string): PointerMenuItem[] => {
    const fields = axis === "rows" ? cfg.rows : cfg.cols;
    const cur = cfg[sortKey(axis)];
    const items: PointerMenuItem[] = [];
    if (fieldName !== null) {
      const at = fields.indexOf(fieldName) + 1;
      if (at > 0) {
        const [up, down] = sortWords(type);
        items.push({ label: `Sort ${up}`, checked: cur === at, onClick: () => edit((c) => { c[sortKey(axis)] = at; }) });
        items.push({ label: `Sort ${down}`, checked: cur === -at, onClick: () => edit((c) => { c[sortKey(axis)] = -at; }) });
      }
    }
    if (items.length) items.push({ label: "Default Order", checked: cur === 0, onClick: () => edit((c) => { c[sortKey(axis)] = 0; }) });
    return items;
  };

  const fieldItems = (axis: "rows" | "cols", field: number, name: string): PointerMenuItem[] => {
    const list = axis === "rows" ? cfg.rows : cfg.cols;
    const at = list.indexOf(name);
    const other = axis === "rows" ? "Columns" : "Rows";
    const items: PointerMenuItem[] = [];
    // Collapse and Expand a whole field fold every group at its level: the view's own state, never the output.
    if (axis === "rows" && field < layout.rowFields.length - 1) {
      const keys = [...new Set(layout.rows.filter((it) => it.kind === "sub" && it.fill === field + 1).map((it) => groupKey(it.tuple.slice(0, field + 1))))];
      if (keys.length) {
        const folded = new Set(options.collapsed);
        items.push({ label: `Collapse All ${name}`, disabled: keys.every((k) => folded.has(k)), onClick: () => onOptions({ ...options, collapsed: [...new Set([...options.collapsed, ...keys])] }) });
        items.push({ label: `Expand All ${name}`, disabled: !keys.some((k) => folded.has(k)), onClick: () => onOptions({ ...options, collapsed: options.collapsed.filter((k) => !keys.includes(k)) }) });
      }
    }
    if (at > 0) items.push({ label: "Move Up", onClick: () => edit((c) => { const l = axis === "rows" ? c.rows : c.cols; [l[at - 1], l[at]] = [l[at], l[at - 1]]; }) });
    if (at >= 0 && at < list.length - 1) items.push({ label: "Move Down", onClick: () => edit((c) => { const l = axis === "rows" ? c.rows : c.cols; [l[at + 1], l[at]] = [l[at], l[at + 1]]; }) });
    if (at >= 0) {
      items.push({ label: `Move to ${other}`, onClick: () => edit((c) => {
        const from = axis === "rows" ? c.rows : c.cols, to = axis === "rows" ? c.cols : c.rows;
        from.splice(from.indexOf(name), 1);
        if (!to.includes(name)) to.push(name);
      }) });
      items.push({ label: `Remove ${name}`, onClick: () => edit((c) => { const l = axis === "rows" ? c.rows : c.cols; l.splice(l.indexOf(name), 1); }) });
    }
    return items;
  };

  const filterItems = (name: string, key: FrameCell | undefined, text: string | undefined): PointerMenuItem[] => {
    const hidden = cfg.exclude[name] ?? [];
    const items: PointerMenuItem[] = [];
    if (key !== undefined) {
      const k = pivotKey(key);
      items.push({ label: `Keep Only ${text ?? k}`, onClick: () => {
        void host.keysOf(name).then(({ keys }) => edit((c) => { c.exclude[name] = keys.filter((x) => x !== k); }));
      } });
      items.push({ label: `Hide ${text ?? k}`, onClick: () => edit((c) => { c.exclude[name] = [...new Set([...(c.exclude[name] ?? []), k])]; }) });
    }
    items.push({ label: `Clear Filter from ${name}`, disabled: hidden.length === 0, onClick: () => edit((c) => { c.exclude[name] = []; }) });
    return items;
  };

  if (target.kind === "item" || target.kind === "field") {
    const names = target.axis === "rows" ? layout.rowFields : layout.colFields;
    const types = target.axis === "rows" ? layout.rowTypes : layout.colTypes;
    const name = names[target.field];
    if (name === undefined) return sections;
    const item = target.kind === "item" ? target : null;
    sections.push({ heading: item ? `${name}: ${item.text}` : name, items: filterItems(name, item?.key, item?.text) });
    sections.push({ heading: "Sort", items: sortItems(target.axis, name, types[target.field] ?? "string") });
    // A date field, or one already grouped: Excel's Group, by a period, and back to the dates.
    const grouped = dateGroupOf(name);
    if ((grouped || types[target.field] === "date") && (target.axis === "rows" ? cfg.rows : cfg.cols).includes(name)) {
      sections.push({ heading: "Group By", items: [
        ...DATE_GROUPS.map((u) => ({ label: u, checked: grouped?.unit === u, onClick: () => host.apply(regroupField(host.config(), target.axis, name, u)) })),
        { label: "Dates", checked: !grouped, onClick: () => host.apply(regroupField(host.config(), target.axis, name, null)) },
      ] });
    }
    sections.push({ items: fieldItems(target.axis, target.field, name) });
    if (item) sections.push({ items: [{ label: "Copy", onClick: () => copyText(item.text) }] });
    return sections;
  }

  // A value: how it summarizes and shows, and how the rows sort by it.
  const v = target.value;
  const name = layout.values[v];
  const func = layout.funcs[v];
  if (name === undefined) return sections;
  if (func !== "calc") {
    const own = cfg.funcs[name] ?? host.agg;
    const share = own === "percentof";
    const ops = SUMMARIZE.includes(own) || share ? SUMMARIZE : [...SUMMARIZE, own];
    sections.push({ heading: `Summarize ${name} By`, items: ops.map((op) => ({
      label: FUNC_CAPTION[op], checked: own === op, onClick: () => edit((c) => { c.funcs[name] = op; }),
    })) });
    sections.push({ heading: "Show Values As", items: [
      { label: "No Calculation", checked: !share, onClick: () => edit((c) => { if (share) c.funcs[name] = "sum"; }) },
      ...SHOW_AS.map((o) => ({ label: o.label, checked: share && cfg.relativeTo === o.relativeTo, onClick: () => edit((c) => { c.funcs[name] = "percentof"; c.relativeTo = o.relativeTo; }) })),
    ] });
  }
  const cur = format?.get(v) ?? null;
  if (format && cur !== null) {
    const known = QUICK_FORMATS.some((f) => f.id === cur);
    sections.push({ heading: "Number Format", items: [
      ...QUICK_FORMATS.map((f) => ({ label: f.label, checked: cur === f.id, onClick: () => format.set(v, f.id) })),
      ...(known ? [] : [{ label: "Other", checked: true, onClick: () => {} }]),
    ] });
  }
  const at = cfg.rows.length + cfg.vals.indexOf(name) + 1;
  if (layout.rowFields.length && cfg.vals.includes(name)) {
    sections.push({ heading: "Sort Rows", items: [
      { label: "Largest to Smallest", checked: cfg.rowSort === -at, onClick: () => edit((c) => { c.rowSort = -at; }) },
      { label: "Smallest to Largest", checked: cfg.rowSort === at, onClick: () => edit((c) => { c.rowSort = at; }) },
    ] });
  }
  const tail: PointerMenuItem[] = [];
  if (target.text !== undefined && target.text !== "") tail.push({ label: "Copy", onClick: () => copyText(target.text!) });
  if (func !== "calc" && cfg.vals.includes(name)) {
    tail.push({ label: `Remove ${valueCaption(layout, v)}`, onClick: () => edit((c) => { c.vals.splice(c.vals.indexOf(name), 1); delete c.funcs[name]; }) });
  }
  sections.push({ items: tail });
  return sections;
}

/** A field value's key as the list shows it: a number or date in its type, the blank as `(blank)`. */
export function keyLabel(type: string, key: string, format?: FormatAnnotation | null): string {
  if (key === "") return "(blank)";
  const n = Number(key);
  if ((type === "number" || type === "date") && key.trim() !== "" && Number.isFinite(n)) {
    const f = formatFrameCell(type, n, format ?? undefined);
    return f == null ? key : String(f);
  }
  return key;
}

/**
 * A field header's ▾: the field's sort and its value checklist, as Excel's header button opens, writing the card's
 * own settings. Over a Compact header naming several fields, a pick of which one.
 */
/** A field the ▾ panel can show: its name, type and display format. */
export interface PivotPanelField { name: string; type: string; format?: FormatAnnotation | null }

/** The ▾ panel's fields for one axis of the layout. */
export function axisFields(layout: PivotLayout, axis: "rows" | "cols"): PivotPanelField[] {
  const names = axis === "rows" ? layout.rowFields : layout.colFields;
  const types = axis === "rows" ? layout.rowTypes : layout.colTypes;
  const formats = axis === "rows" ? layout.rowFormats : layout.colFormats;
  return names.map((name, i) => ({ name, type: types[i] ?? "string", format: formats?.[i] ?? null }));
}

export function PivotFieldDropdown({ at, fields, initialField = 0, host, onClose }: {
  at: { x: number; y: number };
  fields: PivotPanelField[];
  initialField?: number;
  host: PivotMenuHost;
  onClose: () => void;
}) {
  const [field, setField] = useState(initialField);
  const name = fields[field]?.name ?? "";
  const type = fields[field]?.type ?? "string";
  const [list, setList] = useState<{ name: string; keys: string[]; total: number } | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => host.config().exclude[name] ?? []);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  // The host is rebuilt with each render of the popup; the list is read once per field, never per render.
  const hostRef = useRef(host);
  hostRef.current = host;
  useEscapeLayer(true, onClose);
  useOutsideClose(true, ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at, list]);
  useEffect(() => {
    let live = true;
    setHidden(hostRef.current.config().exclude[name] ?? []);
    void hostRef.current.keysOf(name).then((r) => { if (live) setList({ name, ...r }); });
    return () => { live = false; };
  }, [name]);

  const cfg = host.config();
  // A field sorts on the axis it is placed on; a filter-only field has no sort.
  const axis: "rows" | "cols" | null = cfg.rows.includes(name) ? "rows" : cfg.cols.includes(name) ? "cols" : null;
  const sortAt = axis ? (axis === "rows" ? cfg.rows : cfg.cols).indexOf(name) + 1 : 0;
  const sortKey = axis === "cols" ? "colSort" : "rowSort";
  const cur = cfg[sortKey];
  const [up, down] = sortWords(type);
  const write = (change: (c: PivotConfig) => void) => { const next = copyOf(host.config()); change(next); host.apply(next); };
  const format = fields[field]?.format ?? null;
  const label = (k: string) => keyLabel(type, k, format);
  return (
    <div ref={ref} className="pivot-field-drop sol-popup-menu__list sol-popup-menu__list--at" role="dialog" aria-label={`${name} sort and filter`}
      style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {fields.length > 1 && (
        <select className="pivot-field-drop__pick" value={field} onChange={(e) => { setField(Number(e.target.value)); setList(null); }} aria-label="Field">
          {fields.map((f, i) => <option key={f.name} value={i}>{f.name}</option>)}
        </select>
      )}
      {sortAt > 0 && (
        <div className="sol-popup-menu__group" role="group" aria-label="Sort">
          <button type="button" role="menuitemradio" aria-checked={cur === sortAt} className={`sol-popup-menu__item${cur === sortAt ? " sol-popup-menu__item--checked" : ""}`}
            onClick={() => write((c) => { c[sortKey] = sortAt; })}>Sort {up}</button>
          <button type="button" role="menuitemradio" aria-checked={cur === -sortAt} className={`sol-popup-menu__item${cur === -sortAt ? " sol-popup-menu__item--checked" : ""}`}
            onClick={() => write((c) => { c[sortKey] = -sortAt; })}>Sort {down}</button>
        </div>
      )}
      <div className="sol-popup-menu__sep" />
      {list && list.name === name
        ? <PivotFilterList type={type} keys={list.keys} total={list.total} hidden={hidden} label={label}
            onChange={(h) => { setHidden(h); write((c) => { c.exclude[name] = h; }); }} />
        : <div className="pivot-field-drop__wait">…</div>}
    </div>
  );
}
