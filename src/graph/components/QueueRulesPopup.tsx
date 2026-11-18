// [[B19]] spreadsheetHabits: Greedy Queue's and Local Search's rules popup (tree/specs/computation/frame-verbs.md § The
// rules popups). The card keeps what is wired (tables, formulas, numbers) and its outputs; every setting is asked here, a
// section per question, and the card lists the answers as a numbered list of plain rules.
import { useSyncExternalStore } from "react";
import { queueRules } from "../queueRulesStore";
import { processEdited } from "../process";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { appThemeStore } from "../appTheme";
import { GreedyQueueNode, LocalSearchNode, QUEUE_ORDER_OPTIONS, QUEUE_TURNS_OPTIONS, QUEUE_STEP_START_OPTIONS, QUEUE_FIT_OPTIONS,
  SEARCH_REACH_OPTIONS, SEARCH_ENDS_OPTIONS, SEARCH_STUCK_OPTIONS, TRANSITION_DIRECTION_OPTIONS, TRANSITION_UNLISTED_OPTIONS } from "../nodes/queue";
import { useFeedShape } from "./ColumnPickerField";
import { useConnectedInputs } from "./inlineInput";
import { RulesPopup, RulesSection, RulesRow, RulesSeg, RulesColumn, RulesGroup } from "./RulesPopup";

type QueueCard = GreedyQueueNode | LocalSearchNode;

/** A column setting's text: the picked name, "wired" when a cable sets it, or empty. */
function columnOf(node: QueueCard, key: string, wired: Set<string>): string {
  if (wired.has(key)) return "wired";
  return (node.stringLiterals[key] ?? "").trim();
}

/** The card's rules as a numbered list, each a name and its answer in plain words. */
export function queueRuleSteps(node: QueueCard, wired: Set<string>): { name: string; value: string }[] {
  const cost = [columnOf(node, "costColumn", wired), wired.has("cost") ? "formula" : "", wired.has("transitions") ? "transitions" : ""].filter(Boolean);
  const group = columnOf(node, "group", wired);
  const steps: { name: string; value: string }[] = [];
  if (node instanceof GreedyQueueNode) {
    const col = columnOf(node, "orderColumn", wired);
    const order = node.orderBy === "cost"
      ? cost.length ? "cheapest first" : "as listed (no cost to compare)"
      : col ? `${node.orderDir === "desc" ? "largest" : "smallest"} ${col} first` : wired.has("order") ? "by formula" : "as listed";
    steps.push({ name: "Next", value: order });
    steps.push({ name: "Cost", value: cost.length ? cost.join(" + ") : "none" });
    steps.push({ name: "Groups", value: group ? `by ${group}, ${node.turns === "best" ? "best match" : "in turn"}` : "one" });
    const opens = columnOf(node, "step", wired);
    const fresh = node.stepStart === "start" && wired.has("start") ? ", each from its start" : "";
    steps.push({ name: "Steps", value: opens ? `by ${opens}${fresh}` : `all at once${fresh}` });
    const budget = wired.has("budget") || node.literals.budget != null;
    if (budget) steps.push({ name: "Per step", value: `within Budget, ${node.mode === "skip" ? "skip" : "stop at"} what won't fit` });
  } else {
    steps.push({ name: "Cost", value: cost.length ? cost.join(" + ") : "none" });
    steps.push({ name: "Groups", value: group ? `by ${group}, ${node.reach === "within" ? "items stay" : "items move"}` : "one" });
    // Back at its start needs a Start row to go back to; without Groups wired the walk ends at its last item.
    steps.push({ name: "Ends", value: node.ends === "return" && wired.has("start") ? "back at the start" : "at the last item" });
    steps.push({ name: "Search", value: node.stuck === "look" ? "thorough" : "quick" });
  }
  return steps;
}

export function QueueRulesPopup() {
  const state = useSyncExternalStore(queueRules.subscribe, queueRules.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const id = state?.node.id ?? "";
  const items = useFeedShape(id, "items").map((c) => c.name);
  const transitionCols = useFeedShape(id, "transitions");
  const wired = useConnectedInputs(id);
  if (!state) return null;
  const node = state.node;
  const close = () => queueRules.close();

  // A setting saves and recalculates as a card's own edit does, then the card and this popup draw again.
  function set(apply: () => void) {
    apply();
    const ed = getOwningEditor(node.id);
    const ar = getOwningView(node.id);
    void processEdited(node.id, ed && ar ? reconcileTypesAfterEdit(ed, ar) : []);
    queueRules.open({ ...state! });
  }
  const setColumn = (key: string) => (v: string) => set(() => { node.stringLiterals[key] = v; });
  // A column a cable sets reads as wired here; its row's control steps aside.
  const column = (key: string, label: string, blank: string) =>
    wired.has(key) ? <span className="sol-rules__word">wired</span>
      : <RulesColumn label={label} value={node.stringLiterals[key] ?? ""} columns={items} blank={blank} onChange={setColumn(key)} />;

  const hasTransitions = wired.has("transitions");
  const transitionNumbers = transitionCols.filter((c) => c.type === "number").map((c) => c.name);
  const needs = hasTransitions ? undefined : "Needs a Transitions table wired on the card.";
  const transitions = (
    <RulesGroup title="Transitions">
      <RulesRow label="Direction" idle={!hasTransitions} help={needs ?? "Each row either way round, or only From to To (a one-way street, a changeover)."}>
        <RulesSeg label="Direction" value={node.transitionsDirection} options={TRANSITION_DIRECTION_OPTIONS} onChange={(v) => set(() => { node.transitionsDirection = v; })} />
      </RulesRow>
      <RulesRow label="Unlisted pairs" idle={!hasTransitions} help={needs ?? (node.transitionsUnlisted === "none"
        ? "An error naming the pair: for a table that lists every pair."
        : "The cheapest chain of listed pairs, as a road network routes.")}>
        <RulesSeg label="Unlisted pairs" value={node.transitionsUnlisted} options={TRANSITION_UNLISTED_OPTIONS} onChange={(v) => set(() => { node.transitionsUnlisted = v; })} />
      </RulesRow>
      <RulesRow label="Name column" idle={!hasTransitions} help={needs ?? "The items' column of the names From and To use."}>
        <RulesColumn label="Name column" value={node.transitionsMatch} columns={items} blank="first text column" onChange={(v) => set(() => { node.transitionsMatch = v; })} />
      </RulesRow>
      <RulesRow label="Value column" idle={!hasTransitions} help={needs ?? "The Transitions column whose number is added, in any unit."}>
        <RulesColumn label="Value column" value={node.transitionsOf} columns={transitionNumbers} blank="first number column" onChange={(v) => set(() => { node.transitionsOf = v; })} />
      </RulesRow>
    </RulesGroup>
  );

  if (node instanceof GreedyQueueNode) {
    const order = node.orderBy === "cost" ? "cost" : node.orderDir;
    const hasGroups = wired.has("group") || !!node.stringLiterals.group || wired.has("start");
    const hasBudget = wired.has("budget") || node.literals.budget != null;
    return (
      <RulesPopup title={state.title} accent={state.accent} onClose={close} note="Formulas and numbers are wired on the card.">
        <RulesSection title="Next item">
          <RulesRow label="Order" help={node.orderBy === "cost" ? "The item that costs least to take next, its transition included: the nearest stop, the quickest changeover." : "By a column of the items; an Order formula on the card breaks ties."}>
            <RulesSeg label="Order" value={order} options={QUEUE_ORDER_OPTIONS} onChange={(v) => set(() => {
              if (v === "cost") node.orderBy = "cost";
              else { node.orderBy = "column"; node.orderDir = v; }
            })} />
          </RulesRow>
          <RulesRow label="Order column" idle={node.orderBy === "cost" && !wired.has("orderColumn")} help={node.orderBy === "cost" ? "Not used by Cheapest first." : undefined}>
            {column("orderColumn", "Order column", "listed order")}
          </RulesRow>
        </RulesSection>
        <RulesSection title="Cost of an item">
          <RulesRow label="Cost column" help="Its number counts, plus a Cost formula and transitions where wired.">
            {column("costColumn", "Cost column", "none")}
          </RulesRow>
          {transitions}
        </RulesSection>
        <RulesSection title="Groups">
          <RulesRow label="Group column" help="Items with a blank group are anyone's.">
            {column("group", "Group column", "one group")}
          </RulesRow>
          <RulesGroup>
            <RulesRow label="Turn order" idle={!hasGroups} help={hasGroups ? undefined : "Needs a group column or Groups wired."}>
              <RulesSeg label="Turn order" value={node.turns} options={QUEUE_TURNS_OPTIONS} onChange={(v) => set(() => { node.turns = v; })} />
            </RulesRow>
          </RulesGroup>
        </RulesSection>
        <RulesSection title="Steps">
          <RulesRow label="Opening step" help="The step each item becomes available.">
            {column("step", "Opening step", "all at step 1")}
          </RulesRow>
          <RulesRow label="Step start" idle={!wired.has("start")} help={wired.has("start") ? undefined : "Needs Groups wired, each group's start."}>
            <RulesSeg label="Step start" value={node.stepStart} options={QUEUE_STEP_START_OPTIONS} onChange={(v) => set(() => { node.stepStart = v; })} />
          </RulesRow>
        </RulesSection>
        <RulesSection title="Budget per step">
          <RulesRow label="Oversize items" idle={!hasBudget} help={hasBudget ? undefined : "Needs a Budget on the card."}>
            <RulesSeg label="Oversize items" value={node.mode} options={QUEUE_FIT_OPTIONS} onChange={(v) => set(() => { node.mode = v; })} />
          </RulesRow>
        </RulesSection>
      </RulesPopup>
    );
  }

  const hasGroups = wired.has("group") || !!node.stringLiterals.group || wired.has("start");
  return (
    <RulesPopup title={state.title} accent={state.accent} onClose={close} note="Formulas and numbers are wired on the card.">
      <RulesSection title="Cost of an item">
        <RulesRow label="Cost column" help="Its number counts, plus a Cost formula and transitions where wired.">
          {column("costColumn", "Cost column", "none")}
        </RulesRow>
        {transitions}
      </RulesSection>
      <RulesSection title="Groups">
        <RulesRow label="Group column" help="Each group's items in order, as Greedy Queue's picks give them.">
          {column("group", "Group column", "one group")}
        </RulesRow>
        <RulesGroup>
          <RulesRow label="Item moves" idle={!hasGroups} help={hasGroups ? undefined : "Needs a group column or Groups wired."}>
            <RulesSeg label="Item moves" value={node.reach} options={SEARCH_REACH_OPTIONS} onChange={(v) => set(() => { node.reach = v; })} />
          </RulesRow>
        </RulesGroup>
        <RulesRow label="Group end" idle={!wired.has("start")} help={wired.has("start") ? undefined : "Back at its start needs Groups wired."}>
          <RulesSeg label="Group end" value={node.ends} options={SEARCH_ENDS_OPTIONS} onChange={(v) => set(() => { node.ends = v; })} />
        </RulesRow>
      </RulesSection>
      <RulesSection title="Search">
        <RulesRow label="Search effort" help="Thorough keeps looking past a dead end, up to 10× longer, never worse.">
          <RulesSeg label="Search effort" value={node.stuck} options={SEARCH_STUCK_OPTIONS} onChange={(v) => set(() => { node.stuck = v; })} />
        </RulesRow>
      </RulesSection>
    </RulesPopup>
  );
}
