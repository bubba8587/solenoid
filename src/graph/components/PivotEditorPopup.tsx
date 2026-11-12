// [[C26]] opArgDistinct, [[C44]] dateSerials
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { pivotEditor } from "../pivotEditorStore";
import { notifyGraphChanged, processGraph } from "../process";
import { DATE_GROUPS, calcFieldName, calcIdOf, calcIsOff, calcToken, calcsOnPivot, dateGroupOf, pivotConfigOf, placesFrom, regroupField, valuesWithCalcs, writePivotConfig, type PivotSort, type DateGroup, type PivotConfig } from "../pivotConfig";
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
import { dropOutputCables } from "./cablePrune";
import { getOwningView } from "../activeGraph";
import { useConnectedInputs } from "./inlineInput";
import { FieldChip, FieldsPanel, startChipDrag as startDrag } from "./FieldChips";
import { CloseIcon } from "./CloseIcon";

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

const sortValue = (s: PivotSort | null): string => (s ? JSON.stringify([s.by, s.name, !!s.desc]) : "");

/** An axis's sorts: by one of its fields, by a value, or by a calculated field on the pivot, each way. A saved sort
 *  whose field is away is listed as it stands, so the select never shows another in its place. */
function sortOptions(fields: string[], values: string[], calcs: { id: string; name: string }[], cur: PivotSort | null): { value: string; label: string; sort: PivotSort | null }[] {
  const cand: { sort: PivotSort; label: string }[] = [
    ...fields.map((name) => ({ sort: { by: "field" as const, name }, label: name })),
    ...values.map((name) => ({ sort: { by: "value" as const, name }, label: `${name} (value)` })),
    ...calcs.map((c) => ({ sort: { by: "calc" as const, name: c.id }, label: `${c.name} (value)` })),
  ];
  const out: { value: string; label: string; sort: PivotSort | null }[] = [{ value: "", label: "Default order", sort: null }];
  for (const { sort, label } of cand) {
    out.push({ value: sortValue(sort), label: `${label} ↑`, sort });
    const desc: PivotSort = { ...sort, desc: true };
    out.push({ value: sortValue(desc), label: `${label} ↓`, sort: desc });
  }
  if (cur && !out.some((o) => o.value === sortValue(cur))) {
    out.push({ value: sortValue(cur), label: `${cur.by === "calc" ? "A calculated field" : cur.name} ${cur.desc ? "↓" : "↑"} (not on the pivot)`, sort: cur });
  }
  return out;
}

export function PivotEditorPopup() {
  const state = useSyncExternalStore(pivotEditor.subscribe, pivotEditor.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [cfg, setCfg] = useState<Cfg>({ rows: [], cols: [], vals: [], details: [], funcs: {}, rowTotalDepth: 0, colTotalDepth: 0, rowSort: null, colSort: null, relativeTo: 0, exclude: {} });
  const initedFor = useRef<typeof state>(null);
  const drag = useRef<{ from: Zone | "fields"; field: string } | null>(null);
  const [dropZone, setDropZone] = useState<Zone | "filters" | null>(null);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [, setLanded] = useState(0);
  const connected = useConnectedInputs(state?.node.id ?? "");

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
  // Calculated fields come from the card's wired λ rows: each sits in Values, dragged like a value, until it's dragged
  // out to the Fields list, which takes it off the pivot and leaves its cable be.
  const calcs = node.valuePairKeys().map(([nameKey, fnKey], n) => ({
    id: nameKey.slice(8), wired: connected.has(fnKey), name: calcFieldName(node, nameKey.slice(8), n),
  })).filter((c) => c.wired);
  const calcIds = calcs.map((c) => c.id);
  // The calculated fields a sort can name: the ones on the pivot.
  const sortCalcs = calcsOnPivot(node.calcPlace, calcIds).map((id) => calcs.find((c) => c.id === id)!);
  const calcName = (token: string) => calcs.find((c) => c.id === calcIdOf(token))?.name ?? "";
  const valueTokens = valuesWithCalcs(cfg.vals, node.calcPlace, calcIds);
  const removedCalcs = calcs.filter((c) => !valueTokens.includes(calcToken(c.id)));
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
    // The write ends a sort whose field it took off the pivot.
    setCfg({ ...next, rowSort: node.rowSort, colSort: node.colSort });
  }
  /** Values in the zone's order, calculated fields among them: the plain values and each field's place. */
  function commitValues(tokens: string[], base: Cfg = cfg) {
    const { vals, place } = placesFrom(tokens, calcIds, node.calcPlace);
    const funcs = { ...base.funcs };
    for (const k of Object.keys(funcs)) if (!vals.includes(k)) delete funcs[k];
    for (const v of vals) if (!(v in funcs) && !base.vals.includes(v)) funcs[v] = node.agg || "sum";
    node.calcPlace = place;
    // A sort by a calculated field dragged out of the pivot goes with it.
    const kept = (sort: PivotSort | null) => (sort?.by === "calc" && calcIsOff(place, sort.name) ? null : sort);
    commit({ ...base, vals, funcs, rowSort: kept(base.rowSort), colSort: kept(base.colSort) });
  }
  const insertAt = (list: string[], item: string, at?: number) => {
    const without = list.filter((t) => t !== item);
    without.splice(at == null ? without.length : Math.min(at, without.length), 0, item);
    return without;
  };
  /** The totals are the Pivot view's; Export totals hands them on as Row Totals and Column Totals outputs. */
  async function setExportTotals(on: boolean) {
    if (!on) await dropOutputCables(node.id, ["rowTotals", "colTotals"]);
    node.setExportTotals(on);
    await getOwningView(node.id)?.rerenderNode(node.id);
    notifyGraphChanged();
    void processGraph(node.id).then(() => setLanded((n) => n + 1));
  }
  const zoneArr = (c: Cfg, z: Zone) => (z === "rows" ? c.rows : z === "cols" ? c.cols : z === "details" ? c.details : c.vals);
  const copyZones = (c: Cfg): Cfg => ({ ...c, rows: [...c.rows], cols: [...c.cols], vals: [...c.vals], details: [...c.details], funcs: { ...c.funcs } });

  function addField(z: Zone, field: string) {
    if (!field) return;
    if (z === "vals") { if (!cfg.vals.includes(field)) commitValues([...valueTokens, field]); return; }
    const next = copyZones(cfg);
    const arr = zoneArr(next, z);
    if (!arr.includes(field)) arr.push(field);
    commit(next);
  }
  function removeField(z: Zone, field: string) {
    if (z === "vals") { commitValues(valueTokens.filter((t) => t !== field)); return; }
    const next = copyZones(cfg);
    const arr = zoneArr(next, z);
    const i = arr.indexOf(field);
    if (i >= 0) arr.splice(i, 1);
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
  /** The drop reads `drag`. */
  function startChipDrag(e: React.DragEvent, payload: { from: Zone | "fields"; field: string }) {
    drag.current = payload;
    startDrag(e, payload.field);
  }

  function applyDrop(toZone: Zone, insertIdx?: number) {
    const payload = drag.current;
    drag.current = null;
    setDropZone(null);
    if (!payload) return;
    const { from, field } = payload;
    // A calculated field lives only among the values.
    if (calcIdOf(field) !== null) { if (toZone === "vals") commitValues(insertAt(valueTokens, field, insertIdx)); return; }
    const next = copyZones(cfg);
    let tokens = valueTokens;
    if (from === "vals") tokens = tokens.filter((t) => t !== field);
    else if (from !== "fields") {
      const src = zoneArr(next, from);
      const i = src.indexOf(field);
      if (i >= 0) src.splice(i, 1);
    }
    if (toZone === "vals") tokens = insertAt(tokens, field, insertIdx);
    else {
      const placed = insertAt(zoneArr(next, toZone), field, insertIdx);
      if (toZone === "rows") next.rows = placed; else if (toZone === "cols") next.cols = placed; else next.details = placed;
    }
    commitValues(tokens, next);
  }
  /** A chip dropped on the Fields list leaves its zone; a calculated field leaves the pivot, its cable kept. */
  function dropOnFields() {
    const payload = drag.current;
    drag.current = null;
    setDropZone(null);
    if (payload && payload.from !== "fields") removeField(payload.from, payload.field);
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
      <button className="pivot-chip__x" onClick={() => removeField(zone, field)} aria-label="Remove" title="Remove"><CloseIcon size={10} /></button>
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

  const valueChip = (field: string) => calcIdOf(field) !== null ? calcChip(field) : (
    <span key={field} className={`pivot-chip pivot-chip--${typeOf(field)} pivot-chip--value${isMissing(field) ? " pivot-chip--missing" : ""}`} draggable
      onDragStart={(e) => { startChipDrag(e, { from: "vals", field }); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop("vals", valueTokens.indexOf(field)); }}
      title={chipTitle(field)}>
      <span className="pivot-chip__name">{field}</span>
      <select className="pivot-chip__func" value={cfg.funcs[field] ?? node.agg} onChange={(e) => setFunc(field, e.target.value as AggOp)} onPointerDown={(e) => e.stopPropagation()}>
        {FUNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="pivot-chip__x" onClick={() => removeField("vals", field)} aria-label="Remove" title="Remove"><CloseIcon size={10} /></button>
    </span>
  );

  const calcChip = (token: string, inFields = false) => (
    <span key={token} className="pivot-chip pivot-chip--calc pivot-chip--value" draggable
      onDragStart={(e) => { startChipDrag(e, { from: inFields ? "fields" : "vals", field: token }); }}
      onDragOver={inFields ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={inFields ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); applyDrop("vals", valueTokens.indexOf(token)); }}
      title={inFields ? `${calcName(token)} · calculated field, off the pivot` : `${calcName(token)} · calculated field, from a λ on the card`}>
      <span className="pivot-chip__glyph">λ</span>
      <span className="pivot-chip__name">{calcName(token)}</span>
      {!inFields && <button className="pivot-chip__x" onClick={() => removeField("vals", token)} aria-label="Remove" title="Remove from the pivot"><CloseIcon size={10} /></button>}
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
        {z === "vals" ? valueTokens.map(valueChip) : zoneArr(cfg, z).map((field) => fieldChip(field, z))}
        {hint && zoneArr(cfg, z).length === 0 && <span className="pivot-zone__hint">{hint}</span>}
      </div>
    </div>
  );

  const numSelect = (value: number, options: { value: string; label: string }[], onChange: (n: number) => void) => (
    <select className="pivot-ctl" value={String(value)} onChange={(e) => onChange(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const sortSelect = (value: PivotSort | null, options: ReturnType<typeof sortOptions>, onChange: (sort: PivotSort | null) => void) => (
    <select className="pivot-ctl" value={sortValue(value)} onChange={(e) => onChange(options.find((o) => o.value === e.target.value)?.sort ?? null)} onPointerDown={(e) => e.stopPropagation()}>
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
      onDrop={(e) => { e.preventDefault(); const d = drag.current; drag.current = null; setDropZone(null); if (d && calcIdOf(d.field) === null) addFilter(d.field); }}
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
                <button className="pivot-chip__x" onClick={() => removeFilter(field)} aria-label="Remove" title="Remove"><CloseIcon size={10} /></button>
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
        <FieldsPanel head="Fields" hint={fields.length === 0 ? "connect a frame" : undefined} onDrop={dropOnFields}>
          {fields.map((f) => (
            <FieldChip key={f.name} name={f.name} glyph={TYPE_GLYPH(f.type)} className={`pivot-chip--${f.type}${usedSet.has(f.name) ? " pivot-chip--used" : ""}`}
              onDragStart={(e) => { startChipDrag(e, { from: "fields", field: f.name }); }} title={`${f.name} · ${f.type}`} />
          ))}
          {removedCalcs.map((c) => calcChip(calcToken(c.id), true))}
        </FieldsPanel>

        <div className="pivot-grid">
          {renderFilters()}

          <div className="pivot-zone-wrap">
            {renderZone("cols", "Columns")}
            <div className="pivot-zone__controls">
              <label>Totals {numSelect(cfg.colTotalDepth, TOTAL_DEPTH_OPTIONS, (n) => commit({ ...cfg, colTotalDepth: n }))}</label>
              <label>Sort {sortSelect(cfg.colSort, sortOptions(cfg.cols, cfg.vals, sortCalcs, cfg.colSort), (sort) => commit({ ...cfg, colSort: sort }))}</label>
            </div>
          </div>

          <div className="pivot-zone-wrap">
            {renderZone("rows", "Rows")}
            <div className="pivot-zone__controls">
              <label>Totals {numSelect(cfg.rowTotalDepth, TOTAL_DEPTH_OPTIONS, (n) => commit({ ...cfg, rowTotalDepth: n }))}</label>
              <label>Sort {sortSelect(cfg.rowSort, sortOptions(cfg.rows, cfg.vals, sortCalcs, cfg.rowSort), (sort) => commit({ ...cfg, rowSort: sort }))}</label>
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
        <label className="pivot-editor__export" title="Totals show in the Pivot view only. On, the card also outputs them as Row Totals and Column Totals.">
          <input type="checkbox" checked={node.exportTotals} onChange={(e) => void setExportTotals(e.target.checked)} />
          Export totals
        </label>
        <button className="pivot-editor__done" onClick={close}>Done</button>
      </div>
    </PopupShell>
  );
}
