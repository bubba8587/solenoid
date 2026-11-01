// [[B17]], [[C48]]
import { describe, it, expect } from "vitest";
import { SettleNode, type SettleSplit } from "../../src/graph/nodes/frame";
import { recordsToCube, type CubeValue, type FrameValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

// Group Cost Settle: net everyone, then the biggest creditor takes from the biggest debtor — the fewest transfers a
// greedy pass gives, exact to the cent.

type Settled = { transfers: FrameValue; net: FrameValue };
function settle(input: FrameValue | CubeValue, mode: "totals" | "transactions", split: SettleSplit = "equal"): Settled {
  const out = new SettleNode({ mode, split }).data({ in: [input] });
  if (isSolError(out.transfers) || !out.transfers) throw out.transfers;
  return out as Settled;
}
const people = (rows: [string, number, (number | null)?][]): FrameValue => ({ __frame: true, columns: [
  { name: "Person", type: "string", values: rows.map((r) => r[0]) },
  { name: "Paid", type: "number", values: rows.map((r) => r[1]) },
  ...(rows.some((r) => r.length > 2) ? [{ name: "Share", type: "number" as const, values: rows.map((r) => r[2] ?? null) }] : []),
] });
const settleFrame = (f: FrameValue, split: SettleSplit = "equal") => settle(f, "totals", split);
const settleLedgerCube = (c: CubeValue) => settle(c, "transactions");
const values = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)!.values;
const transfers = (f: FrameValue) => values(f, "From").map((from, i) => ({ from, to: values(f, "To")[i], amount: values(f, "Amount")[i] }));

describe("totals", () => {
  it("the trip: four people, uneven payments, settled in three transfers", () => {
    const r = settleFrame(people([["Ada", 300], ["Bo", 100], ["Cy", 40], ["Di", 0]]));
    expect(values(r.net, "Net")).toEqual([110, 110, 110, 110]); // equal split → every share (true cost) matches
    expect(values(r.net, "Owes")).toEqual([0, 10, 70, 110]);
    expect(values(r.net, "Owed")).toEqual([-190, 0, 0, 0]);
    expect(transfers(r.transfers)).toEqual([
      { from: "Di", to: "Ada", amount: 110 },
      { from: "Cy", to: "Ada", amount: 70 },
      { from: "Bo", to: "Ada", amount: 10 },
    ]);
  });
  it("share weights: a couple counts double; blank weighs 1; an equal split ignores them", () => {
    const f = people([["Ada", 90, 2], ["Bo", 0, null]]);
    const w = settleFrame(f, "weighted");
    expect(values(w.net, "Net")).toEqual([60, 30]);
    expect(transfers(w.transfers)).toEqual([{ from: "Bo", to: "Ada", amount: 30 }]);
    expect(values(settleFrame(f, "equal").net, "Net")).toEqual([45, 45]);
  });
  it("already even → no transfers; cents round and still balance", () => {
    expect(transfers(settleFrame(people([["A", 10], ["B", 10]])).transfers)).toEqual([]);
    const r = settleFrame(people([["A", 10], ["B", 0], ["C", 0]]));
    expect(values(r.net, "Net")).toEqual([3.33, 3.33, 3.33]);
    expect(transfers(r.transfers)).toEqual([{ from: "B", to: "A", amount: 3.33 }, { from: "C", to: "A", amount: 3.33 }]);
  });
  it("an empty group settles nothing", () => {
    expect(transfers(settleFrame(people([])).transfers)).toEqual([]);
  });
  it("Net = Paid + Owes + Owed is the fair share; equal split → equal Nets", () => {
    // The author's example: three ways on $300, everyone's true cost is $100.
    const { net } = settleFrame(people([["A", 200], ["B", 0], ["C", 100]]));
    expect(net.columns.map((c) => c.name)).toEqual(["Person", "Paid", "Owes", "Owed", "Net"]);
    expect(net.columns[1].values).toEqual([200, 0, 100]);   // Paid
    expect(net.columns[2].values).toEqual([0, 100, 0]);     // Owes (still owed to the group, +)
    expect(net.columns[3].values).toEqual([-100, 0, 0]);    // Owed (coming back, −)
    expect(net.columns[4].values).toEqual([100, 100, 100]); // Net = fair share, all equal
  });
});

// TRANSACTIONS mode: a ledger of expenses, each split equally among its beneficiaries, with payers and beneficiaries
// as independent sets. Both halves feed the same greedy pairing.
describe("transactions", () => {
  it("reads an expense cube with list cells into the two frames", () => {
    const cube = recordsToCube([
      { Item: "Dinner", Amount: 120, "Paid by": "Ada", For: ["Ada", "Bo", "Cy", "Di"] }, // everyone
      { Item: "Taxi", Amount: 40, "Paid by": "Bo", For: ["Bo", "Cy"] },                 // just two shared the cab
      { Item: "Hotel", Amount: 300, "Paid by": ["Ada", "Bo"], For: ["Ada", "Bo", "Cy", "Di"] }, // two payers front it
      { Item: "Cy's ticket", Amount: 60, "Paid by": "Ada", For: ["Cy"] },              // Ada covered Cy's ticket
    ]);
    const { transfers: t, net } = settleLedgerCube(cube);
    expect(net.columns.map((c) => c.name)).toEqual(["Person", "Paid", "Owes", "Owed", "Net"]);
    expect(net.columns[0].values).toEqual(["Ada", "Bo", "Cy", "Di"]);
    expect(net.columns[1].values).toEqual([330, 190, 0, 0]);       // Paid: Ada fronted 120 + 150 (half the hotel) + 60
    expect(net.columns[2].values).toEqual([0, 0, 185, 105]);       // Owes (still owed to the group)
    expect(net.columns[3].values).toEqual([-225, -65, 0, 0]);      // Owed (coming back)
    expect(net.columns[4].values).toEqual([105, 125, 185, 105]);   // Net = fair share
    expect(transfers(t)).toEqual([
      { from: "Cy", to: "Ada", amount: 185 },
      { from: "Di", to: "Ada", amount: 40 },
      { from: "Di", to: "Bo", amount: 65 },
    ]);
  });

  it("a blank beneficiary list means the whole group, roster included from other rows", () => {
    const { transfers: t, net } = settleLedgerCube(recordsToCube([
      { Amount: 90, "Paid by": "Ada", For: null },  // split among everyone seen
      { Amount: 0, "Paid by": "Cy", For: "Cy" },    // registers Cy on the roster
    ]));
    expect(values(net, "Person")).toEqual(["Ada", "Cy"]);
    expect(values(net, "Net")).toEqual([45, 45]); // 90 split between Ada and Cy
    expect(transfers(t)).toEqual([{ from: "Cy", to: "Ada", amount: 45 }]);
  });
});

describe("review pins: names and signs", () => {
  it("totals: two rows for one name (any case) sum, and nobody pays themselves", () => {
    const { transfers: t, net } = settleFrame(people([["A", 100], ["a", 0], ["B", 0]]));
    expect(net.columns[0].values).toEqual(["A", "B"]);
    expect(transfers(t)).toEqual([{ from: "B", to: "A", amount: 50 }]);
  });

  it("transactions: a refund row keeps its sign; ada and Ada are one person", () => {
    const { transfers: t, net } = settleLedgerCube(recordsToCube([
      { Amount: 100, "Paid by": "Ada", For: "Ada, Bo" },
      { Amount: -40, "Paid by": "bo", For: "ada" },
    ]));
    expect(net.columns[0].values).toEqual(["Ada", "Bo"]);
    expect(net.columns[4].values).toEqual([10, 50]); // shares: Ada 50 − 40, Bo 50
    expect(t.columns.map((c) => c.values)).toEqual([["Bo"], ["Ada"], [90]]);
  });
});
