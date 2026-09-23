// [[D19]] implReteFree, [[C17]] shareImpl

export interface SettleRow {
  name: string;
  paid: number;
  share?: number | null;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface Settlement {
  nets: number[];
  shares: number[];
  transfers: Transfer[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const fin = (x: number) => (Number.isFinite(x) ? x : 0);

export function minTransfers(balancesIn: readonly { name: string; net: number }[]): Transfer[] {
  // A name listed twice nets first, so nobody ever pays themselves.
  const byName = new Map<string, { name: string; net: number }>();
  for (const b of balancesIn) {
    const cur = byName.get(b.name);
    if (cur) cur.net += b.net; else byName.set(b.name, { name: b.name, net: b.net });
  }
  const balances = [...byName.values()];
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

export interface Expense {
  amount: number;
  payers: string[];
  beneficiaries: string[] | null;
}

export interface LedgerSettlement {
  people: string[];
  paid: number[];
  shares: number[];
  nets: number[];
  transfers: Transfer[];
}

export function settleLedger(expenses: readonly Expense[]): LedgerSettlement {
  const order: string[] = [];
  const idx = new Map<string, number>();
  const see = (name: string): number => {
    let i = idx.get(name);
    if (i === undefined) { i = order.length; idx.set(name, i); order.push(name); }
    return i;
  };
  const uniq = (names: string[]) => [...new Set(names)];
  // Register every named person first, so a whole-group split covers the full roster, not just who has been seen so far.
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
