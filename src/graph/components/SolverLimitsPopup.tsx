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
import { useFeedShape } from "./ColumnPickerField";
import { RulesPopup, RulesSection, RulesItem, RulesLine, RulesWord, RulesBreak, RulesColumn, RulesChoice, RulesNumber, RulesText } from "./RulesPopup";

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
    <RulesPopup title={state.title} accent={state.accent} onClose={close}>
      <RulesSection title="The plan must keep" action={{ label: "+ Add limit", onClick: add }}>
        {list.length === 0 && <div className="sol-rules__empty">No limits: every option may take any amount within its Min and Max.</div>}
        {list.map((l, i) => {
          const m = measureOf(l);
          const grouped = l.by !== undefined && m !== "each";
          // A group's own number can come from a column; so can each option's.
          const perGroup = grouped || m === "each";
          // The conditions not yet on this limit, each opening its line.
          const conditions = [
            ...(l.where === undefined ? [{ label: "Only where a column is a value", onPick: () => patch(i, { where: "", is: "" }) }] : []),
            ...(!grouped && m !== "each" ? [{ label: "Once for each value of a column", onPick: () => patch(i, { by: "" }) }] : []),
          ];
          return (
            <RulesItem key={i} index={i + 1} onRemove={() => remove(i)} removeLabel="Remove limit" add={{ label: "+ Add condition", options: conditions }}>
              <RulesLine>
                <RulesChoice label="Measure" value={m} options={SOLVER_MEASURE_OPTIONS} onChange={(v) => pickMeasure(i, v)} />
                {m !== "used" && (
                  <RulesColumn label="Column" value={l.of} columns={columns} blank={m === "average" ? "choose a column" : "Amount"} onChange={(v) => patch(i, { of: v })} />
                )}
                <RulesBreak />
                <RulesWord>must be</RulesWord>
                <RulesChoice label="Rule" value={l.sign} options={SOLVER_SIGN_OPTIONS} onChange={(v: SolverSign) => patch(i, { sign: v })} />
                {!l.limitColumn && <RulesNumber label="Limit" value={l.limit} percent={m === "share"} onChange={(n) => patch(i, { limit: n })} />}
                {perGroup && (
                  <RulesColumn label="Limit from a column" value={l.limitColumn ?? ""} columns={columns} blank={l.limitColumn ? "a number" : "or its…"} prefix="its " onChange={(v) => patch(i, { limitColumn: v || undefined })} />
                )}
              </RulesLine>
              {grouped && (
                <RulesLine onRemove={() => patch(i, { by: undefined, limitColumn: undefined })} removeLabel="Remove condition: once for all options">
                  <RulesWord>for each</RulesWord>
                  <RulesColumn label="For each" value={l.by ?? ""} columns={columns} blank="choose a column" onChange={(v) => patch(i, { by: v })} />
                </RulesLine>
              )}
              {l.where !== undefined && (
                <RulesLine onRemove={() => patch(i, { where: undefined, is: undefined })} removeLabel="Remove condition: count every option">
                  <RulesWord>only where</RulesWord>
                  <RulesColumn label="Where" value={l.where ?? ""} columns={columns} blank="choose a column" onChange={(v) => patch(i, { where: v })} />
                  <RulesWord>is</RulesWord>
                  <RulesText label="Is" value={l.is ?? ""} placeholder="value" onChange={(v) => patch(i, { is: v })} />
                </RulesLine>
              )}
            </RulesItem>
          );
        })}
      </RulesSection>
    </RulesPopup>
  );
}
