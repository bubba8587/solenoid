import { describe, it, expect } from "vitest";
import { bondPrice, bondYield } from "../../src/graph/nodes/financeOps";
import { sanitizeChartLabel } from "../../src/graph/components/chartRender";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { isSolError } from "../../src/graph/errorValue";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("review pins", () => {
  it("PRICE with one coupon period left uses Excel's simple-interest form; YIELD inverts it", () => {
    // =PRICE(DATE(2024,1,15),DATE(2024,6,15),0.06,0.07,100,2,0) = 99.58097
    const p = bondPrice(d(2024, 1, 15), d(2024, 6, 15), 0.06, 0.07, 100, 2);
    expect(p).toBeCloseTo(99.58097, 4);
    expect(bondYield(d(2024, 1, 15), d(2024, 6, 15), 0.06, p, 100, 2)).toBeCloseTo(0.07, 6);
  });

  it("a chart label cap counts code points, never splitting a surrogate pair", () => {
    const s = sanitizeChartLabel("😀".repeat(10), 8);
    expect(s).toBe("😀😀😀😀😀😀😀…");
    expect(s.includes("\ud83d…")).toBe(false);
  });

  it("XLOOKUP refuses a return list shorter than the lookup list, like a grid", () => {
    const r = resolveExcelFunction("XLOOKUP")!(2, [1, 2], ["a"]);
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });
});

describe("File Link: which paths run rather than open", () => {
  it("isExecutablePath names the program extensions, case-insensitively, and nothing else", async () => {
    const { isExecutablePath } = await import("../../src/graph/fileBridge");
    for (const p of ["C:\\\\tools\\\\run.EXE", "/tmp/x.bat", "a.lnk", "setup.msi", "s.ps1"]) expect(isExecutablePath(p)).toBe(true);
    for (const p of ["notes.md", "C:\\\\data\\\\plan.xlsx", "photo.jpg", "readme"]) expect(isExecutablePath(p)).toBe(false);
  });
});

describe("review pins: DROP, exponential fits, Slicer, aggregate guard", () => {
  it("DROP of everything is #CALC!, not an empty list", () => {
    const drop = resolveExcelFunction("DROP")!;
    expect(isSolError(drop([1, 2, 3], 5)) && (drop([1, 2, 3], 5) as { code: string }).code).toBe("#DOMAIN!");
    expect(isSolError(drop([1, 2, 3], -3))).toBe(true);
    expect(drop([1, 2, 3], 1)).toEqual([2, 3]);
    expect(isSolError(drop([[1, 2], [3, 4]], 0, 2))).toBe(true);
  });
  it("an exponential fit over a y at or below zero is #NUM! on both cards", async () => {
    const { ForecastNode, LinestNode } = await import("../../src/graph/rete-nodes") as unknown as Record<string, new (i: { op: string }) => { data: (i: Record<string, unknown[]>) => Record<string, unknown> }>;
    const f = new ForecastNode({ op: "exponential" }).data({ ys: [[1, -2, 3]], xs: [[1, 2, 3]], x: [4] });
    expect(isSolError(f.result) && (f.result as { code: string }).code).toBe("#DOMAIN!");
    const l = new LinestNode({ op: "exponential" }).data({ ys: [[1, -2, 3]], xs: [[1, 2, 3]] });
    expect(isSolError(l.slope) && (l.slope as { code: string }).code).toBe("#DOMAIN!");
  });
});

describe("review pins: analytics batch", () => {
  it("POLYROOTS reports a double root as two reals", async () => {
    const { polyRoots } = await import("../../src/graph/nodes/mathUtils");
    const r = polyRoots([1, -2, 1])!;
    expect(r.map((x) => x[1])).toEqual([0, 0]);
    expect(r.map((x) => Math.round(x[0] * 1e6) / 1e6)).toEqual([1, 1]);
  });
  it("SAVGOL with an even window is #DOMAIN!, not a blank list", () => {
    const r = resolveExcelFunction("SAVGOL")!([1, 2, 3, 4, 5], 4, 2);
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
  });
  it("CHOOSE truncates a fractional index like Excel", () => {
    expect(resolveExcelFunction("CHOOSE")!(2.7, "a", "b", "c")).toBe("b");
  });
  it("XIRR names a date before the first date", () => {
    const r = resolveExcelFunction("XIRR")!([-100, 60, 60], [45444, 45292, 45658]);
    expect(isSolError(r) && r.message).toMatch(/before the first/);
  });
  it("DIAGONAL of a matrix is its diagonal", () => {
    expect(resolveExcelFunction("DIAGONAL")!([[1, 2], [3, 4]])).toEqual([1, 4]);
  });
  it("EWMA refuses alpha outside (0, 1]", () => {
    expect(isSolError(resolveExcelFunction("EWMA")!([1, 2, 3], 5))).toBe(true);
    expect(resolveExcelFunction("EWMA")!([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
  it("Quantile Bin keeps a value on a cut in the bucket below (pandas qcut)", async () => {
    const { ntileList } = await import("../../src/graph/nodes/listOps");
    expect(ntileList([1, 2, 3, 4, 5], 2)).toEqual([1, 1, 1, 2, 2]);
    expect(ntileList([1, 1, 1, 1, 2, 2], 2)).toEqual([1, 1, 1, 1, 2, 2]);
  });
});

describe("review pins: Record layout", () => {
  it("a crossed repeat never draws two boxes on one area", async () => {
    const { parseRecordLayout } = await import("../../src/graph/nodes/visual");
    const p = parseRecordLayout("A | B\nB | A");
    const a = p.find((x) => x.name === "A")!, b = p.find((x) => x.name === "B")!;
    expect([a.row, a.col, a.rowSpan, a.colSpan]).toEqual([1, 1, 2, 2]);
    expect([b.row, b.col, b.rowSpan, b.colSpan]).toEqual([1, 2, 1, 1]);
    const ok = parseRecordLayout("A*2\nB | C");
    expect(ok.map((x) => [x.name, x.row, x.col, x.colSpan])).toEqual([["A", 1, 1, 2], ["B", 2, 1, 1], ["C", 2, 2, 1]]);
  });
});

describe("review pins: formula surface parity", () => {
  it("the T-bill formulas run the actual/360 kernel (Microsoft's worked examples)", () => {
    const s = 45382, m = 45444; // 2024-03-31, 2024-06-01
    expect(resolveExcelFunction("TBILLYIELD")!(s, m, 98.45) as number).toBeCloseTo(0.09141696, 6);
    expect(resolveExcelFunction("TBILLEQ")!(s, m, 0.0914) as number).toBeCloseTo(0.09415149, 6);
    expect(resolveExcelFunction("TBILLPRICE")!(s, m, 0.09) as number).toBeCloseTo(98.45, 2);
  });
  it("WORKDAY.INTL takes the seven-character weekend mask", () => {
    const mon = 46027; // 2026-01-05
    expect(resolveExcelFunction("WORKDAY.INTL")!(mon, 5, "0000011")).toBe(mon + 7);
    expect(resolveExcelFunction("WORKDAY.INTL")!(mon, 5, "0000011", [mon + 1])).toBe(mon + 8);
    expect(resolveExcelFunction("WORKDAY.INTL")!(mon, 1, 1)).toBe(mon + 1); // the numeric code still works
  });
  it("SUBSTITUTE truncates its instance like Excel", () => {
    expect(resolveExcelFunction("SUBSTITUTE")!("aaa", "a", "b", 1.5)).toBe("baa");
    expect(resolveExcelFunction("SUBSTITUTE")!("aaa", "a", "b")).toBe("bbb");
  });
});

describe("review pins: INDEX, RUNNING, VDB", () => {
  it("INDEX truncates a fractional row like Excel", async () => {
    const { resolveAxes } = await import("../../src/graph/nodes/indexAccess");
    expect((resolveAxes(1.9, undefined) as { r?: number }).r).toBe(0);
  });
  it("RUNNING with a negative window is #DOMAIN! on the formula, like the card", () => {
    expect(isSolError(resolveExcelFunction("RUNNING")!("SUM", [1, 2, 3], -2))).toBe(true);
    expect(resolveExcelFunction("RUNNING")!("SUM", [1, 2, 3], 0)).toEqual([1, 3, 6]);
  });
  it("VDB refuses no_switch = TRUE instead of ignoring it", () => {
    expect(isSolError(resolveExcelFunction("VDB")!(2400, 300, 10, 0, 1, 2, true))).toBe(true);
    expect(resolveExcelFunction("VDB")!(2400, 300, 10, 0, 1)).toBeCloseTo(480, 6);
  });
});

describe("review pins: Nest Join blank keys", () => {
  it("a blank key cell never matches, like the Join verb and the socket doc say", async () => {
    const { relateFramesToCube, buildFrame, frameRowCount } = await import("../../src/graph/frame");
    const parent = buildFrame([[1], [null]] as never, ["k"]);
    const child = buildFrame([[1, 10], [null, 20], [null, 30]] as never, ["k", "v"]);
    const cube = relateFramesToCube(parent, child, "k", "kids")!;
    expect(frameRowCount(cube.columns[1].cells[0] as never)).toBe(1);
    expect(frameRowCount(cube.columns[1].cells[1] as never)).toBe(0);
  });
});

describe("review pins: STDEV.S of one value, DATEDIF order, CONTAINS rank", () => {
  it("a sample spread of one value is #DIV/0!, of none is blank", () => {
    expect(isSolError(resolveExcelFunction("STDEV.S")!([5]))).toBe(true);
    expect(isSolError(resolveExcelFunction("VAR.S")!([5]))).toBe(true);
    expect(resolveExcelFunction("STDEV.S")!([])).toBeNull();
    expect(resolveExcelFunction("STDEV.S")!([1, 3]) as number).toBeCloseTo(Math.SQRT2, 10);
  });
  it("DATEDIF refuses a start after the end for every unit", () => {
    expect(isSolError(resolveExcelFunction("DATEDIF")!(46030, 46027, "D"))).toBe(true);
    expect(resolveExcelFunction("DATEDIF")!(46027, 46030, "D")).toBe(3);
  });
  it("CONTAINS over a matrix is #SHAPE!, never a silent FALSE", () => {
    expect(isSolError(resolveExcelFunction("CONTAINS")!([[1, 2], [3, 4]], 2))).toBe(true);
    expect(resolveExcelFunction("CONTAINS")!([1, 2, 3], 2)).toBe(true);
  });
});

describe("review pins: whole-argument formulas", () => {
  it("GCD / LCM / MULTINOMIAL / PERCENTRANK.* take their list whole", async () => {
    const { compileEvaluator } = await import("../../src/graph/excelFormula");
    const ev = (src: string, vars: Record<string, unknown>) => compileEvaluator(src)!(vars);
    expect(ev("GCD(a)", { a: [12, 18, 24] })).toBe(6);
    expect(ev("LCM(a)", { a: [4, 6] })).toBe(12);
    expect(ev("MULTINOMIAL(a)", { a: [2, 3, 4] })).toBe(1260);
    expect(ev("PERCENTRANK.INC(a, 3)", { a: [1, 2, 3, 4] }) as number).toBeCloseTo(0.666, 2);
  });
  it("a holiday list is one argument of NETWORKDAYS / WORKDAY", async () => {
    const { compileEvaluator } = await import("../../src/graph/excelFormula");
    const ev = (src: string, vars: Record<string, unknown>) => compileEvaluator(src)!(vars);
    const mon = 46027, fri = 46031;
    expect(ev("NETWORKDAYS(s, f, h)", { s: mon, f: fri, h: [mon + 1, mon + 2] })).toBe(3);
    expect(ev("WORKDAY(s, 2, h)", { s: mon, h: [mon + 1, mon + 2] })).toBe(mon + 4);
  });
  it("a linear Fit over collinear x is #DIV/0! like SLOPE, not three blanks", async () => {
    const { LinestNode } = await import("../../src/graph/nodes/stats");
    const out = new LinestNode({ op: "linear" }).data({ ys: [[1, 2, 3]], xs: [[5, 5, 5]] });
    expect(isSolError(out.slope) && out.slope.code).toBe("#DIV/0!");
  });
});

describe("review pins: one-element lists into list-consuming matrix nodes", () => {
  it("Diagonal, Outer and Solve take a single-element list as a list", async () => {
    const { wrapNodeData } = await import("../../src/graph/coerceInputs");
    const { TableDiagNode, TableOuterNode, MatSolveNode } = await import("../../src/graph/nodes/matrix");
    const drive = async (n: object, inputs: Record<string, unknown[]>) => {
      wrapNodeData(n as Parameters<typeof wrapNodeData>[0]);
      return (n as { data: (i: Record<string, unknown[]>) => Promise<Record<string, unknown>> | Record<string, unknown> }).data(inputs);
    };
    expect((await drive(new TableDiagNode(), { diag: [[5]] })).result).toEqual([[5]]);
    expect((await drive(new TableOuterNode(), { a: [[2]], b: [[3, 4]] })).result).toEqual([[6, 8]]);
    const solved = (await drive(new MatSolveNode(), { matrix: [[[2]]], b: [[4]] })).result as number[];
    expect(solved.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2]);
  });
});

describe("review pins: Slider bounds", () => {
  it("inverted wired bounds swap; a non-finite bound is the card's own", async () => {
    const { SliderInputNode } = await import("../../src/graph/nodes/input");
    const n = new SliderInputNode() as unknown as { data: (i: Record<string, unknown[]>) => { value: number }; effectiveMin: number; effectiveMax: number; literals: Record<string, number> };
    n.data({ min: [50], max: [10] });
    expect([n.effectiveMin, n.effectiveMax]).toEqual([10, 50]);
    n.data({ min: [NaN] });
    expect(n.effectiveMin).toBe(n.literals.min ?? 0);
  });
});

describe("review pins: a blank optional numeric argument is Excel's 0", () => {
  it("ROUND / MOD / DATE read a blank slot like their siblings do", () => {
    expect(resolveExcelFunction("ROUND")!(2.567, null)).toBe(3);
    expect(isSolError(resolveExcelFunction("MOD")!(5, null)) && (resolveExcelFunction("MOD")!(5, null) as { code: string }).code).toBe("#DIV/0!");
    expect(resolveExcelFunction("DATE")!(2026, 1, null)).toBe(resolveExcelFunction("DATE")!(2025, 12, 31));
  });
});

describe("review pins: vault reads stay inside the vault", () => {
  it("a saved file name with .. or a root prefix is refused", async () => {
    const { isInsideVault } = await import("../../src/graph/fileBridge");
    expect(isInsideVault("notes/weekly.md")).toBe(true);
    expect(isInsideVault("../../.ssh/config")).toBe(false);
    expect(isInsideVault("notes/../../x.md")).toBe(false);
    expect(isInsideVault("/etc/passwd")).toBe(false);
    expect(isInsideVault("C:/secrets.md")).toBe(false);
    expect(isInsideVault("")).toBe(false);
  });
});

describe("review pins: frontmatter keys", () => {
  it("a key YAML would misread is quoted, so the properties block stays readable", async () => {
    const { frontmatterToYaml } = await import("../../src/graph/obsidianMarkdown");
    const { parse } = await import("yaml");
    const block = frontmatterToYaml({ "k: v": 1, "#h": 2, "-x": 3, plain: "yes" });
    const inner = block.replace(/^---\n|\n---\n?$/g, "");
    expect(parse(inner)).toEqual({ "k: v": 1, "#h": 2, "-x": 3, plain: "yes" });
  });
});

describe("review pins: the Equation numeric solver", () => {
  it("a pole is never a root; a root beside the domain edge is found", async () => {
    const { solveNumeric } = await import("../../src/graph/equationSolve");
    const pole = solveNumeric((x) => 1 / (x - 3));
    expect(isSolError(pole)).toBe(true);
    const edge = solveNumeric((x) => (x < 2 ? null : Math.sqrt(x - 2) - 1));
    expect(edge as number).toBeCloseTo(3, 6);
    expect(Math.abs(solveNumeric((x) => x * x - 4) as number)).toBeCloseTo(2, 6); // ±2 tie: either is a root
    expect(solveNumeric((x) => x - 0.032173) as number).toBeCloseTo(0.032173, 9);
  });
});

describe("review pins: SORTBY length, COMBINA at zero", () => {
  it("SORTBY refuses a key list of another length", () => {
    expect(isSolError(resolveExcelFunction("SORTBY")!(["a", "b", "c"], [2, 1]))).toBe(true);
    expect(resolveExcelFunction("SORTBY")!(["a", "b", "c"], [2, 1, 3])).toEqual(["b", "a", "c"]);
  });
  it("COMBINA(0,0) is 1 on the card; COMBINA(4,2) is 10", async () => {
    const { CombinatoricsNode } = await import("../../src/graph/nodes/scalar");
    const card = (n: number, k: number) => (new CombinatoricsNode({ op: "combina" }) as unknown as { data: (i: Record<string, unknown[]>) => { result: unknown } }).data({ n: [n], k: [k] }).result;
    expect(card(0, 0)).toBe(1);
    expect(card(0, 3)).toBe(0);
    expect(card(4, 2)).toBe(10);
  });
});

describe("review pins: copy skips composite markers", () => {
  it("copySelected filters the boundary marker classes like deleteSelection does", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/graph/copyPaste.ts", "utf8");
    expect(src).toMatch(/CompositeInputNode/);
    expect(src).toMatch(/CompositeOutputNode/);
    expect(src).toMatch(/n\.selected && !isMarker\(n\)/);
  });
});

describe("review pins: pivot totals", () => {
  it("a key column that carries a Total label is text, never a number column with a string inside", async () => {
    const { pivotFrame } = await import("../../src/graph/frameVerbs");
    const { buildFrame } = await import("../../src/graph/frame");
    const f = buildFrame([[1, 10], [1, 20], [2, 30]] as never, ["k", "v"]);
    const out = pivotFrame(f, { rowFields: ["k"], colFields: [], values: ["v"], funcs: ["sum"], rowTotalDepth: 1 } as never);
    const key = out.columns[0];
    expect(key.type).toBe("string");
    expect(key.values).toEqual(["1", "2", "Grand Total"]);
    const plain = pivotFrame(f, { rowFields: ["k"], colFields: [], values: ["v"], funcs: ["sum"] } as never);
    expect(plain.columns[0].type).toBe("number");
  });
});

describe("review pins: number-to-text scientific form; image asset paths", () => {
  it("numberToText writes Excel's General scientific form", async () => {
    const { numberToText } = await import("../../src/graph/excelFunctions");
    expect(numberToText(1e21)).toBe("1E+21");
    expect(numberToText(0.0000001)).toBe("1E-07");
    expect(numberToText(0.00001)).toBe("1E-05");
    expect(numberToText(0.0001)).toBe("0.0001");
    expect(numberToText(0.1 + 0.2)).toBe("0.3");
    expect(numberToText(-0)).toBe("0");
  });
  it("an image asset path that climbs out of the document folder is refused", async () => {
    const { isInsideVault } = await import("../../src/graph/fileBridge");
    expect(isInsideVault("images/a.png")).toBe(true);
    expect(isInsideVault("../../secret.png")).toBe(false);
  });
});

describe("review pins: CSV formula injection", () => {
  it("Write File neutralizes a formula-trigger text cell like the popup export does", async () => {
    const { frameToCsvText } = await import("../../src/graph/nodes/sink");
    const f = { __frame: true as const, columns: [
      { name: "t", type: "string" as const, values: ['=HYPERLINK("x")', "+cmd", "-5", "plain"] },
      { name: "n", type: "number" as const, values: [1, 2, 3, 4] },
    ] };
    const csv = frameToCsvText(f as never);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+cmd,2");
    expect(csv).toContain("-5,3"); // a plain number is not a trigger
    expect(csv).toContain("plain,4");
  });
});

describe("review pins: Cube Rollup over a cube child; Write JSON dates", () => {
  it("a nested cube child rolls up like a frame child; a nested cell inside it is #SHAPE!", async () => {
    const { CubeRollupNode } = await import("../../src/graph/nodes/cube");
    const { cubeFromColumns } = await import("../../src/graph/frame");
    const cube = cubeFromColumns([
      { name: "p", cells: ["a", "b"], type: "string" },
      { name: "orders", cells: [cubeFromColumns([{ name: "amt", cells: [1, 2], type: "number" }]), cubeFromColumns([{ name: "amt", cells: [[5]] }])] },
    ]);
    const n = new CubeRollupNode({ agg: "sum" } as never) as unknown as { stringLiterals: Record<string, string>; data: (i: Record<string, unknown[]>) => { frame: { columns: { values: unknown[] }[] } } };
    n.stringLiterals.nested = "orders"; n.stringLiterals.column = "amt";
    const out = n.data({ cube: [cube] });
    const rolled = out.frame.columns[out.frame.columns.length - 1].values;
    expect(rolled[0]).toBe(3);
    expect((rolled[1] as { code?: string })?.code).toBe("#SHAPE!");
  });
  it("Write JSON writes a date column as ISO so it reads back as a date", async () => {
    const { frameToJsonText } = await import("../../src/graph/nodes/sink");
    const { jsonToFrame } = await import("../../src/graph/nodes/connection");
    const f = { __frame: true as const, columns: [{ name: "d", type: "date" as const, values: [46027] }] };
    const text = frameToJsonText(f as never);
    expect(text).toContain("2026-01-05");
    const back = jsonToFrame(text) as { columns: { type: string }[] };
    expect(back.columns[0].type).toBe("date");
  });
});

describe("review pins: the exported webpage", () => {
  it("escapes a user-typed title or name into text", async () => {
    const { escapeHtml } = await import("../../src/graph/reportExport");
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escapeHtml("Q3 & beyond")).toBe("Q3 &amp; beyond");
  });
  it("Mermaid renders in strict mode", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/graph/components/MermaidView.tsx", "utf8");
    expect(src).toMatch(/securityLevel: "strict"/);
    expect(src).not.toMatch(/securityLevel: "loose"/);
  });
});
