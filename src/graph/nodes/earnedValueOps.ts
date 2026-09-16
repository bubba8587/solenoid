// Earned Value math — pure, rete-free and unit-free (magnitudes in, metrics out; the node
// layer carries the Cost column's currency unit onto the money columns). Terms are the PM
// standard: BCWS/PV planned value, BCWP/EV earned value, ACWP/AC actual cost.

/** Working days from `from` to `to` inclusive of both ends. The node injects the engine's
 *  `Calendar.countBetween`, so the count honors the same weekend + holidays as the schedule. */
export type CountWorkingDays = (from: number, to: number) => number;

/** The fraction of a task's baseline work planned to be done by the status date, measured
 *  in working days over the baseline span. */
export function plannedFraction(plannedStart: number | null, plannedFinish: number | null, status: number, count: CountWorkingDays): number {
  if (plannedStart == null || plannedFinish == null) return 0;
  if (status <= plannedStart) return 0;
  if (status >= plannedFinish) return 1;
  const total = count(plannedStart, plannedFinish);
  if (total <= 0) return status >= plannedStart ? 1 : 0;
  return Math.min(1, count(plannedStart, status) / total);
}

export interface EvTaskInput {
  name: string;
  /** Budget at completion for the task (the Cost column), a magnitude. */
  cost: number;
  /** Percent complete, 0..100. */
  complete: number;
  /** Baseline (planned) start/finish serials — the plan as it was, joined by name. */
  plannedStart: number | null;
  plannedFinish: number | null;
  /** Actual cost so far, when an Actual cost column is present; null → ACWP falls back to BCWP. */
  actualCost: number | null;
}

export interface EvTaskMetrics {
  name: string;
  bcws: number; bcwp: number; acwp: number;
  sv: number; cv: number;
  /** Ratios are null when their denominator is 0 (undefined, drawn blank). */
  spi: number | null; cpi: number | null;
  eac: number; vac: number; tcpi: number | null;
}

export interface EvTotals {
  bcws: number; bcwp: number; acwp: number;
  sv: number; cv: number;
  spi: number | null; cpi: number | null;
  eac: number; vac: number; tcpi: number | null;
}

const ratio = (num: number, den: number): number | null => (den !== 0 ? num / den : null);

function metricsFor(bac: number, bcws: number, bcwp: number, acwp: number): {
  sv: number; cv: number; spi: number | null; cpi: number | null; eac: number; vac: number; tcpi: number | null;
} {
  const cpi = ratio(bcwp, acwp);
  const eac = cpi != null && cpi > 0 ? bac / cpi : bac; // CPI unknown → assume the rest runs to budget
  return {
    sv: bcwp - bcws,
    cv: bcwp - acwp,
    spi: ratio(bcwp, bcws),
    cpi,
    eac,
    vac: bac - eac,
    tcpi: ratio(bac - bcwp, bac - acwp),
  };
}

/** Per-task metrics plus the project totals (each total ratio computed from the summed
 *  components, never averaged — the PM convention). */
export function earnedValue(tasks: EvTaskInput[], status: number, count: CountWorkingDays): { tasks: EvTaskMetrics[]; totals: EvTotals } {
  const rows: EvTaskMetrics[] = tasks.map((t) => {
    const bac = t.cost;
    const bcws = bac * plannedFraction(t.plannedStart, t.plannedFinish, status, count);
    const bcwp = bac * (t.complete / 100);
    const acwp = t.actualCost != null ? t.actualCost : bcwp;
    return { name: t.name, bcws, bcwp, acwp, ...metricsFor(bac, bcws, bcwp, acwp) };
  });
  const sum = (f: (t: EvTaskInput) => number) => tasks.reduce((a, t) => a + f(t), 0);
  const bacTotal = sum((t) => t.cost);
  const bcwsTotal = rows.reduce((a, r) => a + r.bcws, 0);
  const bcwpTotal = rows.reduce((a, r) => a + r.bcwp, 0);
  const acwpTotal = rows.reduce((a, r) => a + r.acwp, 0);
  const totals: EvTotals = { bcws: bcwsTotal, bcwp: bcwpTotal, acwp: acwpTotal, ...metricsFor(bacTotal, bcwsTotal, bcwpTotal, acwpTotal) };
  return { tasks: rows, totals };
}
