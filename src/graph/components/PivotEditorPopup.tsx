// [[C26]] opArgDistinct, [[C44]] dateSerials
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { pivotEditor } from "../pivotEditorStore";
import { notifyGraphChanged, processGraph } from "../process";
import { DATE_GROUPS, dateGroupOf, pivotConfigOf, regroupField, writePivotConfig, type DateGroup, type PivotConfig } from "../pivotConfig";
import { caseTwin } from "../frame";
import { appThemeStore } from "../appTheme";
import type { AggOp } from "../frameOps";
import { AGG_OP_META } from "../nodeClasses";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { PopupShell, popupCardVars } from "./PopupShell";
import "./PivotEditorPopup.css";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { TypeIcon } from "./TypeIcon";
import { PivotFilterList } from "./PivotFilterList";

// The per-value function list derives from AGG_OP_META; the pivot is the one surface
// that also offers the pivotOnly ops.
const FUNC_OPTIONS: { value: AggOp; label: string }[] =
  (Object.keys(AGG_OP_META) as AggOp[]).map((value) => ({ value, label: AGG_OP_META[value].label }));
const TOTAL_DEPTH_OPTIONS = [
  { value: "0", label: "No totals" }, { value: "1", label: "Grand total" }, { value: "2", label: "Grand + subtotals" },
  { value: "-1", label: "Grand at start" }, { value: "-2", label: "Grand + sub at start" },
];
const REL_TO_OPTIONS = [
  { value: "0", label: "% of column total" }, { value: "1", label: "% of row total" }, { value: "2", label: "% of grand total" },
  { value: "3", label: "% of parent column" }, { value: "4", label: "% of parent row" },
];
const TYPE_GLYPH = (t: string | undefined): ReactNode =>
  t === "number" || t === "string" || t === "date" || t === "logical" ? <TypeIcon type={t} size={10} /> : "?";

type Zone = "rows" | "cols" | "vals" | "details";
type Cfg = PivotConfig;

/** Index is a 1-based offset into [fields…, values…]; negative ⇒ descending. */
function sortOptions(fields: string[], values: string[]): { value: string; label: string }[] {
  const cand = [...fields, ...values.map((v) => `${v} (value)`)];
  const out = [{ value: "0", label: "Default order" }];
  cand.forEach((label, i) => {
    out.push({ value: String(i + 1), label: `${label} ↑` });
    out.push({ value: String(-(i + 1)), label: `${label} ↓` });
  });
  return out;
}

export function PivotEditorPopup() {
  const state = useSyncExternalStore(pivotEditor.subscribe, pivotEditor.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [cfg, setCfg] = useState<Cfg>({ rows: [], cols: [], vals: [], details: [], funcs: {}, rowTotalDepth: 0, colTotalDepth: 0, rowSort: 0, colSort: 0, relativeTo: 0, exclude: {} });
  const initedFor = useRef<typeof state>(null);
  const drag = useRef<{ from: Zone | "fields"; field: string } | null>(null);
  const [dropZone, setDropZone] = useState<Zone | "filters" | null>(null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [, setLanded] = useState(0);

  useEffect(() => {
    if (!state) { initedFor.current = null; return; }
    if (initedFor.current === state) return;
    initedFor.current = state;
    setCfg(pivotConfigOf(state.node));
  }, [state]);

  if (!state) return null;
  const node = state.node;
  const close = () => { pivotEditor.close(); state.onClosed?.(); };
  const fields = node.sourceColumns ?? [];
  const typeOf = (name: string) => fields.find((f) => f.name === name)?.type ?? "number";
  // A saved field whose column the input lacks right now stays in the layout, marked, and counts again once it's back.
  const isMissing = (name: string) => fields.length > 0 && !fields.some((f) => f.name === name);
  const missingNote = (field: string) => {
    const twin = caseTwin(field, fields.map((f) => f.name));
    return twin ? `Column names are case sensitive: the input has ${twin}` : "not in the input now";
  };
  const chipTitle = (field: string) => (isMissing(field) ? `${field} · ${missingNote(field)}` : `${field} · ${typeOf(field)}`);

  // Saved and recorded at once, not on the compute's finish, which manual calculation or an early-out pass would skip.
  function commit(next: Cfg) {
    writePivotConfig(node, next);
    notifyGraphChanged();
    // The field list (a new filter's values) comes back with the compute: draw again once it lands.
    void processGraph(node.id).then(() => setLanded((n) => n + 1));
    setCfg(next);
  }
  const zoneArr = (c: Cfg, z: Zone) => (z === "rows" ? c.rows : z === "cols" ? c.cols : z === "details" ? c.details : c.vals);
  const copyZones = (c: Cfg): Cfg => ({ ...c, rows: [...c.rows], cols: [...c.cols], vals: [...c.vals], details: [...c.details], funcs: { ...c.funcs } });

  function addField(z: Zone, field: string) {
    if (!field) return;
    const next = copyZones(cfg);
    const arr = zoneArr(next, z);
    if (!arr.includes(field)) arr.push(field);
    if (z === "vals" && !(field in next.funcs)) next.funcs[field] = node.agg || "sum";
    commit(next);
  }
  function removeField(z: Zone, field: string) {
    const next = copyZones(cfg);
    const arr = zoneArr(next, z);
    const i = arr.indexOf(field);
    if (i >= 0) arr.splice(i, 1);
    if (z === "vals") delete next.funcs[field];
    commit(next);
  }
  function setFunc(field: string, op: AggOp) {
    commit({ ...cfg, funcs: { ...cfg.funcs, [field]: op } });
  }
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
  function setHidden(field: string, hidden: string[]) {
    commit({ ...cfg, exclude: { ...cfg.exclude, [field]: hidden } });
  }
  function valueLabel(field: string, key: string): string {
    if (key === "") return "(blank)";
    // A blank key must not read as serial 0 — `Number("")` is 0 (30-Dec-1899).
    if (typeOf(field) === "date" && key.trim() !== "") {
      const n = Number(key);
      return Number.isFinite(n) ? formatDateSerial(n, dateGroupOf(field)?.unit === "Months" ? "MMM YYYY" : DEFAULT_DATE_FORMAT) : key;
    }
    return key;
  }
  /** Firefox starts no HTML5 drag without data on it, so the field's name rides along; the drop reads `drag`. */
  function startChipDrag(e: React.DragEvent, payload: { from: Zone | "fields"; field: string }) {
    drag.current = payload;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", payload.field);
  }

  function applyDrop(toZone: Zone, insertIdx?: number) {
    const payload = drag.current;
    drag.current = null;
    setDropZone(null);
    if (!payload) return;
    const { from, field } = payload;
    const next = copyZones(cfg);
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
    if (toZone === "rows") next.rows = without; else if (toZone === "cols") next.cols = without; else if (toZone === "details") next.details = without; else next.vals = without;
    if (toZone === "vals" && !(next.funcs[field])) next.funcs[field] = node.agg || "sum";
    commit(next);
  }

  const usedSet = new Set([...cfg.rows, ...cfg.cols, ...cfg.vals, ...cfg.details]);
  const anyPercent = cfg.vals.some((v) => (cfg.funcs[v] ?? node.agg) === "percentof");

  // Plain functions returning JSX, NOT inline components: an inline component type is
  // re-created every render and remounts its subtree, dropping a <select> mid-pick.
  const fieldChip = (field: string, zone: Zone) => (
    <span
      key={field}
      className={`pivot-chip pivot-chip--${typeOf(field)}${isMissing(field) ? " pivot-chip--missing" : ""}`}
      draggable
      onDragStart={(e) => { startChipDrag(e, { from: zone, field }); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop(zone, zoneArr(cfg, zone).indexOf(field)); }}
      title={chipTitle(field)}
    >
      <span className="pivot-chip__glyph">{TYPE_GLYPH(typeOf(field))}</span>
      <span className="pivot-chip__name">{field}</span>
      {(zone === "rows" || zone === "cols") && typeOf(dateGroupOf(field)?.from ?? field) === "date" && (
        <select className="pivot-chip__func" value={dateGroupOf(field)?.unit ?? ""} title="Group by" onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => commit(regroupField(cfg, zone, field, (e.target.value || null) as DateGroup | null))}>
          <option value="">Dates</option>
          {DATE_GROUPS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      )}
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
    <span key={field} className={`pivot-chip pivot-chip--${typeOf(field)} pivot-chip--value${isMissing(field) ? " pivot-chip--missing" : ""}`} draggable
      onDragStart={(e) => { startChipDrag(e, { from: "vals", field }); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop("vals", cfg.vals.indexOf(field)); }}
      title={chipTitle(field)}>
      <span className="pivot-chip__name">{field}</span>
      <select className="pivot-chip__func" value={cfg.funcs[field] ?? node.agg} onChange={(e) => setFunc(field, e.target.value as AggOp)} onPointerDown={(e) => e.stopPropagation()}>
        {FUNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="pivot-chip__x" onClick={() => removeField("vals", field)} aria-label="Remove" title="Remove">×</button>
    </span>
  );

  const renderZone = (z: Zone, title: string, hint?: string) => (
    <div
      className={`pivot-zone pivot-zone--${z}${dropZone === z ? " pivot-zone--over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (dropZone !== z) setDropZone(z); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone((p) => (p === z ? null : p)); }}
      onDrop={(e) => { e.preventDefault(); applyDrop(z); }}
    >
      <div className="pivot-zone__head"><span className="pivot-zone__title">{title}</span>{addPicker(z)}</div>
      <div className="pivot-zone__chips">
        {z === "vals" ? cfg.vals.map(valueChip) : zoneArr(cfg, z).map((field) => fieldChip(field, z))}
        {hint && zoneArr(cfg, z).length === 0 && <span className="pivot-zone__hint">{hint}</span>}
      </div>
    </div>
  );

  const numSelect = (value: number, options: { value: string; label: string }[], onChange: (n: number) => void) => (
    <select className="pivot-ctl" value={String(value)} onChange={(e) => onChange(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  // Unchecked values compile to the engine's exclude mask.
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
          const meta = fields.find((f) => f.name === field);
          const distinct = meta?.distinct ?? [];
          return (
            <div key={field} className="pivot-filter">
              <span className="pivot-chip pivot-filter__chip" draggable onDragStart={(e) => { startChipDrag(e, { from: "fields", field }); }}>
                <span className="pivot-chip__glyph">{TYPE_GLYPH(typeOf(field))}</span>
                <button className="pivot-filter__name" onClick={() => setOpenFilter(open ? null : field)} title="Choose which values to keep">
                  {field}{hidden ? ` · ${hidden} hidden` : ""} <span className="pivot-filter__caret">{open ? <ChevronDownIcon size={10} strokeWidth={2} /> : <ChevronRightIcon size={10} strokeWidth={2} />}</span>
                </button>
                <button className="pivot-chip__x" onClick={() => removeFilter(field)} aria-label="Remove" title="Remove">×</button>
              </span>
              {open && (
                <PivotFilterList type={typeOf(field)} keys={distinct} total={meta?.distinctTotal ?? distinct.length}
                  hidden={cfg.exclude[field] ?? []} label={(k) => valueLabel(field, k)} onChange={(h) => setHidden(field, h)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <PopupShell
      title={state.title}
      onClose={close}
      cardClassName="pivot-editor"
      resizable={{ min: { w: 420, h: 320 } }}
      cardStyle={popupCardVars(state)}
    >
      <div className="pivot-editor__body">
        <div className="pivot-fields">
          <div className="pivot-fields__head">Fields {fields.length === 0 && <span className="pivot-fields__hint">· connect a frame</span>}</div>
          <div className="pivot-fields__list">
            {fields.map((f) => (
              <span key={f.name} className={`pivot-chip pivot-chip--${f.type}${usedSet.has(f.name) ? " pivot-chip--used" : ""}`} draggable
                onDragStart={(e) => { startChipDrag(e, { from: "fields", field: f.name }); }} title={`${f.name} · ${f.type}`}>
                <span className="pivot-chip__glyph">{TYPE_GLYPH(f.type)}</span>
                <span className="pivot-chip__name">{f.name}</span>
              </span>
            ))}
          </div>
        </div>

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

          {renderZone("details", "Details", "Columns listed under each row group in the Pivot view. The output stays the same.")}
        </div>
      </div>

      <div className="pivot-editor__footer">
        <button className="pivot-editor__done" onClick={close}>Done</button>
      </div>
    </PopupShell>
  );
}
