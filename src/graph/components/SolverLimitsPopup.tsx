// [[B19]] spreadsheetHabits: the Solver's Limits popup (tree/specs/computation/frame-verbs.md § Solver).
// Each limit reads as a sentence: a measure of a column (its total, average, share, how many options are used, or each
// option's) must be at most, at least or exactly a number or a column's value, optionally for each group of a column
// and counting only the options where a column is a value.
import { useSyncExternalStore } from "react";
import { solverLimits } from "../solverLimitsStore";
import { notifyGraphChanged, processGraph } from "../process";
import { appThemeStore } from "../appTheme";
import { SOLVER_MEASURE_OPTIONS, SOLVER_SIGN_OPTIONS, type SolverLimit, type SolverMeasure, type SolverNode, type SolverSign } from "../nodes/optimize";
import { isFrameValue } from "../frame";
import { PopupShell, popupCardVars } from "./PopupShell";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { useFeedShape } from "./ColumnPickerField";
import { CloseIcon } from "./CloseIcon";
import "./PivotEditorPopup.css";
import "./SolverLimitsPopup.css";

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

const measureOf = (l: SolverLimit): SolverMeasure => l.measure ?? "total";
/** A share is a fraction, shown and typed as a percent. */
const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/** What a limit measures, for the card's step: "Total Wood", "Share of Amount · Blend is Espresso", "Number used". */
export function limitSubject(l: SolverLimit): string {
  const m = measureOf(l);
  const head = m === "used" ? "Number used" : `${SOLVER_MEASURE_OPTIONS.find((o) => o.value === m)!.label} ${l.of.trim() || "Amount"}`;
  const by = l.by?.trim() && m !== "each" ? ` for each ${l.by.trim()}` : "";
  const where = l.where?.trim() ? ` · ${l.where.trim()} is ${l.is?.trim() || "blank"}` : "";
  return `${head}${by}${where}`;
}

/** Its rule: "at most 300", "at least 30%", "at most its Supply". */
export function limitRule(l: SolverLimit): string {
  const sign = SOLVER_SIGN_OPTIONS.find((o) => o.value === l.sign)?.label ?? "at most";
  if (l.limitColumn?.trim()) return `${sign} its ${l.limitColumn.trim()}`;
  if (l.limit == null) return `${sign} ?`;
  return `${sign} ${measureOf(l) === "share" ? pct(l.limit) : l.limit}`;
}

/** The whole limit as a sentence: "Total Wood at most 300", "Share of Amount at least 30% where Blend is Espresso". */
export function limitSummary(l: SolverLimit): string {
  const m = measureOf(l);
  const head = m === "used" ? "Number used" : `${SOLVER_MEASURE_OPTIONS.find((o) => o.value === m)!.label} ${l.of.trim() || "Amount"}`;
  const by = l.by?.trim() && m !== "each" ? ` for each ${l.by.trim()}` : "";
  const where = l.where?.trim() ? ` where ${l.where.trim()} is ${l.is?.trim() || "blank"}` : "";
  return `${head}${by} ${limitRule(l)}${where}`;
}

/** The number field: commits on Enter or blur; a blank commits no number, anything else that isn't one is refused. */
function LimitNumber({ value, percent, onChange }: { value: number | null; percent: boolean; onChange: (n: number | null) => void }) {
  const field = useDraftCommit<number | null>(
    value,
    (v) => (v == null ? "" : percent ? pct(v) : String(v)),
    (t) => {
      const s = t.replace(/,/g, "").trim();
      if (s === "") return null;
      const n = Number(s.replace(/%$/, ""));
      if (!Number.isFinite(n)) return INVALID_DRAFT;
      return percent ? n / 100 : n;
    },
    onChange,
  );
  return (
    <input className="solver-limits__num" value={field.draft} inputMode="decimal" placeholder={percent ? "percent" : "number"}
      onChange={(e) => field.setDraft(e.target.value)} onBlur={field.onBlur} onKeyDown={field.onKeyDown} onPointerDown={stop} />
  );
}

function LimitText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const field = useDraftCommit(value, (t) => t, (t) => t, onChange);
  return (
    <input className="solver-limits__text" value={field.draft} placeholder={placeholder}
      onChange={(e) => field.setDraft(e.target.value)} onBlur={field.onBlur} onKeyDown={field.onKeyDown} onPointerDown={stop} />
  );
}

function ColumnSelect({ value, columns, blank, prefix = "", onChange }: { value: string; columns: string[]; blank: string; prefix?: string; onChange: (v: string) => void }) {
  // A saved name the input lacks right now stays listed, so the select never shows another in its place.
  const names = value && !columns.includes(value) ? [...columns, value] : columns;
  return (
    <select className="pivot-ctl" value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop}>
      <option value="">{blank}</option>
      {names.map((c) => <option key={c} value={c}>{prefix}{c}</option>)}
    </select>
  );
}

/** The Options columns, name and type: the wired feed's, else the last plan's without its Amount. */
function useOptionColumns(node: SolverNode): { name: string; type: string }[] {
  const fed = useFeedShape(node.id, "options");
  if (fed.length) return fed;
  const plan = node.cachedResult;
  return plan && isFrameValue(plan) ? plan.columns.filter((c) => c.name !== "Amount").map((c) => ({ name: c.name, type: c.type })) : [];
}

export function SolverLimitsPopup() {
  const state = useSyncExternalStore(solverLimits.subscribe, solverLimits.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const shape = useOptionColumns(state?.node ?? ({ id: "", cachedResult: null } as unknown as SolverNode));
  const columns = shape.map((c) => c.name);
  const numeric = shape.filter((c) => c.type === "number").map((c) => c.name);
  if (!state) return null;
  const node = state.node;
  const list = node.limitList;

  function commit(next: SolverLimit[]) {
    node.limitList = next;
    notifyGraphChanged();
    void processGraph(node.id);
    // Draw again: the store's version is what this popup listens to.
    solverLimits.open({ ...state! });
  }
  const patch = (i: number, p: Partial<SolverLimit>) => commit(list.map((l, j) => (j === i ? { ...l, ...p } : l)));
  // A measure that can't stand as it is opens what it needs: an average a column to average, a share the line that
  // says which options it counts.
  const pickMeasure = (i: number, m: SolverMeasure) => {
    const l = list[i];
    const p: Partial<SolverLimit> = { measure: m };
    if (m === "average" && !l.of) p.of = numeric[0] ?? "";
    if (m === "share" && l.where === undefined && !l.by) { p.where = ""; p.is = ""; }
    // Only Each and For each read a limit's number from a column; leaving Each for a measure without For each drops it,
    // or the column would hold the limit with neither field showing it.
    if (m !== "each" && !l.by && l.limitColumn) p.limitColumn = undefined;
    patch(i, p);
  };
  const remove = (i: number) => commit(list.filter((_, j) => j !== i));
  const add = () => commit([...list, { of: columns.find((c) => !list.some((l) => l.of === c)) ?? "", sign: "le", limit: null }]);
  const close = () => solverLimits.close();

  return (
    <PopupShell title={state.title} onClose={close} cardClassName="solver-limits" resizable={{ min: { w: 380, h: 220 } }} cardStyle={popupCardVars(state)}>
      <div className="solver-limits__body">
        {list.length === 0 && <div className="solver-limits__empty">No limits yet</div>}
        {list.map((l, i) => {
          const m = measureOf(l);
          const grouped = l.by !== undefined && m !== "each";
          // A group's own number can come from a column; so can each option's.
          const perGroup = grouped || m === "each";
          return (
            <div key={i} className="solver-limits__limit">
              <div className="solver-limits__line">
                <select className="pivot-ctl" value={m} onChange={(e) => pickMeasure(i, e.target.value as SolverMeasure)} onPointerDown={stop}>
                  {SOLVER_MEASURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {m !== "used" && (
                  <ColumnSelect value={l.of} columns={columns} blank={m === "average" ? "choose a column" : "Amount"} onChange={(v) => patch(i, { of: v })} />
                )}
                <span className="solver-limits__word">must be</span>
                <select className="pivot-ctl" value={l.sign} onChange={(e) => patch(i, { sign: e.target.value as SolverSign })} onPointerDown={stop}>
                  {SOLVER_SIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {!l.limitColumn && <LimitNumber value={l.limit} percent={m === "share"} onChange={(n) => patch(i, { limit: n })} />}
                {perGroup && (
                  <ColumnSelect value={l.limitColumn ?? ""} columns={columns} blank={l.limitColumn ? "a number" : "or its…"} prefix="its " onChange={(v) => patch(i, { limitColumn: v || undefined })} />
                )}
                <button className="pivot-chip__x solver-limits__x" onClick={() => remove(i)} aria-label="Remove limit" title="Remove limit"><CloseIcon size={10} /></button>
              </div>
              {grouped && (
                <div className="solver-limits__line solver-limits__line--where">
                  <span className="solver-limits__word">for each</span>
                  <ColumnSelect value={l.by ?? ""} columns={columns} blank="choose a column" onChange={(v) => patch(i, { by: v })} />
                  <button className="pivot-chip__x solver-limits__x" onClick={() => patch(i, { by: undefined, limitColumn: undefined })} aria-label="Once for all options" title="Once for all options"><CloseIcon size={10} /></button>
                </div>
              )}
              {l.where !== undefined && (
                <div className="solver-limits__line solver-limits__line--where">
                  <span className="solver-limits__word">counting only where</span>
                  <ColumnSelect value={l.where ?? ""} columns={columns} blank="choose a column" onChange={(v) => patch(i, { where: v })} />
                  <span className="solver-limits__word">is</span>
                  <LimitText value={l.is ?? ""} placeholder="value" onChange={(v) => patch(i, { is: v })} />
                  <button className="pivot-chip__x solver-limits__x" onClick={() => patch(i, { where: undefined, is: undefined })} aria-label="Count every option" title="Count every option"><CloseIcon size={10} /></button>
                </div>
              )}
              {(!grouped && m !== "each") || l.where === undefined ? (
                <div className="solver-limits__links">
                  {!grouped && m !== "each" && <button className="solver-limits__link" onClick={() => patch(i, { by: "" })}>For each…</button>}
                  {l.where === undefined && <button className="solver-limits__link" onClick={() => patch(i, { where: "", is: "" })}>Count only where…</button>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="pivot-editor__footer solver-limits__footer">
        <button className="solver-limits__add" onClick={add}>Add limit</button>
        <button className="pivot-editor__done" onClick={close}>Done</button>
      </div>
    </PopupShell>
  );
}
