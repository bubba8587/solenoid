import { describe, it, expect } from "vitest";
import { settleGroup, settleLedger, minTransfers } from "../../src/graph/nodes/settleOps";
import { settleFrame, settleLedgerCube } from "../../src/graph/nodes/frame";
import { recordsToCube, type FrameValue } from "../../src/graph/frame";

// 1.4 H3 Group Cost Settle: net everyone, then the biggest creditor takes from the biggest
// debtor — the fewest transfers a greedy pass gives, exact to the cent.

describe("settleGroup", () => {
  it("the trip: four people, uneven payments, settled in three transfers", () => {
    const r = settleGroup([
      { name: "Ada", paid: 300 }, { name: "Bo", paid: 100 }, { name: "Cy", paid: 40 }, { name: "Di", paid: 0 },
    ]);
    expect(r.shares).toEqual([110, 110, 110, 110]); // equal split → every share (true cost) matches
    expect(r.nets).toEqual([190, -10, -70, -110]);  // balance = paid − share
    expect(r.transfers).toEqual([
      { from: "Di", to: "Ada", amount: 110 },
      { from: "Cy", to: "Ada", amount: 70 },
      { from: "Bo", to: "Ada", amount: 10 },
    ]);
    const paidBack = r.transfers.reduce((s, t) => s + t.amount, 0);
    expect(paidBack).toBe(190);
  });
  it("share weights: a couple counts double; blank weighs 1; opting out of weights ignores them", () => {
    const rows = [{ name: "Ada", paid: 90, share: 2 }, { name: "Bo", paid: 0, share: null }];
    expect(settleGroup(rows).shares).toEqual([60, 30]);
    expect(settleGroup(rows).transfers).toEqual([{ from: "Bo", to: "Ada", amount: 30 }]);
    expect(settleGroup(rows, { weighted: false }).shares).toEqual([45, 45]);
  });
  it("already even → no transfers; cents round and still balance", () => {
    expect(settleGroup([{ name: "A", paid: 10 }, { name: "B", paid: 10 }]).transfers).toEqual([]);
    const r = settleGroup([{ name: "A", paid: 10 }, { name: "B", paid: 0 }, { name: "C", paid: 0 }]);
    expect(r.shares).toEqual([3.33, 3.33, 3.33]);
    expect(r.transfers).toEqual([{ from: "B", to: "A", amount: 3.33 }, { from: "C", to: "A", amount: 3.33 }]);
  });
  it("an empty group settles nothing", () => {
    expect(settleGroup([])).toEqual({ nets: [], shares: [], transfers: [] });
  });
  it("settleFrame: Net = Paid + Owes + Owed is the fair share; equal split → equal Nets", () => {
    // The author's example: three ways on $300, everyone's true cost is $100.
    const f: FrameValue = { __frame: true, columns: [
      { name: "Person", type: "string", values: ["A", "B", "C"] },
      { name: "Paid", type: "number", values: [200, 0, 100] },
    ] };
    const { net } = settleFrame(f, "equal");
    expect(net.columns.map((c) => c.name)).toEqual(["Person", "Paid", "Owes", "Owed", "Net"]);
    expect(net.columns[1].values).toEqual([200, 0, 100]);   // Paid
    expect(net.columns[2].values).toEqual([0, 100, 0]);     // Owes (still owed to the group, +)
    expect(net.columns[3].values).toEqual([-100, 0, 0]);    // Owed (coming back, −)
    expect(net.columns[4].values).toEqual([100, 100, 100]); // Net = fair share, all equal
    // Identity holds per row: Paid + Owes + Owed = Net.
    const num = (c: number, i: number) => net.columns[c].values[i] as number;
    for (let i = 0; i < 3; i++) {
      expect(num(1, i) + num(2, i) + num(3, i)).toBe(num(4, i));
    }
  });
});

// TRANSACTIONS mode: a ledger of expenses, each split equally among its beneficiaries, with
// payers and beneficiaries as independent sets. Both halves feed the same greedy minTransfers.
describe("minTransfers", () => {
  it("the biggest creditor takes from the biggest debtor, fewest transfers", () => {
    expect(minTransfers([{ name: "A", net: 190 }, { name: "B", net: -10 }, { name: "C", net: -70 }, { name: "D", net: -110 }])).toEqual([
      { from: "D", to: "A", amount: 110 }, { from: "C", to: "A", amount: 70 }, { from: "B", to: "A", amount: 10 },
    ]);
  });
  it("an even group needs nothing", () => {
    expect(minTransfers([{ name: "A", net: 0 }, { name: "B", net: 0 }])).toEqual([]);
  });
});

describe("settleLedger", () => {
  it("the trip: a shared bill, a sub-group cab, a one-person reimbursement", () => {
    const r = settleLedger([
      { amount: 120, payers: ["Ada"], beneficiaries: ["Ada", "Bo", "Cy", "Di"] }, // everyone
      { amount: 40, payers: ["Bo"], beneficiaries: ["Bo", "Cy"] },                 // just two shared the cab
      { amount: 300, payers: ["Ada", "Bo"], beneficiaries: ["Ada", "Bo", "Cy", "Di"] }, // two payers front it
      { amount: 60, payers: ["Ada"], beneficiaries: ["Cy"] },                      // Ada covered Cy's ticket
    ]);
    expect(r.people).toEqual(["Ada", "Bo", "Cy", "Di"]);
    expect(r.paid).toEqual([330, 190, 0, 0]);        // Ada fronted 120 + 150 (half the hotel) + 60
    expect(r.shares).toEqual([105, 125, 185, 105]);  // fair share = true cost (varies: different rows)
    expect(r.nets).toEqual([225, 65, -185, -105]);   // balance = paid − share
    expect(r.transfers).toEqual([
      { from: "Cy", to: "Ada", amount: 185 },
      { from: "Di", to: "Ada", amount: 40 },
      { from: "Di", to: "Bo", amount: 65 },
    ]);
  });

  it("a blank beneficiary list means the whole group, roster included from other rows", () => {
    const r = settleLedger([
      { amount: 90, payers: ["Ada"], beneficiaries: null },  // split among everyone seen
      { amount: 0, payers: ["Cy"], beneficiaries: ["Cy"] },  // registers Cy on the roster
    ]);
    expect(r.people).toEqual(["Ada", "Cy"]);
    expect(r.shares).toEqual([45, 45]); // 90 split between Ada and Cy
    expect(r.transfers).toEqual([{ from: "Cy", to: "Ada", amount: 45 }]);
  });
});

describe("settleLedgerCube", () => {
  it("reads an expense cube with list cells into the two frames", () => {
    const cube = recordsToCube([
      { Item: "Dinner", Amount: 120, "Paid by": "Ada", For: ["Ada", "Bo", "Cy", "Di"] },
      { Item: "Taxi", Amount: 40, "Paid by": "Bo", For: ["Bo", "Cy"] },
      { Item: "Hotel", Amount: 300, "Paid by": ["Ada", "Bo"], For: ["Ada", "Bo", "Cy", "Di"] },
      { Item: "Cy's ticket", Amount: 60, "Paid by": "Ada", For: ["Cy"] },
    ]);
    const { transfers, net } = settleLedgerCube(cube);
    expect(net.columns.map((c) => c.name)).toEqual(["Person", "Paid", "Owes", "Owed", "Net"]);
    expect(net.columns[0].values).toEqual(["Ada", "Bo", "Cy", "Di"]);
    expect(net.columns[1].values).toEqual([330, 190, 0, 0]);       // Paid
    expect(net.columns[2].values).toEqual([0, 0, 185, 105]);       // Owes (still owed to the group)
    expect(net.columns[3].values).toEqual([-225, -65, 0, 0]);      // Owed (coming back)
    expect(net.columns[4].values).toEqual([105, 125, 185, 105]);   // Net = fair share
    expect(transfers.columns.map((c) => c.name)).toEqual(["From", "To", "Amount"]);
    expect(transfers.columns[2].values).toEqual([185, 40, 65]);
  });
});
