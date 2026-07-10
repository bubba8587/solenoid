import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pivotEditor } from "../pivotEditorStore";
import { processGraph } from "../process";
import { appThemeStore } from "../appTheme";
import type { AggOp } from "../frameVerbs";
import type { PivotNode } from "../rete-nodes";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./popupChrome.css";
import "./PivotEditorPopup.css";

// ── Option lists (the popup owns the pivot-specific selectors) ──────────────────
const FUNC_OPTIONS: { value: AggOp; label: string }[] = [
  { value: "sum", label: "SUM" }, { value: "avg", label: "AVERAGE" },
  { value: "count", label: "COUNT" }, { value: "min", label: "MIN" }, { value: "max", label: "MAX" },
  { value: "product", label: "PRODUCT" }, { value: "median", label: "MEDIAN" }, { value: "mode", label: "MODE" },
  { value: "stdev", label: "STDEV.S" }, { value: "stdevp", label: "STDEV.P" },
  { value: "var", label: "VAR.S" }, { value: "varp", label: "VAR.P" }, { value: "percentof", label: "PERCENTOF" },
];
const TOTAL_DEPTH_OPTIONS = [
  { value: "0", label: "No totals" }, { value: "1", label: "Grand total" }, { value: "2", label: "Grand + subtotals" },
  { value: "-1", label: "Grand at start" }, { value: "-2", label: "Grand + sub at start" },
];
const REL_TO_OPTIONS = [
  { value: "0", label: "% of column total" }, { value: "1", label: "% of row total" }, { value: "2", label: "% of grand total" },
  { value: "3", label: "% of parent column" }, { value: "4", label: "% of parent row" },
];
const TYPE_GLYPH: Record<string, string> = { number: "#", string: "T", date: "D", logical: "B" };

type Zone = "rows" | "cols" | "vals";
interface Cfg {
  rows: string[]; cols: string[]; vals: string[];
  funcs: Record<string, AggOp>;
  rowTotalDepth: number; colTotalDepth: number; rowSort: number; colSort: number; relativeTo: number;
  exclude: Record<string, string[]>; // field-value filter: field → hidden value keys
}

const splitNames = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function cfgFromNode(node: PivotNode): Cfg {
  return {
    rows: splitNames(node.stringLiterals?.rowFields),
    cols: splitNames(node.stringLiterals?.colFields),
    vals: splitNames(node.stringLiterals?.values),
    funcs: { ...node.funcs },
    rowTotalDepth: node.rowTotalDepth, colTotalDepth: node.colTotalDepth,
    rowSort: node.rowSort, colSort: node.colSort, relativeTo: node.relativeTo,
    exclude: Object.fromEntries(Object.entries(node.filterExclude ?? {}).map(([k, v]) => [k, [...v]])),
  };
}
function writeToNode(node: PivotNode, c: Cfg) {
  node.stringLiterals.rowFields = c.rows.join(", ");
  node.stringLiterals.colFields = c.cols.join(", ");
  node.stringLiterals.values = c.vals.join(", ");
  node.funcs = c.funcs;
  node.rowTotalDepth = c.rowTotalDepth; node.colTotalDepth = c.colTotalDepth;
  node.rowSort = c.rowSort; node.colSort = c.colSort; node.relativeTo = c.relativeTo;
  node.filterExclude = c.exclude;
}

/** Signed sort options: no-sort, then ↑/↓ per field, then per value. Index is a
 *  1-based offset into [fields…, values…]; negative ⇒ descending (Excel order). */
function sortOptions(fields: string[], values: string[]): { value: string; label: string }[] {
  const cand = [...fields, ...values.map((v) => `${v} (value)`)];
  const out = [{ value: "0", label: "No sort" }];
  cand.forEach((label, i) => {
    out.push({ value: String(i + 1), label: `${label} ↑` });
    out.push({ value: String(-(i + 1)), label: `${label} ↓` });
  });
  return out;
}

export function PivotEditorPopup() {
  const state = useSyncExternalStore(pivotEditor.subscribe, pivotEditor.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [cfg, setCfg] = useState<Cfg>({ rows: [], cols: [], vals: [], funcs: {}, rowTotalDepth: 0, colTotalDepth: 0, rowSort: 0, colSort: 0, relativeTo: 0, exclude: {} });
  const initedFor = useRef<typeof state>(null);
  const drag = useRef<{ from: Zone | "fields"; field: string } | null>(null);
  const [dropZone, setDropZone] = useState<Zone | "filters" | null>(null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  // (Re)seed local state when a different popup opens.
  useEffect(() => {
    if (!state) { initedFor.current = null; return; }
    if (initedFor.current === state) return;
    initedFor.current = state;
    setCfg(cfgFromNode(state.node));
  }, [state]);

  useEscapeToClose(() => pivotEditor.close(), !!state, { capture: true });

  if (!state) return null;
  const node = state.node;
  const fields = node.sourceColumns ?? [];
  const typeOf = (name: string) => fields.find((f) => f.name === name)?.type ?? "number";

  // Commit a new config to the node and recompute.
  function commit(next: Cfg) {
    writeToNode(node, next);
    void processGraph(node.id);
    setCfg(next);
  }
  const zoneArr = (c: Cfg, z: Zone) => (z === "rows" ? c.rows : z === "cols" ? c.cols : c.vals);

  function addField(z: Zone, field: string) {
    if (!field) return;
    const next: Cfg = { ...cfg, rows: [...cfg.rows], cols: [...cfg.cols], vals: [...cfg.vals], funcs: { ...cfg.funcs } };
    const arr = zoneArr(next, z);
    if (!arr.includes(field)) arr.push(field);
    if (z === "vals" && !(field in next.funcs)) next.funcs[field] = node.op || "sum";
    commit(next);
  }
  function removeField(z: Zone, field: string) {
    const next: Cfg = { ...cfg, rows: [...cfg.rows], cols: [...cfg.cols], vals: [...cfg.vals], funcs: { ...cfg.funcs } };
    const arr = zoneArr(next, z);
    const i = arr.indexOf(field);
    if (i >= 0) arr.splice(i, 1);
    if (z === "vals") delete next.funcs[field];
    commit(next);
  }
  function setFunc(field: string, op: AggOp) {
    commit({ ...cfg, funcs: { ...cfg.funcs, [field]: op } });
  }
  // ── Field-value filter ──
  function addFilter(field: string) {
    if (!field || field in cfg.exclude) return;
    commit({ ...cfg, exclude: { ...cfg.exclude, [field]: [] } });
    setOpenFilter(field);
  }
  function removeFilter(field: string) {
    const ex = { ...cfg.exclude };
    delete ex[field];
    if (openFilter === field) setOpenFilter(null);
    commit({ ...cfg, exclude: ex });
  }
  // Toggle one value key's visibility (in the exclude set = hidden).
  function toggleValue(field: string, key: string) {
    const cur = new Set(cfg.exclude[field] ?? []);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    commit({ ...cfg, exclude: { ...cfg.exclude, [field]: [...cur] } });
  }
  function setAllValues(field: string, hide: boolean) {
    const keys = fields.find((f) => f.name === field)?.distinct ?? [];
    commit({ ...cfg, exclude: { ...cfg.exclude, [field]: hide ? [...keys] : [] } });
  }
  // A value key's display label — formats dates, names blanks.
  function valueLabel(field: string, key: string): string {
    if (key === "") return "(blank)";
    if (typeOf(field) === "date") { const n = Number(key); return Number.isFinite(n) ? formatDateSerial(n, DEFAULT_DATE_FORMAT) : key; }
    return key;
  }
  // Move a dragged field into `toZone` at `insertIdx` (append when undefined).
  function applyDrop(toZone: Zone, insertIdx?: number) {
    const payload = drag.current;
    drag.current = null;
    setDropZone(null);
    if (!payload) return;
    const { from, field } = payload;
    const next: Cfg = { ...cfg, rows: [...cfg.rows], cols: [...cfg.cols], vals: [...cfg.vals], funcs: { ...cfg.funcs } };
    if (from !== "fields") {
      const src = zoneArr(next, from);
      const i = src.indexOf(field);
      if (i >= 0) src.splice(i, 1);
      if (from === "vals" && toZone !== "vals") delete next.funcs[field];
    }
    const dst = zoneArr(next, toZone);
    const without = dst.filter((f) => f !== field);
    const at = insertIdx == null ? without.length : Math.min(insertIdx, without.length);
    without.splice(at, 0, field);
    if (toZone === "rows") next.rows = without; else if (toZone === "cols") next.cols = without; else next.vals = without;
    if (toZone === "vals" && !(next.funcs[field])) next.funcs[field] = node.op || "sum";
    commit(next);
  }

  const usedSet = new Set([...cfg.rows, ...cfg.cols, ...cfg.vals]);
  const anyPercent = cfg.vals.some((v) => (cfg.funcs[v] ?? node.op) === "percentof");

  // Render helpers (plain functions returning JSX, NOT inline components — an inline
  // component type is re-created every render and remounts its subtree, which would
  // drop the native <select> dropdowns mid-pick. See CLAUDE.md "Native form popups").
  const fieldChip = (field: string, zone: Zone) => (
    <span
      key={field}
      className={`pivot-chip pivot-chip--${typeOf(field)}`}
      draggable
      onDragStart={() => { drag.current = { from: zone, field }; }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop(zone, zoneArr(cfg, zone).indexOf(field)); }}
      title={`${field} · ${typeOf(field)}`}
    >
      <span className="pivot-chip__glyph">{TYPE_GLYPH[typeOf(field)] ?? "?"}</span>
      <span className="pivot-chip__name">{field}</span>
      <button className="pivot-chip__x" onClick={() => removeField(zone, field)} aria-label="Remove" title="Remove">×</button>
    </span>
  );

  const addPicker = (z: Zone) => {
    const avail = fields.filter((f) => !zoneArr(cfg, z).includes(f.name));
    return (
      <select
        className="pivot-zone__add"
        value=""
        disabled={avail.length === 0}
        onChange={(e) => { addField(z, e.target.value); e.currentTarget.value = ""; }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <option value="">{avail.length ? "+ add field" : "all added"}</option>
        {avail.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
    );
  };

  const valueChip = (field: string) => (
    <span key={field} className={`pivot-chip pivot-chip--${typeOf(field)} pivot-chip--value`} draggable
      onDragStart={() => { drag.current = { from: "vals", field }; }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop("vals", cfg.vals.indexOf(field)); }}
      title={`${field} · ${typeOf(field)}`}>
      <span className="pivot-chip__name">{field}</span>
      <select className="pivot-chip__func" value={cfg.funcs[field] ?? node.op} onChange={(e) => setFunc(field, e.target.value as AggOp)} onPointerDown={(e) => e.stopPropagation()}>
        {FUNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="pivot-chip__x" onClick={() => removeField("vals", field)} aria-label="Remove" title="Remove">×</button>
    </span>
  );

  const renderZone = (z: Zone, title: string) => (
    <div
      className={`pivot-zone${dropZone === z ? " pivot-zone--over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (dropZone !== z) setDropZone(z); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone((p) => (p === z ? null : p)); }}
      onDrop={(e) => { e.preventDefault(); applyDrop(z); }}
    >
      <div className="pivot-zone__head"><span className="pivot-zone__title">{title}</span>{addPicker(z)}</div>
      <div className="pivot-zone__chips">
        {z === "vals" ? cfg.vals.map(valueChip) : zoneArr(cfg, z).map((field) => fieldChip(field, z))}
      </div>
    </div>
  );

  const numSelect = (value: number, options: { value: string; label: string }[], onChange: (n: number) => void) => (
    <select className="pivot-ctl" value={String(value)} onChange={(e) => onChange(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  // The Filters quadrant: drop a field (or + add) to filter by its values; click the
  // chip to reveal a value checklist (unchecked = hidden). Compiles to the engine mask.
  const filterFields = Object.keys(cfg.exclude);
  const filterAvail = fields.filter((f) => !(f.name in cfg.exclude));
  const renderFilters = () => (
    <div
      className={`pivot-zone pivot-zone--filters${dropZone === "filters" ? " pivot-zone--over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (dropZone !== "filters") setDropZone("filters"); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone((p) => (p === "filters" ? null : p)); }}
      onDrop={(e) => { e.preventDefault(); const d = drag.current; drag.current = null; setDropZone(null); if (d) addFilter(d.field); }}
    >
      <div className="pivot-zone__head">
        <span className="pivot-zone__title">Filters</span>
        <select className="pivot-zone__add" value="" disabled={filterAvail.length === 0}
          onChange={(e) => { addFilter(e.target.value); e.currentTarget.value = ""; }} onPointerDown={(e) => e.stopPropagation()}>
          <option value="">{filterAvail.length ? "+ add field" : "all added"}</option>
          {filterAvail.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
      </div>
      <div className="pivot-zone__chips">
        {filterFields.map((field) => {
          const hidden = cfg.exclude[field]?.length ?? 0;
          const open = openFilter === field;
          const distinct = fields.find((f) => f.name === field)?.distinct ?? [];
          return (
            <div key={field} className="pivot-filter">
              <span className="pivot-chip pivot-filter__chip" draggable onDragStart={() => { drag.current = { from: "fields", field }; }}>
                <span className="pivot-chip__glyph">{TYPE_GLYPH[typeOf(field)] ?? "?"}</span>
                <button className="pivot-filter__name" onClick={() => setOpenFilter(open ? null : field)} title="Choose which values to keep">
                  {field}{hidden ? ` · ${hidden} hidden` : ""} <span className="pivot-filter__caret">{open ? "▾" : "▸"}</span>
                </button>
                <button className="pivot-chip__x" onClick={() => removeFilter(field)} aria-label="Remove" title="Remove">×</button>
              </span>
              {open && (
                <div className="pivot-filter__list" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="pivot-filter__actions">
                    <button onClick={() => setAllValues(field, false)}>All</button>
                    <button onClick={() => setAllValues(field, true)}>None</button>
                  </div>
                  {distinct.map((key) => (
                    <label key={key} className="pivot-filter__opt">
                      <input type="checkbox" checked={!(cfg.exclude[field] ?? []).includes(key)} onChange={() => toggleValue(field, key)} />
                      <span>{valueLabel(field, key)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="sol-popup-overlay" onPointerDown={() => pivotEditor.close()}>
      <div className="sol-popup pivot-editor" style={state.accent ? ({ ["--node-accent"]: state.accent } as Record<string, string>) : undefined} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header">
          <div className="sol-popup__title">{state.title}</div>
          <button className="sol-popup__close" onClick={() => pivotEditor.close()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <div className="pivot-editor__body">
          {/* Field list — the upstream columns, drag into a zone (or use a zone's + add). */}
          <div className="pivot-fields">
            <div className="pivot-fields__head">Fields {fields.length === 0 && <span className="pivot-fields__hint">· connect a frame</span>}</div>
            <div className="pivot-fields__list">
              {fields.map((f) => (
                <span key={f.name} className={`pivot-chip pivot-chip--${f.type}${usedSet.has(f.name) ? " pivot-chip--used" : ""}`} draggable
                  onDragStart={() => { drag.current = { from: "fields", field: f.name }; }} title={`${f.name} · ${f.type}`}>
                  <span className="pivot-chip__glyph">{TYPE_GLYPH[f.type] ?? "?"}</span>
                  <span className="pivot-chip__name">{f.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* The Excel 2×2: Filters · Columns / Rows · Values. */}
          <div className="pivot-grid">
            {renderFilters()}

            <div className="pivot-zone-wrap">
              {renderZone("cols", "Columns")}
              <div className="pivot-zone__controls">
                <label>Totals {numSelect(cfg.colTotalDepth, TOTAL_DEPTH_OPTIONS, (n) => commit({ ...cfg, colTotalDepth: n }))}</label>
                <label>Sort {numSelect(cfg.colSort, sortOptions(cfg.cols, cfg.vals), (n) => commit({ ...cfg, colSort: n }))}</label>
              </div>
            </div>

            <div className="pivot-zone-wrap">
              {renderZone("rows", "Rows")}
              <div className="pivot-zone__controls">
                <label>Totals {numSelect(cfg.rowTotalDepth, TOTAL_DEPTH_OPTIONS, (n) => commit({ ...cfg, rowTotalDepth: n }))}</label>
                <label>Sort {numSelect(cfg.rowSort, sortOptions(cfg.rows, cfg.vals), (n) => commit({ ...cfg, rowSort: n }))}</label>
              </div>
            </div>

            <div className="pivot-zone-wrap">
              {renderZone("vals", "Values")}
              {anyPercent && (
                <div className="pivot-zone__controls">
                  <label>% relative to {numSelect(cfg.relativeTo, REL_TO_OPTIONS, (n) => commit({ ...cfg, relativeTo: n }))}</label>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pivot-editor__footer">
          <button className="pivot-editor__done" onClick={() => pivotEditor.close()}>Done</button>
        </div>
      </div>
    </div>
  );
}
