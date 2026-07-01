// End-to-end: compose several verbs through the backend exactly as the future verb
// NODES will (source → join → apply(groupBy) → apply(sort) → preview). Guards that
// the verbs chain correctly through handles, not just in isolation — the realistic
// "orders ⋈ customers → group → rank" pipeline from the v1.0 plan, as a unit test.
import { describe, it, expect } from "vitest";
import { frameBackend } from "./frameBackend";
import type { FrameValue } from "./frame";

const customers: FrameValue = {
  __frame: true,
  columns: [
    { name: "id", type: "number", values: [1, 2, 3] },
    { name: "name", type: "string", values: ["Ada", "Bo", "Cy"] },
  ],
};
const orders: FrameValue = {
  __frame: true,
  columns: [
    { name: "cust", type: "number", values: [1, 1, 2, 3, 3, 3] },
    { name: "amt", type: "number", values: [10, 20, 5, 1, 2, 3] },
  ],
};

describe("verb pipeline through the backend", () => {
  it("join → groupBy → sort → head ranks customers by total spend", async () => {
    const be = frameBackend();
    const hc = await be.source(customers);
    const ho = await be.source(orders);

    const joined = await be.join(hc, ho, { leftKey: "id", rightKey: "cust", how: "inner" });
    const grouped = await be.apply(joined, {
      kind: "groupBy", keys: ["name"],
      aggs: [{ column: "amt", op: "sum", as: "total" }, { column: "amt", op: "count", as: "orders" }],
    });
    const ranked = await be.apply(grouped, { kind: "sort", by: "total", dir: "desc" });
    const top2 = await be.apply(ranked, { kind: "head", n: 2 });

    const p = await be.preview(top2, 10);
    expect(p.schema.map((c) => c.name)).toEqual(["name", "total", "orders"]);
    expect(p.rowCount).toBe(2);
    expect(p.rows).toEqual([
      ["Ada", 30, 2], // 10 + 20 over 2 orders
      ["Cy", 6, 3],   // 1 + 2 + 3 over 3 orders (Bo, total 5, falls off the top-2)
    ]);

    // the intermediate handles are still independently materializable (apply forks)
    expect((await be.preview(grouped, 10)).rowCount).toBe(3);
    be.drop(hc); be.drop(ho); be.drop(joined); be.drop(grouped); be.drop(ranked); be.drop(top2);
  });
});
