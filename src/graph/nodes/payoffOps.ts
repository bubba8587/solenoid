// [[C17]] shareImpl

export type PayoffOrder = "avalanche" | "snowball";

export interface Debt {
  name: string;
  balance: number;
  /** A fraction (0.18); a value of 1 or more reads as a percent (18). */
  apr: number;
  min: number;
}

export interface DebtSummary {
  name: string;
  months: number;
  interest: number;
}

export interface PayoffPlan {
  months: number;
  /** [month][debt]; month 0 holds the starting balances. */
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

export function payoffOrder(debts: readonly Debt[], order: PayoffOrder): number[] {
  const idx = debts.map((_, i) => i);
  if (order === "snowball") return idx.sort((a, b) => debts[a].balance - debts[b].balance || a - b);
  // Sort by the rate the plan charges, so 18 (a percent) and 0.24 (a fraction) compare correctly.
  return idx.sort((a, b) => monthlyRate(debts[b].apr) - monthlyRate(debts[a].apr) || a - b);
}

/** Throws when the payments never clear a debt; the caller turns that into `#VALUE!` naming it. */
export function payoffPlan(debts: readonly Debt[], extra: number, order: PayoffOrder): PayoffPlan {
  const n = debts.length;
  const rates = debts.map((d) => monthlyRate(d.apr));
  const balances = debts.map((d) => Math.max(0, Number.isFinite(d.balance) ? d.balance : 0));
  const mins = debts.map((d) => Math.max(0, Number.isFinite(d.min) ? d.min : 0));
  const interest = new Array<number>(n).fill(0);
  const clearedAt: number[] = balances.map((b) => (b <= 0 ? 0 : -1));
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
    let freed = pot;
    for (let i = 0; i < n; i++) {
      if (balances[i] <= 0.005) { if (wasOpen[i]) freed += mins[i]; continue; }
      const acc = balances[i] * rates[i];
      interest[i] += acc;
      balances[i] += acc;
      const pay = Math.min(mins[i], balances[i]);
      balances[i] -= pay;
      freed += mins[i] - pay;
    }
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
