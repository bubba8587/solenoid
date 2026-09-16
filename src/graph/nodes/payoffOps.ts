// Debt payoff plan (1.4 H1): pay every minimum, throw the extra plus each freed minimum at
// the head debt, roll month by month. Head = highest APR (avalanche) or smallest balance
// (snowball). Closed-form monthly amortization, no solver. Pure.

export type PayoffOrder = "avalanche" | "snowball";

export interface Debt {
  name: string;
  balance: number;
  /** Annual percentage rate as a fraction (0.18) — a value ≥ 1 is read as a percent (18). */
  apr: number;
  /** The minimum monthly payment. */
  min: number;
}

export interface DebtSummary {
  name: string;
  /** Months until this debt reaches zero (0 = already clear). */
  months: number;
  /** Interest paid on this debt over the plan. */
  interest: number;
}

export interface PayoffPlan {
  /** Months until the last debt clears. */
  months: number;
  /** Balances after each month, [month][debt] — month 0 is the starting balances. */
  schedule: number[][];
  perDebt: DebtSummary[];
  totalInterest: number;
}

const MAX_MONTHS = 600;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function monthlyRate(apr: number): number {
  const a = Number.isFinite(apr) && apr >= 0 ? apr : 0;
  return (a >= 1 ? a / 100 : a) / 12;
}

/** The payoff order: the index list of debts, head first. */
export function payoffOrder(debts: readonly Debt[], order: PayoffOrder): number[] {
  const idx = debts.map((_, i) => i);
  if (order === "snowball") return idx.sort((a, b) => debts[a].balance - debts[b].balance || a - b);
  // By the rate the plan charges, so 18 (a percent) and 0.24 (a fraction) compare honestly.
  return idx.sort((a, b) => monthlyRate(debts[b].apr) - monthlyRate(debts[a].apr) || a - b);
}

/** Roll the plan. Throws when the payments can't cover the interest (the balances would
 *  grow forever) — the caller turns that into `#VALUE!` naming the debt. */
export function payoffPlan(debts: readonly Debt[], extra: number, order: PayoffOrder): PayoffPlan {
  const n = debts.length;
  const rates = debts.map((d) => monthlyRate(d.apr));
  const balances = debts.map((d) => Math.max(0, Number.isFinite(d.balance) ? d.balance : 0));
  const mins = debts.map((d) => Math.max(0, Number.isFinite(d.min) ? d.min : 0));
  const interest = new Array<number>(n).fill(0);
  const clearedAt: number[] = balances.map((b) => (b <= 0 ? 0 : -1));
  // A debt that started clear has no payment to free; only minimums that were being paid cascade.
  const wasOpen = balances.map((b) => b > 0.005);
  const rank = payoffOrder(debts, order);
  const schedule: number[][] = [balances.map(round2)];
  const pot = Math.max(0, Number.isFinite(extra) ? extra : 0);
  let month = 0;
  while (balances.some((b) => b > 0.005)) {
    if (++month > MAX_MONTHS) {
      const worst = rank.find((i) => balances[i] > 0.005) ?? 0;
      throw new Error(`the payments never clear "${debts[worst].name}" — raise a minimum or the extra`);
    }
    // Interest accrues, then every open debt gets its minimum (never more than it owes).
    let freed = pot;
    for (let i = 0; i < n; i++) {
      if (balances[i] <= 0.005) { if (wasOpen[i]) freed += mins[i]; continue; }
      const acc = balances[i] * rates[i];
      interest[i] += acc;
      balances[i] += acc;
      const pay = Math.min(mins[i], balances[i]);
      balances[i] -= pay;
      freed += mins[i] - pay; // an overpaid minimum's remainder joins the pot
    }
    // The pot (extra + freed minimums) hits the head debt, cascading down the order.
    for (const i of rank) {
      if (freed <= 0.005) break;
      if (balances[i] <= 0.005) continue;
      const pay = Math.min(freed, balances[i]);
      balances[i] -= pay;
      freed -= pay;
    }
    for (let i = 0; i < n; i++) if (balances[i] <= 0.005 && clearedAt[i] < 0) { balances[i] = 0; clearedAt[i] = month; }
    schedule.push(balances.map(round2));
  }
  return {
    months: month,
    schedule,
    perDebt: debts.map((d, i) => ({ name: d.name, months: clearedAt[i] < 0 ? month : clearedAt[i], interest: round2(interest[i]) })),
    totalInterest: round2(interest.reduce((a, b) => a + b, 0)),
  };
}
