// Group cost settlement (1.4 H3): people paid uneven amounts; who pays whom, in the fewest
// transfers, so everyone ends up even. Net each person (paid − fair share), then greedily
// match the biggest creditor to the biggest debtor. Linear, exact, no solver. Pure.
//
// Two entry points share the greedy transfer core (`minTransfers`):
//   • `settleGroup` — TOTALS: one row per person with a Paid total and an optional Share weight.
//   • `settleLedger` — TRANSACTIONS: a ledger of expenses, each with payer(s) and beneficiaries,
//     split equally on both sides.
//
// Both report each person's `paid` (fronted, external) and `shares` (their fair cost). The node's
// Net table then reads: Paid + Owes (still owed to the group) + Owed (coming back, negative) =
// Net, which equals the fair share — a person's TRUE cost. In equal-split totals every Net is the
// same. `balance = paid − share` decides the settlement: a creditor's balance comes back (Owed),
// a debtor's is paid out (Owes).

export interface SettleRow {
  name: string;
  paid: number;
  /** Optional weight of the share this person owes (1 = an equal share). */
  share?: number | null;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface Settlement {
  /** Each person's balance: paid − fair share. Positive = is owed, negative = owes. */
  nets: number[];
  /** Everyone's fair share (paid total × weight / Σ weights) — their true cost. Same order. */
  shares: number[];
  transfers: Transfer[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const fin = (x: number) => (Number.isFinite(x) ? x : 0);

/** The greedy core, shared by both modes: net balances in (positive = is owed), the fewest
 *  transfers out. The biggest creditor takes from the biggest debtor until one goes even;
 *  amounts round to cents. Ties keep input order (a stable sort), so the result is
 *  deterministic. */
export function minTransfers(balances: readonly { name: string; net: number }[]): Transfer[] {
  const creditors = balances.map((b) => ({ name: b.name, v: round2(b.net) })).filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const debtors = balances.map((b) => ({ name: b.name, v: round2(-b.net) })).filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const transfers: Transfer[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci], d = debtors[di];
    const amount = round2(Math.min(c.v, d.v));
    if (amount > 0) transfers.push({ from: d.name, to: c.name, amount });
    c.v = round2(c.v - amount);
    d.v = round2(d.v - amount);
    if (c.v <= 0.005) ci++;
    if (d.v <= 0.005) di++;
  }
  return transfers;
}

/** Settle the group. Shares come from the `share` weights when any row carries one (a blank
 *  weighs 1); otherwise everyone owes an equal share. In equal split every share is the same,
 *  so every Net (the fair share) matches. Amounts round to cents. */
export function settleGroup(rows: readonly SettleRow[], opts: { weighted?: boolean } = {}): Settlement {
  const n = rows.length;
  const paidArr = rows.map((r) => fin(r.paid));
  const total = paidArr.reduce((s, p) => s + p, 0);
  const useWeights = opts.weighted ?? rows.some((r) => r.share != null);
  const weights = rows.map((r) => (useWeights && r.share != null && Number.isFinite(r.share) && r.share >= 0 ? r.share : 1));
  const wsum = weights.reduce((a, b) => a + b, 0) || n;
  const shares = weights.map((w) => (n ? (total * w) / wsum : 0));
  const nets = paidArr.map((p, i) => p - shares[i]);
  const transfers = minTransfers(rows.map((r, i) => ({ name: r.name, net: nets[i] })));
  return { nets: nets.map(round2), shares: shares.map(round2), transfers };
}

/** One ledger row: an amount fronted by one or more payers, to be split EQUALLY among the
 *  beneficiaries. `payers` and `beneficiaries` are independent name sets (the group that
 *  pays need not be the group that owes). `beneficiaries: null` means "the whole group" —
 *  everyone who appears anywhere in the ledger. */
export interface Expense {
  amount: number;
  payers: string[];
  beneficiaries: string[] | null;
}

export interface LedgerSettlement {
  /** The roster, in first-appearance order (payer before beneficiary, row by row). */
  people: string[];
  /** Total each person fronted (external). Same order as `people`. */
  paid: number[];
  /** Each person's fair share — their true cost. Same order as `people`. */
  shares: number[];
  /** Balance: paid − share. Same order as `people`. */
  nets: number[];
  transfers: Transfer[];
}

/** Settle a ledger of expenses. Each expense credits its payers an equal split of the amount
 *  and debits its beneficiaries an equal split; sums land as per-person Paid and fair share,
 *  and the balance (paid − share) feeds the same greedy `minTransfers`. Equal-split only — no
 *  weights (author 2026-09-08). */
export function settleLedger(expenses: readonly Expense[]): LedgerSettlement {
  const order: string[] = [];
  const idx = new Map<string, number>();
  const see = (name: string): number => {
    let i = idx.get(name);
    if (i === undefined) { i = order.length; idx.set(name, i); order.push(name); }
    return i;
  };
  const uniq = (names: string[]) => [...new Set(names)];
  // Register every explicitly-named person first, so a "whole group" split (null
  // beneficiaries) covers the full roster and not just who has been seen so far.
  for (const e of expenses) { for (const p of e.payers) see(p); if (e.beneficiaries) for (const b of e.beneficiaries) see(b); }
  const paid = order.map(() => 0);
  const shares = order.map(() => 0);
  for (const e of expenses) {
    const amt = fin(e.amount);
    const payers = uniq(e.payers);
    const bens = uniq(e.beneficiaries ?? order);
    if (payers.length === 0 || bens.length === 0) continue;
    for (const p of payers) paid[see(p)] += amt / payers.length;
    for (const b of bens) shares[see(b)] += amt / bens.length;
  }
  const nets = order.map((_, i) => paid[i] - shares[i]);
  const transfers = minTransfers(order.map((name, i) => ({ name, net: nets[i] })));
  return { people: order, paid: paid.map(round2), shares: shares.map(round2), nets: nets.map(round2), transfers };
}
