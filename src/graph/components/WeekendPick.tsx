// [[C26]] opArgDistinct
// The Weekend setting of the scheduling cards (Schedule, Gantt, Earned Value): which days are off, picked by name. It
// stores Excel's WORKDAY.INTL code, so a save reads the same, and has no socket: a weekend is a setting of the card.
import type { GraphNode } from "../graphModel";
import { ArgSelect } from "./nodeKit";
import { processGraph } from "../process";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Codes 1 to 7 take two days off (1 is Sat and Sun, 2 Sun and Mon, …), 11 to 17 one (11 is Sun, 12 Mon, …). */
export const WEEKEND_OPTIONS: readonly { value: string; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((c) => ({ value: String(c), label: `${DAYS[(c + 4) % 7]} and ${DAYS[(c + 5) % 7]}` })),
  ...[11, 12, 13, 14, 15, 16, 17].map((c) => ({ value: String(c), label: `${DAYS[(c - 5) % 7]} only` })),
];

export function WeekendPick({ node }: { node: GraphNode & { literals: Record<string, number> } }) {
  const code = node.literals.weekend_code ?? 1;
  const known = WEEKEND_OPTIONS.some((o) => o.value === String(code));
  const set = (v: string) => {
    node.literals.weekend_code = Number(v);
    node.edited(); void processGraph(node.id);
  };
  return (
    <div className="solenoid-node__io-row">
      <span className="solenoid-node__io-label">Weekend</span>
      <ArgSelect value={String(code)} onChange={set}
        options={known ? WEEKEND_OPTIONS : [...WEEKEND_OPTIONS, { value: String(code), label: `Code ${code}` }]} />
    </div>
  );
}
