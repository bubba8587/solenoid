// [[C127]] pivotView
import { describe, it, expect } from "vitest";
import { pivotFrame } from "./coreVerbs";
import { frameRowCount, type FrameValue, type FrameCell } from "../../src/graph/frame";
import {
  pivotLayoutOf, buildPivotModel, readPivotView, savedPivotView, groupKey,
  DEFAULT_PIVOT_VIEW, filterPivotBody, livePivotFolds, liveDetailKeys, detailCellText, totalsModes, withSubtotals, withGrand, type PivotViewOptions, type PivotBodyRow,
} from "../../src/graph/pivotLayout";
import { carryFrameSidecars } from "../../src/graph/frameSidecar";
import { PivotNode } from "../../src/graph/nodes/frame";
import { extractInit } from "../../src/graph/nodeInit";

const sales: FrameValue = {
  __frame: true,
  columns: [
    { name: "Region", type: "string", values: ["N", "N", "S", "S", "N", "S"] },
    { name: "Rep", type: "string", values: ["Ann", "Bo", "Cy", "Cy", "Ann", "Di"] },
    { name: "Q", type: "string", values: ["Q1", "Q2", "Q1", "Q2", "Q2", "Q1"] },
    { name: "Amt", type: "number", values: [1, 2, 3, 4, 5, 6] },
  ],
};
const spec = (rowTotalDepth: number, colTotalDepth = 0) =>
  ({ rowFields: ["Region", "Rep"], colFields: ["Q"], values: ["Amt"], funcs: ["sum"], rowTotalDepth, colTotalDepth }) as never;
const text = (_f: number, c: FrameCell) => (c == null ? "" : String(c));
const view = (o: Partial<PivotViewOptions> = {}): PivotViewOptions => ({ ...DEFAULT_PIVOT_VIEW, ...o });
const labelsOf = (rows: PivotBodyRow[]) => rows.map((r) => `${r.kind}:${r.labels.map((l) => l?.text ?? "").join("|")}`);

describe("the pivot layout rides beside the frame", () => {
  it("records one item per output row and per value column, and leaves the frame a plain Frame", () => {
    const f = pivotFrame(sales, spec(2, 1));
    const l = pivotLayoutOf(f)!;
    expect(l.rows.length).toBe(frameRowCount(f));
    expect(l.rowFields.length + l.cols.length).toBe(f.columns.length);
    expect(l.rows.map((r) => r.kind)).toEqual(["leaf", "leaf", "sub", "leaf", "leaf", "sub", "grand"]);
    expect(Object.keys(f)).toEqual(["__frame", "columns"]);
  });

  it("follows a format stamp's copy, and no other frame", () => {
    const f = pivotFrame(sales, spec(1));
    const stamped = { ...f, columns: f.columns.map((c) => ({ ...c })) };
    expect(pivotLayoutOf(stamped)).toBeNull();
    carryFrameSidecars(f, stamped);
    expect(pivotLayoutOf(stamped)).toBe(pivotLayoutOf(f));
    const filtered = { ...f, columns: f.columns.map((c) => ({ ...c, values: c.values.slice(1) })) };
    carryFrameSidecars(f, filtered);
    expect(pivotLayoutOf(filtered)).toBeNull();
  });
});

describe("the Pivot view's model", () => {
  const f = pivotFrame(sales, spec(2));
  const l = pivotLayoutOf(f)!;

  it("Compact puts every label in one column under its group's own row", () => {
    const m = buildPivotModel(l, view(), text, text);
    expect(m.labelCols).toBe(1);
    expect(labelsOf(m.body)).toEqual(["header:N", "leaf:Ann", "leaf:Bo", "sub:N Total", "header:S", "leaf:Cy", "leaf:Di", "sub:S Total", "grand:Grand Total"]);
    expect(m.body.filter((r) => r.kind === "leaf").map((r) => r.level)).toEqual([1, 1, 1, 1]);
  });

  it("Outline gives each field a column and its group a row; Repeat Item Labels fills the outer labels", () => {
    expect(labelsOf(buildPivotModel(l, view({ form: "outline" }), text, text).body).slice(0, 4))
      .toEqual(["header:N|", "leaf:|Ann", "leaf:|Bo", "sub:N Total|"]);
    expect(labelsOf(buildPivotModel(l, view({ form: "outline", repeatLabels: true }), text, text).body).slice(0, 3))
      .toEqual(["header:N|", "leaf:N|Ann", "leaf:N|Bo"]);
  });

  it("Tabular starts a group on its first leaf row", () => {
    expect(labelsOf(buildPivotModel(l, view({ form: "tabular" }), text, text).body))
      .toEqual(["leaf:N|Ann", "leaf:|Bo", "sub:N Total|", "leaf:S|Cy", "leaf:|Di", "sub:S Total|", "grand:Grand Total|"]);
  });

  it("Blank Rows separate the outer groups", () => {
    expect(labelsOf(buildPivotModel(l, view({ blankRows: true }), text, text).body).filter((r) => r.startsWith("blank")).length).toBe(2);
  });

  it("a folded group shows its subtotal on its own row and hides the rest", () => {
    const m = buildPivotModel(l, view({ collapsed: [groupKey(["N"])] }), text, text);
    expect(labelsOf(m.body)).toEqual(["header:N", "header:S", "leaf:Cy", "leaf:Di", "sub:S Total", "grand:Grand Total"]);
    expect(m.body[0].src).toBe(2);
    expect(m.body[0].folds?.[0]).toMatchObject({ collapsed: true });
  });

  it("folds only where a subtotal exists", () => {
    const g = pivotFrame(sales, spec(1));
    expect(buildPivotModel(pivotLayoutOf(g)!, view(), text, text).foldable).toBe(false);
  });

  it("subtotals at the top sit on the group's own row in Compact", () => {
    const top = pivotFrame(sales, spec(-2));
    const m = buildPivotModel(pivotLayoutOf(top)!, view(), text, text);
    expect(labelsOf(m.body)).toEqual(["grand:Grand Total", "header:N", "leaf:Ann", "leaf:Bo", "header:S", "leaf:Cy", "leaf:Di"]);
    expect(m.body[1].src).toBe(1);
  });

  it("column headers merge a total down its rows and caption the value", () => {
    const g = pivotFrame(sales, spec(0, 1));
    const m = buildPivotModel(pivotLayoutOf(g)!, view(), text, text);
    expect(m.head.map((r) => r.map((c) => `${c.role}:${c.text}`))).toEqual([
      ["corner:Sum of Amt", "caption:Q"],
      ["field:Region / Rep", "item:Q1", "item:Q2", "total:Grand Total"],
    ]);
  });
});

describe("the view's options save", () => {
  it("only what differs from the defaults, and reads anything else back as the default", () => {
    expect(savedPivotView(DEFAULT_PIVOT_VIEW)).toBeUndefined();
    expect(savedPivotView(view({ form: "tabular", collapsed: ["x"] }))).toEqual({ form: "tabular", collapsed: ["x"] });
    expect(readPivotView({ form: "nope", blankRows: 1 })).toEqual(DEFAULT_PIVOT_VIEW);
  });

  it("round-trip through the Pivot node's init", () => {
    const n = new PivotNode({ pivotView: { form: "outline", bandedRows: true } });
    const init = extractInit(n);
    expect(init.pivotView).toEqual({ form: "outline", bandedRows: true });
    expect(new PivotNode(init as never).pivotView).toEqual(view({ form: "outline", bandedRows: true }));
    expect(extractInit(new PivotNode()).pivotView).toBeUndefined();
  });
});

describe("the ribbon's totals map onto PIVOTBY's depths", () => {
  it("reads and writes Excel's subtotal and grand total choices", () => {
    expect(totalsModes({ rowTotalDepth: 2, colTotalDepth: 1 })).toEqual({ sub: "bottom", grand: "both" });
    expect(totalsModes({ rowTotalDepth: 0, colTotalDepth: 1 })).toEqual({ sub: "none", grand: "rows" });
    expect(withSubtotals({ rowTotalDepth: 0, colTotalDepth: 0 }, "top", 2, 1)).toEqual({ rowTotalDepth: -2, colTotalDepth: 0 });
    expect(withSubtotals({ rowTotalDepth: 2, colTotalDepth: 1 }, "none", 2, 1)).toEqual({ rowTotalDepth: 1, colTotalDepth: 1 });
    expect(withSubtotals({ rowTotalDepth: 1, colTotalDepth: 1 }, "bottom", 3, 2)).toEqual({ rowTotalDepth: 3, colTotalDepth: 2 });
    expect(withGrand({ rowTotalDepth: 2, colTotalDepth: 0 }, "rows")).toEqual({ rowTotalDepth: 0, colTotalDepth: 1 });
    expect(withGrand({ rowTotalDepth: -2, colTotalDepth: 0 }, "both")).toEqual({ rowTotalDepth: -2, colTotalDepth: -1 });
  });
});

describe("the header filter in the Pivot view", () => {
  it("keeps a whole group by its name, and a leaf with the rows above it", () => {
    const l = pivotLayoutOf(pivotFrame(sales, spec(2)))!;
    const body = buildPivotModel(l, view({ blankRows: true }), text, text).body;
    expect(labelsOf(filterPivotBody(body, "s"))).toEqual(["header:S", "leaf:Cy", "leaf:Di", "sub:S Total", "grand:Grand Total"]);
    expect(labelsOf(filterPivotBody(body, "bo"))).toEqual(["header:N", "leaf:Bo", "grand:Grand Total"]);
  });
});

describe("Blank Rows with three row fields", () => {
  const three: FrameValue = {
    __frame: true,
    columns: [
      { name: "Cat", type: "string", values: ["A", "A", "A", "B"] },
      { name: "Region", type: "string", values: ["N", "N", "S", "N"] },
      { name: "Rep", type: "string", values: ["x", "y", "z", "w"] },
      { name: "Amt", type: "number", values: [1, 2, 3, 4] },
    ],
  };
  it("end every outer item, and a subtotal at the top stays with its group", () => {
    for (const [depth, blanks] of [[3, 3], [-3, 2]]) {
      const l = pivotLayoutOf(pivotFrame(three, { rowFields: ["Cat", "Region", "Rep"], colFields: [], values: ["Amt"], funcs: ["sum"], rowTotalDepth: depth } as never))!;
      const rows = labelsOf(buildPivotModel(l, view({ form: "tabular", blankRows: true }), text, text).body);
      expect(rows.filter((r) => r.startsWith("blank")).length).toBe(blanks);
      expect(rows[0].startsWith("blank")).toBe(false);
      rows.forEach((r, i) => { if (r.startsWith("blank")) expect(rows[i + 1]?.startsWith("blank")).not.toBe(true); });
    }
  });
});

describe("pivots with an empty axis", () => {
  it("with no row fields draws one value row and no label column", () => {
    const l = pivotLayoutOf(pivotFrame(sales, { rowFields: [], colFields: ["Q"], values: ["Amt"], funcs: ["sum"] } as never))!;
    const m = buildPivotModel(l, view(), text, text);
    expect(m.labelCols).toBe(0);
    expect(m.body.map((r) => r.kind)).toEqual(["leaf"]);
    expect(m.head.flat().some((c) => c.role === "corner")).toBe(false);
  });

  it("with no column fields heads each value column with its caption", () => {
    const l = pivotLayoutOf(pivotFrame(sales, { rowFields: ["Region"], colFields: [], values: ["Amt", "Rep"], funcs: ["sum", "count"] } as never))!;
    const m = buildPivotModel(l, view(), text, text);
    expect(m.head.map((r) => r.map((c) => c.text))).toEqual([["Region", "Sum of Amt", "Count of Rep"]]);
    expect(labelsOf(m.body)).toEqual(["leaf:N", "leaf:S"]);
  });
});

describe("saved folds", () => {
  it("drop the groups a field change took away", () => {
    const l = pivotLayoutOf(pivotFrame(sales, spec(2)))!;
    expect(livePivotFolds(l, [groupKey(["N"]), groupKey(["Gone"])])).toEqual([groupKey(["N"])]);
  });
});

describe("Details ([[C128]] pivotDetails)", () => {
  const withDetails = { ...(spec(2) as object), details: ["Rep", "Amt"] } as never;

  it("records each leaf's source rows and leaves the output as it was", () => {
    const f = pivotFrame(sales, withDetails);
    expect(f).toEqual(pivotFrame(sales, spec(2)));
    const l = pivotLayoutOf(f)!;
    expect(l.details?.map((d) => d.name)).toEqual(["Rep", "Amt"]);
    expect(l.rows.filter((r) => r.kind === "leaf").map((r) => r.sources)).toEqual([[0, 4], [1], [2, 3], [5]]);
    expect(l.rows.filter((r) => r.kind !== "leaf").every((r) => r.sources === undefined)).toBe(true);
    expect(pivotLayoutOf(pivotFrame(sales, spec(2)))!.rows.some((r) => r.sources)).toBe(false);
  });

  it("gives every leaf a fold that opens a detail row under it", () => {
    const l = pivotLayoutOf(pivotFrame(sales, withDetails))!;
    const closed = buildPivotModel(l, view(), text, text);
    expect(closed.foldable).toBe(true);
    expect(closed.body.filter((r) => r.kind === "leaf").every((r) => r.folds?.some((x) => x.detail && x.collapsed))).toBe(true);
    const open = buildPivotModel(l, view({ form: "tabular" }), text, text, new Set([groupKey(["N", "Ann"])]));
    const at = open.body.findIndex((r) => r.kind === "detail");
    expect(labelsOf(open.body).slice(at - 1, at + 2)).toEqual(["leaf:N|Ann", "detail:|", "leaf:|Bo"]);
    expect(open.body[at].detail).toBe(open.body[at - 1].src);
    expect(open.body[at - 1].folds?.find((x) => x.detail)).toMatchObject({ collapsed: false, col: 1 });
    expect(labelsOf(filterPivotBody(open.body, "ann"))).toEqual(["leaf:N|Ann", "detail:|", "grand:Grand Total|"]);
  });

  it("has nothing to open without row fields", () => {
    const f = pivotFrame(sales, { rowFields: [], colFields: ["Q"], values: ["Amt"], funcs: ["sum"], details: ["Rep"] } as never);
    expect(pivotLayoutOf(f)!.details).toBeUndefined();
    expect(buildPivotModel(pivotLayoutOf(f)!, view(), text, text).foldable).toBe(false);
  });

  it("drops open groups a field change took away", () => {
    const l = pivotLayoutOf(pivotFrame(sales, withDetails))!;
    expect([...liveDetailKeys(l, new Set([groupKey(["N", "Ann"]), groupKey(["Gone", "x"])]))]).toEqual([groupKey(["N", "Ann"])]);
  });

  it("shows a cell as the Grid does by default", () => {
    expect(detailCellText({ name: "d", type: "date", values: [] }, 45000)).toBe("15-Mar-2023");
    expect(detailCellText({ name: "b", type: "logical", values: [] }, true)).toBe("TRUE");
    expect(detailCellText({ name: "s", type: "string", values: [] }, null)).toBe("");
  });

  it("saves with the node and prunes a column the source lost", () => {
    const n = new PivotNode({ detailFields: ["Rep"] });
    expect(extractInit(n).detailFields).toEqual(["Rep"]);
    expect(extractInit(new PivotNode()).detailFields).toBeUndefined();
    n.stringLiterals = { rowFields: "Region", colFields: "", values: "Amt" };
    n.detailFields = ["Rep", "Gone"];
    n.data({ frame: [sales], rowFields: [["Region"]], colFields: [[]], values: [["Amt"]] } as never);
    expect(n.detailFields).toEqual(["Rep"]);
    expect(pivotLayoutOf(n.cachedResult as FrameValue)!.details?.map((d) => d.name)).toEqual(["Rep"]);
  });
});
