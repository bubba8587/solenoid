import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { parseCsvRows } from "./csv";
import { frameFromCells, getColumn } from "./frame";
import committedSeed from "./seedGraphs/personal-finance.json";

// Throwaway runtime check for the Personal Finance seed data: confirms the CSVs
// type the way the graph expects (numeric Amount/Balance columns, the right
// header names) and that the headline aggregates land where the seed's gauges
// and alerts assume.
function loadFrame(file: string) {
  const text = readFileSync(`public/data/personal-finance/${file}`, "utf8");
  const rows = parseCsvRows(text, { detectDelimiter: true });
  return frameFromCells(rows[0].map((h) => h.trim()), rows.slice(1));
}
const nums = (f: ReturnType<typeof loadFrame>, name: string) =>
  (getColumn(f, name)!.values as unknown[]).map(Number);

describe("personal-finance seed data", () => {
  it("transactions: Amount numeric, income vs spend split is sane", () => {
    const tx = loadFrame("transactions.csv");
    const amt = nums(tx, "Amount");
    expect(getColumn(tx, "Category")).toBeTruthy();
    const income = amt.filter((x) => x > 0).reduce((a, b) => a + b, 0);
    const spend = amt.filter((x) => x < 0).reduce((a, b) => a + b, 0);
    const rate = (income + spend) / income;
    expect(income).toBeCloseTo(16910, 0);
    expect(rate).toBeGreaterThan(0.2); // gauge/alert assume a healthy positive rate
    expect(rate).toBeLessThan(1);
  });

  it("accounts: Balance numeric, net worth ~101010, assets/liabilities split", () => {
    const acct = loadFrame("accounts.csv");
    const bal = nums(acct, "Balance");
    const type = getColumn(acct, "Type")!.values as string[];
    const nw = bal.reduce((a, b) => a + b, 0);
    expect(nw).toBeCloseTo(101010, 0);
    // GroupBy(Type) preserves first-appearance order → [Asset, Liability], which
    // is what idx-assets (INDEX 1) / idx-liab (INDEX 2) rely on.
    expect(type[0]).toBe("Asset");
    const assets = bal.filter((_, i) => type[i] === "Asset").reduce((a, b) => a + b, 0);
    const liab = bal.filter((_, i) => type[i] === "Liability").reduce((a, b) => a + b, 0);
    expect(assets).toBeCloseTo(123650, 0);
    expect(liab).toBeCloseTo(-22640, 0);
  });

  it("expenses-only pivot excludes income and has positive per-category spend", () => {
    const tx = loadFrame("transactions.csv");
    const cat = getColumn(tx, "Category")!.values as string[];
    const amt = nums(tx, "Amount");
    const expenseCats = ["Housing", "Groceries", "Dining", "Transport", "Utilities", "Entertainment", "Shopping", "Health"];
    const perCat = new Map<string, number>();
    cat.forEach((cName, i) => {
      if (!expenseCats.includes(cName)) return;
      perCat.set(cName, (perCat.get(cName) ?? 0) + Math.abs(amt[i]));
    });
    expect([...perCat.keys()].sort()).toEqual([...expenseCats].sort());
    for (const v of perCat.values()) expect(v).toBeGreaterThan(0);
  });

  it("groceries quarterly spend exceeds the seeded budget (alert primed)", () => {
    const tx = loadFrame("transactions.csv");
    const cat = getColumn(tx, "Category")!.values as string[];
    const amt = nums(tx, "Amount");
    const groceries = -amt.filter((_, i) => cat[i] === "Groceries").reduce((a, b) => a + b, 0);
    expect(groceries).toBeGreaterThan(1300); // sld-gbud default → alert trips on a nudge
  });
});

// Generator lockstep. The seed is large and hand-wired in code
// (scripts/gen-personal-finance-seed.cjs), so the committed JSON must stay an
// exact re-emit of that generator. This is the guard the backlog asked for: it
// catches the seed silently shedding connections (every `c(...)` must survive
// into the JSON) AND catches the generator drifting from the real node classes
// — the failure that actually bit us, where the Reduce→Aggregate rename left the
// generator emitting a now-deleted `ReduceNode`, so a regenerate would drop every
// cable touching those nodes on load. seeds.test.ts separately proves every JSON
// connection lands on a live socket; together they keep the wiring whole.
describe("personal-finance seed generator", () => {
  const require = createRequire(import.meta.url);
  const { graph } = require("../../scripts/gen-personal-finance-seed.cjs") as {
    graph: typeof committedSeed;
  };

  it("committed JSON is an exact re-emit of the generator", () => {
    // Deep-equal ignores key order; covers nodes, connections, standoffs, pins.
    expect(graph).toEqual(committedSeed);
  });
});
