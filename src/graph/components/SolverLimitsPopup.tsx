// [[B19]] spreadsheetHabits: the Solver's Limits popup (tree/specs/computation/frame-verbs.md § Solver).
// Each limit reads as a sentence: the total of a column must be at most, at least or exactly a number, optionally
// counting only the options where another column is a value.
import { useSyncExternalStore } from "react";
import { solverLimits } from "../solverLimitsStore";
import { notifyGraphChanged, processGraph } from "../process";
import { appThemeStore } from "../appTheme";
import { SOLVER_SIGN_OPTIONS, type SolverLimit, type SolverNode, type SolverSign } from "../nodes/optimize";
import { isFrameValue } from "../frame";
import { PopupShell, popupCardVars } from "./PopupShell";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { useFeedColumns } from "./ColumnPickerField";
import { CloseIcon } from "./CloseIcon";
import "./PivotEditorPopup.css";
import "./SolverLimitsPopup.css";

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** What a limit totals, for the card's step: "Wood", "Amount · Blend is Espresso". */
export function limitSubject(l: SolverLimit): string {
  const where = l.where?.trim() ? ` · ${l.where.trim()} is ${l.is?.trim() || "blank"}` : "";
  return `${l.of.trim() || "Amount"}${where}`;
}

/** Its rule: "at most 300". */
export function limitRule(l: SolverLimit): string {
  return `${SOLVER_SIGN_OPTIONS.find((o) => o.value === l.sign)?.label ?? "at most"} ${l.limit ?? "?"}`;
}

/** The whole limit as a sentence: "Total Wood at most 300", "Total Amount at least 10 where Kind is Desk". */
export function limitSummary(l: SolverLimit): string {
  const where = l.where?.trim() ? ` where ${l.where.trim()} is ${l.is?.trim() || "blank"}` : "";
  return `Total ${l.of.trim() || "Amount"} ${limitRule(l)}${where}`;
}

/** The number field: commits on Enter or blur; a blank commits no number, anything else that isn't one is refused. */
function LimitNumber({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const field = useDraftCommit<number | null>(
    value,
    (v) => (v == null ? "" : String(v)),
    (t) => { const s = t.replace(/,/g, "").trim(); return s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : INVALID_DRAFT; },
    onChange,
  );
  return (
    <input className="solver-limits__num" value={field.draft} inputMode="decimal" placeholder="number"
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

function ColumnSelect({ value, columns, blank, onChange }: { value: string; columns: string[]; blank: string; onChange: (v: string) => void }) {
  // A saved name the input lacks right now stays listed, so the select never shows another in its place.
  const names = value && !columns.includes(value) ? [...columns, value] : columns;
  return (
    <select className="pivot-ctl" value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop}>
      <option value="">{blank}</option>
      {names.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/** The Options columns: the wired feed's, else the last plan's without its Amount. */
function useOptionColumns(node: SolverNode): string[] {
  const fed = useFeedColumns(node.id, "options");
  if (fed.length) return fed;
  const plan = node.cachedResult;
  return plan && isFrameValue(plan) ? plan.columns.map((c) => c.name).filter((n) => n !== "Amount") : [];
}

export function SolverLimitsPopup() {
  const state = useSyncExternalStore(solverLimits.subscribe, solverLimits.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const columns = useOptionColumns(state?.node ?? ({ id: "", cachedResult: null } as unknown as SolverNode));
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
  const remove = (i: number) => commit(list.filter((_, j) => j !== i));
  const add = () => commit([...list, { of: columns.find((c) => !list.some((l) => l.of === c)) ?? "", sign: "le", limit: null }]);
  const close = () => solverLimits.close();

  return (
    <PopupShell title={state.title} onClose={close} cardClassName="solver-limits" resizable={{ min: { w: 380, h: 220 } }} cardStyle={popupCardVars(state)}>
      <div className="solver-limits__body">
        {list.length === 0 && <div className="solver-limits__empty">No limits yet</div>}
        {list.map((l, i) => {
          const filtering = l.where !== undefined;
          return (
            <div key={i} className="solver-limits__limit">
              <div className="solver-limits__line">
                <span className="solver-limits__word">Total</span>
                <ColumnSelect value={l.of} columns={columns} blank="Amount" onChange={(v) => patch(i, { of: v })} />
                <span className="solver-limits__word">must be</span>
                <select className="pivot-ctl" value={l.sign} onChange={(e) => patch(i, { sign: e.target.value as SolverSign })} onPointerDown={stop}>
                  {SOLVER_SIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <LimitNumber value={l.limit} onChange={(n) => patch(i, { limit: n })} />
                <button className="pivot-chip__x solver-limits__x" onClick={() => remove(i)} aria-label="Remove limit" title="Remove limit"><CloseIcon size={10} /></button>
              </div>
              {filtering ? (
                <div className="solver-limits__line solver-limits__line--where">
                  <span className="solver-limits__word">counting only where</span>
                  <ColumnSelect value={l.where ?? ""} columns={columns} blank="choose a column" onChange={(v) => patch(i, { where: v })} />
                  <span className="solver-limits__word">is</span>
                  <LimitText value={l.is ?? ""} placeholder="value" onChange={(v) => patch(i, { is: v })} />
                  <button className="pivot-chip__x solver-limits__x" onClick={() => patch(i, { where: undefined, is: undefined })} aria-label="Count every option" title="Count every option"><CloseIcon size={10} /></button>
                </div>
              ) : (
                <button className="solver-limits__link" onClick={() => patch(i, { where: "", is: "" })}>Count only where…</button>
              )}
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
