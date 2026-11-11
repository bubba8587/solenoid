// [[C127]] pivotView
// The Pivot view's right-click menu: what Excel's PivotTable menu offers on an item, a value or a field, acting on the
// Pivot card's own settings, so the output changes as Configure Fields would change it.
import type { AggOp } from "../frameOps";
import type { FrameCell } from "../frame";
import type { PivotConfig } from "../pivotConfig";
import { pivotKey } from "../pivotConfig";
import { FUNC_CAPTION, groupKey, valueCaption, type PivotLayout, type PivotViewOptions } from "../pivotLayout";
import type { PointerMenuItem, PointerMenuSection } from "./TableEditMenu";

/** What a right-click landed on. */
export type PivotMenuTarget =
  | { kind: "item"; axis: "rows" | "cols"; field: number; key: FrameCell; text: string }
  | { kind: "field"; axis: "rows" | "cols"; field: number }
  | { kind: "value"; value: number; text?: string };

/** The Pivot card behind the view, which the menu edits. */
export interface PivotMenuHost {
  /** The card's function for a value field with none of its own. */
  agg: AggOp;
  config(): PivotConfig;
  apply(next: PivotConfig): void;
  keysOf(field: string): Promise<string[]>;
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

export function pivotMenuSections({ target, layout, host, options, onOptions, copyText }: {
  target: PivotMenuTarget;
  layout: PivotLayout;
  host: PivotMenuHost;
  options: PivotViewOptions;
  onOptions: (next: PivotViewOptions) => void;
  copyText: (text: string) => void;
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
    if (items.length) items.push({ label: "No Sort", checked: cur === 0, onClick: () => edit((c) => { c[sortKey(axis)] = 0; }) });
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
        void host.keysOf(name).then((keys) => edit((c) => { c.exclude[name] = keys.filter((x) => x !== k); }));
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
