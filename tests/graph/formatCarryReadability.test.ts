// formatFlowsDownstream readability table: a styled source wired into a real transform,
// the output formatted exactly as a Display would. `want` is what a reader should see —
// "auto" = no carried style (a value of a new kind); a string = the style survives.
//
// The rule (author 2026-09-13, formatCarryPerOp): a transform carries a style ONLY
// where it declares a meaning-preserving op (formatCarry). add/sub keep it, mul/div/pow
// do not; a mean/min/max/stdev keeps it, a count/variance/product does not; a rounded or
// abs'd value keeps it; a rate/ratio/finance output never does; date − date is a span.
//
// The table doubles as the author's eyeball list: an afterAll writes every row as
// "inputs → op → shows" to .dev/format-carry-report.txt.
import { describe, it, afterAll, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { NodeEditor, ClassicPreset } from "rete";
import { makeAnnotationResolver } from "../../src/graph/unitFlow";
import { formatNumberWithAnnotation, type FormatAnnotation } from "../../src/graph/formatAnnotationStore";
import { ArithmeticNode, MathFXNode, RoundNNode, MRoundNode, ClampNode, TwoInputMathNode, SumProductNode } from "../../src/graph/nodes/scalar";
import { StandardizeNode, CorrelNode } from "../../src/graph/nodes/stats";
import { NPVNode, TvmNode, ReturnsNode } from "../../src/graph/nodes/finance";
import { AggregateNode, RunningNode, EwmaNode, ConvolveNode, BinNode, SortNode, ReverseNode } from "../../src/graph/nodes/list";
import { DateAddNode, WorkdaysNode, DateDiffNode } from "../../src/graph/nodes/date";
import { MatDetNode, TableTransposeNode } from "../../src/graph/nodes/matrix";
import { ExpressionNode } from "../../src/graph/nodes/expression";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
const sock = new (class extends ClassicPreset.Socket {})("any");
const base: FormatAnnotation = {
  format: "decimal", customPattern: "0.00", decimalDigits: 2, decimalMode: "places",
  unit: "none", customUnit: "", textCase: "none", bold: false, italic: false, textScale: 14,
};
const STYLES: Record<string, FormatAnnotation> = {
  pct: { ...base, format: "percent" },
  int: { ...base, format: "integer" },
  dec2: { ...base, format: "decimal", decimalDigits: 2 },
  date: { ...base, format: "date_dmy" },
  frac: { ...base, format: "fraction" },
  sci: { ...base, format: "scientific" },
  k: { ...base, format: "decimal", scaleMode: "k" },
};
function src(ann: FormatAnnotation) {
  const n = new ClassicPreset.Node("FC") as ClassicPreset.Node & Record<string, unknown>;
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  n.annotation = () => ann;
  return n;
}
function bare() {
  const n = new ClassicPreset.Node("Num");
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  return n;
}

type Row = {
  name: string;
  make: () => ClassicPreset.Node;
  /** input key → a STYLES key or "bare"; wired in this order (order matters today). */
  wire: Record<string, string>;
  out?: string;
  /** The number the node would compute for the named inputs. */
  value: number;
  want: "auto" | string;
};

const rows: Row[] = [
  // ── Arithmetic: only add / subtract keep the kind of value ──
  { name: "5% + 3%", make: () => new ArithmeticNode({ op: "add" }), wire: { a: "pct", b: "pct" }, value: 0.08, want: "8.00%" },
  { name: "5% + 0.02 (bare)", make: () => new ArithmeticNode({ op: "add" }), wire: { a: "pct", b: "bare" }, value: 0.07, want: "7.00%" },
  { name: "date + 30 days", make: () => new ArithmeticNode({ op: "add" }), wire: { a: "date", b: "bare" }, value: 46000, want: "09-Dec-2025" },
  { name: "date − date is a span, not a date", make: () => new ArithmeticNode({ op: "sub" }), wire: { a: "date", b: "date" }, value: 30, want: "auto" },
  { name: "5% × 100", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "pct", b: "bare" }, value: 5, want: "auto" },
  { name: "100 × 5% (percent wired second)", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "bare", b: "pct" }, value: 5, want: "auto" },
  { name: "1000.00 × 5%", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "dec2", b: "pct" }, value: 50, want: "auto" },
  { name: "5% × 5%", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "pct", b: "pct" }, value: 0.0025, want: "auto" },
  { name: "50 ÷ 5%", make: () => new ArithmeticNode({ op: "div" }), wire: { a: "bare", b: "pct" }, value: 1000, want: "auto" },
  { name: "5% ÷ 2", make: () => new ArithmeticNode({ op: "div" }), wire: { a: "pct", b: "bare" }, value: 0.025, want: "auto" },
  { name: "(1 + 5%) ^ 10", make: () => new ArithmeticNode({ op: "pow" }), wire: { a: "pct", b: "bare" }, value: 1.6289, want: "auto" },
  { name: "integer 7 ÷ 2 must not round to 4", make: () => new ArithmeticNode({ op: "div" }), wire: { a: "int", b: "bare" }, value: 3.5, want: "auto" },
  { name: "integer 7 × 1.5 must not round to 11", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "int", b: "bare" }, value: 10.5, want: "auto" },
  { name: "date × 2", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "date", b: "bare" }, value: 91940, want: "auto" },
  { name: "fraction 1/3 × 1.7", make: () => new ArithmeticNode({ op: "mul" }), wire: { a: "frac", b: "bare" }, value: 0.5667, want: "auto" },
  { name: "scientific 1.2e6 ÷ 1e6", make: () => new ArithmeticNode({ op: "div" }), wire: { a: "sci", b: "bare" }, value: 1.2, want: "auto" },
  { name: "45,000 shown in thousands ÷ 12", make: () => new ArithmeticNode({ op: "div" }), wire: { a: "k", b: "bare" }, value: 3750, want: "auto" },
  { name: "MOD(7%, 2%)", make: () => new ArithmeticNode({ op: "mod" }), wire: { a: "pct", b: "pct" }, value: 0.01, want: "auto" },
  { name: "5% − 2% is still a percent", make: () => new ArithmeticNode({ op: "sub" }), wire: { a: "pct", b: "pct" }, value: 0.03, want: "3.00%" },
  // ── Math functions: abs / round-family keep it; the rest make a new value ──
  { name: "abs(−5%) keeps the percent", make: () => new MathFXNode({ op: "abs" }), wire: { in: "pct" }, value: 0.05, want: "5.00%" },
  { name: "int(5.7%) keeps the percent", make: () => new MathFXNode({ op: "int" }), wire: { in: "pct" }, value: 0.05, want: "5.00%" },
  { name: "trunc(5.7%) keeps the percent", make: () => new MathFXNode({ op: "trunc" }), wire: { in: "pct" }, value: 0.05, want: "5.00%" },
  { name: "sqrt(16%)", make: () => new MathFXNode({ op: "sqrt" }), wire: { in: "pct" }, value: 0.4, want: "auto" },
  { name: "exp(5%)", make: () => new MathFXNode({ op: "exp" }), wire: { in: "pct" }, value: 1.0513, want: "auto" },
  { name: "ln(105%)", make: () => new MathFXNode({ op: "log" }), wire: { in: "pct" }, value: 0.0488, want: "auto" },
  { name: "sin(30%)", make: () => new MathFXNode({ op: "sin" }), wire: { in: "pct" }, value: 0.2955, want: "auto" },
  { name: "sqrt(integer 10)", make: () => new MathFXNode({ op: "sqrt" }), wire: { in: "int" }, value: 3.1623, want: "auto" },
  { name: "round(5.678%, 2)", make: () => new RoundNNode({ op: "round" }), wire: { value: "pct", digits: "bare" }, value: 0.06, want: "6.00%" },
  { name: "roundup(5.6%, 2)", make: () => new RoundNNode({ op: "roundup" }), wire: { value: "pct", digits: "bare" }, value: 0.06, want: "6.00%" },
  { name: "rounddown(5.6%, 2)", make: () => new RoundNNode({ op: "rounddown" }), wire: { value: "pct", digits: "bare" }, value: 0.05, want: "5.00%" },
  { name: "MROUND(5.6%, 1%)", make: () => new MRoundNode({ op: "nearest" }), wire: { value: "pct", multiple: "bare" }, value: 0.06, want: "6.00%" },
  { name: "CEILING(5.1%, 1%)", make: () => new MRoundNode({ op: "up" }), wire: { value: "pct", multiple: "bare" }, value: 0.06, want: "6.00%" },
  { name: "clamp(5%, 0, 1)", make: () => new ClampNode(), wire: { value: "pct", min: "bare", max: "bare" }, value: 0.05, want: "5.00%" },
  { name: "log(8, base 2) with a percent first", make: () => new TwoInputMathNode({ op: "log" }), wire: { a: "pct", b: "bare" }, value: 3, want: "auto" },
  { name: "hypot(3%, 4%)", make: () => new TwoInputMathNode({ op: "hypot" }), wire: { a: "pct", b: "pct" }, value: 0.05, want: "auto" },
  { name: "sumproduct(weights %, values)", make: () => new SumProductNode(), wire: { x: "pct", y: "bare" }, value: 123.4, want: "auto" },
  // ── Aggregates and statistics: mean / spread keep it, count / variance / product don't ──
  { name: "SUM of a percent list", make: () => new AggregateNode({ op: "sum" }), wire: { list: "pct" }, value: 1, want: "100.00%" },
  { name: "AVERAGE of a date list", make: () => new AggregateNode({ op: "avg" }), wire: { list: "date" }, value: 46000, want: "09-Dec-2025" },
  { name: "MIN of a percent list", make: () => new AggregateNode({ op: "min" }), wire: { list: "pct" }, value: 0.02, want: "2.00%" },
  { name: "MEDIAN of a percent list", make: () => new AggregateNode({ op: "median" }), wire: { list: "pct" }, value: 0.05, want: "5.00%" },
  { name: "STDEV of a percent list", make: () => new AggregateNode({ op: "stdev" }), wire: { list: "pct" }, value: 0.012, want: "1.20%" },
  { name: "VAR.S of a percent list is a percent²", make: () => new AggregateNode({ op: "var_s" }), wire: { list: "pct" }, value: 0.0001, want: "auto" },
  { name: "PRODUCT of a percent list", make: () => new AggregateNode({ op: "product" }), wire: { list: "pct" }, value: 0.0004, want: "auto" },
  { name: "COUNT of a percent list", make: () => new AggregateNode({ op: "count" }), wire: { list: "pct" }, value: 12, want: "auto" },
  { name: "COUNT of a date list", make: () => new AggregateNode({ op: "count" }), wire: { list: "date" }, value: 12, want: "auto" },
  { name: "SKEW of a percent list", make: () => new AggregateNode({ op: "skew" }), wire: { list: "pct" }, value: 0.4, want: "auto" },
  { name: "standardize(5%, mean, sd) is a z-score", make: () => new StandardizeNode(), wire: { value: "pct", mean: "bare", stdev: "bare" }, value: 1.3, want: "auto" },
  { name: "correl(returns %, returns %) is r", make: () => new CorrelNode(), wire: { x: "pct", y: "pct" }, value: 0.82, want: "auto" },
  // ── Running / windowed: a moving mean keeps it, a running product doesn't ──
  { name: "moving AVERAGE of a percent list", make: () => new RunningNode({ agg: "avg" }), wire: { list: "pct", window: "bare" }, value: 0.05, want: "5.00%" },
  { name: "running SUM of a percent list", make: () => new RunningNode({ agg: "sum" }), wire: { list: "pct", window: "bare" }, value: 0.15, want: "15.00%" },
  { name: "running PRODUCT of a percent list", make: () => new RunningNode({ agg: "product" }), wire: { list: "pct", window: "bare" }, value: 0.0004, want: "auto" },
  { name: "EWMA of a percent list", make: () => new EwmaNode(), wire: { list: "pct", alpha: "bare" }, value: 0.05, want: "5.00%" },
  { name: "convolve(percent, kernel)", make: () => new ConvolveNode(), wire: { a: "pct", b: "bare" }, value: 0.1, want: "auto" },
  { name: "bin a percent list into buckets", make: () => new BinNode({ mode: "quantiles" }), wire: { list: "pct", n: "bare" }, value: 3, want: "auto" },
  // ── List reorders are passthroughs: the element kind survives ──
  { name: "SORT a percent list", make: () => new SortNode(), wire: { list: "pct" }, value: 0.05, want: "5.00%" },
  { name: "REVERSE a percent list", make: () => new ReverseNode(), wire: { list: "pct" }, value: 0.05, want: "5.00%" },
  // ── Date nodes: shifting a date keeps a date, a difference is a count ──
  { name: "EOMONTH(date, +1) is still a date", make: () => new DateAddNode({ op: "eomonth" }), wire: { start: "date", months: "bare" }, value: 46000, want: "09-Dec-2025" },
  { name: "WORKDAY(date, +5) is still a date", make: () => new WorkdaysNode({ op: "workday" }), wire: { start: "date", days: "bare" }, value: 46000, want: "09-Dec-2025" },
  { name: "NETWORKDAYS(date, date) is a count", make: () => new WorkdaysNode({ op: "networkdays" }), wire: { start: "date", end: "date" }, value: 20, want: "auto" },
  { name: "DAYS between two dates is a count", make: () => new DateDiffNode({ op: "days" }), wire: { start: "date", end: "date" }, value: 30, want: "auto" },
  // ── Matrix: transpose is a passthrough, a determinant is a new value ──
  { name: "TRANSPOSE a percent matrix", make: () => new TableTransposeNode(), wire: { matrix: "pct" }, value: 0.05, want: "5.00%" },
  { name: "MDETERM of a percent matrix", make: () => new MatDetNode({ op: "mdeterm" }), wire: { matrix: "pct" }, value: 0.0025, want: "auto" },
  // ── Finance: the rate's style never describes the money ──
  { name: "NPV(rate 5%, flows)", make: () => new NPVNode({ op: "periods" }), wire: { rate: "pct", list: "bare" }, value: 1234.56, want: "auto" },
  { name: "TVM payment (rate 5% wired first)", make: () => new TvmNode(), wire: { rate: "pct", nper: "bare", pv: "bare" }, out: "pmt", value: -1295.05, want: "auto" },
  { name: "TVM payment (pv wired first, then rate 5%)", make: () => new TvmNode(), wire: { pv: "dec2", rate: "pct", nper: "bare" }, out: "pmt", value: -1295.05, want: "auto" },
  { name: "TVM rate from money inputs", make: () => new TvmNode(), wire: { pv: "dec2", pmt: "dec2", nper: "bare" }, out: "rate", value: 0.05, want: "auto" },
  { name: "Returns CAGR of 2-place prices", make: () => new ReturnsNode({ op: "cagr" }), wire: { list: "dec2", periods: "bare" }, value: 0.0712, want: "auto" },
  { name: "Returns Sharpe(returns %, rf 2%)", make: () => new ReturnsNode({ op: "sharpe" }), wire: { list: "pct", rf: "pct", periods: "bare" }, value: 1.4, want: "auto" },
  // ── Expression: wildcard inputs carry nothing ──
  { name: "Expression a*b with a = 5%", make: () => new ExpressionNode({ expr: "a*b" }), wire: { a: "pct", b: "bare" }, value: 5, want: "auto" },
  { name: "Expression a+b with a, b = percents", make: () => new ExpressionNode({ expr: "a+b" }), wire: { a: "pct", b: "pct" }, value: 0.08, want: "auto" },
];

async function shown(row: Row): Promise<string> {
  const editor = new NodeEditor() as unknown as AnyEditor;
  const n = row.make();
  await editor.addNode(n as never);
  for (const [k, s] of Object.entries(row.wire)) {
    if (!n.inputs[k]) throw new Error(`${row.name}: no input ${k}`);
    const s0 = s === "bare" ? bare() : src(STYLES[s]);
    await editor.addNode(s0 as never);
    await editor.addConnection(new ClassicPreset.Connection(s0 as never, "out", n as never, k) as never);
  }
  const ann = makeAnnotationResolver(editor).outAnnotation(n.id, row.out ?? "result");
  return ann ? formatNumberWithAnnotation(row.value, ann) : "auto";
}

describe("formatFlowsDownstream — what a reader sees after a transform", () => {
  for (const row of rows) {
    it(`${row.name} → ${row.want}`, async () => {
      expect(await shown(row)).toBe(row.want);
    });
  }

  // The author's eyeball list: every row as "inputs → op → shows", carries or not.
  afterAll(async () => {
    const lines: string[] = [
      "format carry — every numeric/date transform in the app (formatCarryPerOp).",
      "A styled source into a real node, formatted as a Display would. auto = plain.",
      "",
    ];
    for (const row of rows) {
      const got = await shown(row);
      const ins = Object.entries(row.wire).map(([k, s]) => `${k}=${s}`).join(", ");
      const carries = got === "auto" ? "drops" : "CARRIES";
      lines.push(`${carries.padEnd(7)}  ${row.name}   [${ins}]  →  shows ${got}`);
    }
    try {
      mkdirSync(".dev", { recursive: true });
      writeFileSync(".dev/format-carry-report.txt", lines.join("\n") + "\n");
    } catch { /* report is a convenience; a read-only FS must not fail the suite */ }
  });
});
