// Generator for the Personal Finance seed graph.
//
// Re-emits src/graph/seedGraphs/personal-finance.json from this script's node /
// connection / group definitions. The seed is large and heavily cross-wired, so
// it's authored in code (coordinates + auto-sized group rects) rather than by
// hand. Run with:  node scripts/gen-personal-finance-seed.cjs
// The data lives in public/data/personal-finance/*.csv (fetched same-origin by
// the Web Source nodes). After editing, `npx vitest run src/graph/seeds.test.ts`
// validates every node / socket / group against the real classes.
//
// Design notes:
//  - KPIs leave each source group through an in-group **Conduit**, so the
//    bundle renders as a single **Ribbon** across the gap into the Dashboard
//    group (conduits-inside-groups → ribbons-between-groups).
//  - Money/percent **Displays** carry a docked **Format Controller** so they
//    read as $1,234.56 / 46% instead of raw numbers. FCs are parked outside any
//    group box in the seed and snap onto their host socket on load (dock store);
//    keeping them non-members avoids the group-box "absorb a bystander" trap.
const fs = require("fs");
const path = require("path");

const RAW = "/data/personal-finance"; // same-origin static path (public/)

const nodes = [];
const conns = [];

function n(id, type, x, y, init = {}, extra = {}) {
  const node = { id, type, x, y, init };
  if (extra.literals) node.literals = extra.literals;
  if (extra.stringLiterals) node.stringLiterals = extra.stringLiterals;
  nodes.push(node);
  return id;
}
function c(source, sourceOutput, target, targetInput) {
  conns.push({ source, sourceOutput, target, targetInput });
}
function note(id, x, y, label, body, color, w = 340, h = 150) {
  n(id, "NoteNode", x, y, { label, body, color, width: w, height: h, collapsed: false });
}
// Format Controller docked to host.out. It joins the host's group as a MEMBER
// (parked at the host's own coords — snaps to the socket on load, never balloons
// the box) so a collapsed group still shows the formatted readout via the
// Display->FC hop, and the FC hides with the group.
//   kind "currency_usd" → number format `decimal` (2 places) + unit `usd` ($).
//   kind "percent"      → number format `percent`.
// IMPORTANT: currency is a UNIT in this app, not a format. The format dropdown
// only offers decimal/integer/fraction/percent/… — so the $ MUST come from the
// `usd` unit, never a "currency" format (which the dropdown can't display).
const FCS = [];
function fc(id, host, kind, members, label) {
  const h = nodes.find((nd) => nd.id === host);
  const money = kind !== "percent";
  n(id, "FormatControllerNode", h ? h.x : 0, h ? h.y : 0, {
    label: label ?? (money ? "$" : "%"),
    hostNodeId: host, socketKey: "out", side: "output",
    format: money ? "decimal" : "percent", customPattern: "0.00",
    decimalDigits: money ? 2 : 0, decimalMode: "places",
    unit: money ? "usd" : "none", customUnit: "", socketDataType: "number",
    textCase: "none", bold: false, italic: false, textScale: 14,
  });
  c(host, "out", id, "in");
  members.push(id);
  FCS.push(id);
}

// ─── Title ──────────────────────────────────────────────────────────────────
note("note-title", 180, -940,
  "Personal Finance dashboard",
  "# Your money, as a graph\nThree CSVs (transactions, accounts, budgets) flow in from the repo at left; everything to the right is **computed live**. Drag any slider and the pivots, gauges, projections and alerts recompute. Each group ships its headline numbers through a **Conduit** as one **Ribbon** into the Dashboard. Click a **Display** chip to inspect a table; **Ctrl+/** opens the function reference.",
  "blue", 580, 220);

// ─── A · Data Sources ─────────────────────────────────────────────────────────
note("note-data", -1920, -560,
  "1 · Data sources",
  "# Live from the repo\nEach **Web Source** pulls a CSV and types every column automatically. It stores the URL, not the data; **Data ▸ Refresh** re-pulls. Desktop can read a local file via the **CSV File** node.",
  "blue", 360, 230);
n("ws-tx",   "WebSourceNode", -1900, -300, { label: "Transactions", url: `${RAW}/transactions.csv` });
n("ws-acct", "WebSourceNode", -1900,  -40, { label: "Accounts",     url: `${RAW}/accounts.csv` });
n("ws-bud",  "WebSourceNode", -1900,  200, { label: "Budgets",      url: `${RAW}/budgets.csv` });
const GRP_DATA = ["ws-tx", "ws-acct", "ws-bud"];

// ─── B · Cash flow ─────────────────────────────────────────────────────────────
note("note-cash", -1480, -560,
  "2 · Cash flow this quarter",
  "# Income vs. expenses\n**SUMIFS** works straight off the transactions frame: one node sums `Amount` where `Amount > 0` (income), a second where `< 0` (spend) — criteria rows exactly like Excel's SUMIFS, no intermediate lists. **Savings rate** = net ÷ income drives a gauge and an alert; drag the target slider to trip it.",
  "green", 380, 200);
n("col-amt", "GetColumnNode", -1460, -260, { label: "Amount", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("red-net", "AggregateNode",    -1180, -360, { label: "Net cash flow", op: "sum" });
n("disp-net","DisplayNode",    -900, -360, { label: "Net cash flow" });
// SUMIFS is one op node over ONE FRAME for a conditional aggregate (D16).
// Coords in the TUNED frame.
n("sumif-in", "SumIfsNode", -900, -250, { label: "Income (Amount > 0)", op: "sumifs", condConfig: { "0": { op: "gt" } }, valueKeys: ["column0"] }, { stringLiterals: { values: "Amount", column0: "Amount", value0: "0" } });
n("disp-in", "DisplayNode",      -640, -160, { label: "Income (3 mo)" });
n("sumif-out","SumIfsNode", -900,  310, { label: "Spend (Amount < 0)", op: "sumifs", condConfig: { "0": { op: "lt" } }, valueKeys: ["column0"] }, { stringLiterals: { values: "Amount", column0: "Amount", value0: "0" } });
n("disp-out","DisplayNode",      -640, 100, { label: "Expenses (3 mo)" });
n("expr-rate","ExpressionNode",-680,  380, { label: "Savings rate", expr: "(income + expense) / income" });
n("gauge-rate","GaugeNode",    -420,  360, { label: "Savings rate" }, { literals: { value: 0 } });
n("sld-savetarget","SliderInputNode", -420, 560, { label: "Target savings rate %", value: 20, min: 0, max: 60, step: 1 }, { literals: { min: 0, max: 60, step: 1 } });
n("expr-savet","ExpressionNode",-680, 560, { label: "Target (fraction)", expr: "t / 100" });
n("alert-rate","AlertNode",    -160,  360, { label: "Low-savings watch", mode: "range" }, { literals: { value: 50, low: 0.2, high: 1, target: 0 } });
n("cd-cash", "ConduitNode",    -260,  540, { angle: 0, seq: 1 });
const GRP_CASH = ["col-amt","red-net","disp-net","sumif-in","disp-in","sumif-out","disp-out","expr-rate","gauge-rate","sld-savetarget","expr-savet","alert-rate","cd-cash"];

c("ws-tx","frame","col-amt","frame");
c("col-amt","values","red-net","list");
c("red-net","result","disp-net","in");
c("ws-tx","frame","sumif-in","frame");
c("sumif-in","result","disp-in","in");
c("ws-tx","frame","sumif-out","frame");
c("sumif-out","result","disp-out","in");
c("sumif-in","result","expr-rate","income");
c("sumif-out","result","expr-rate","expense");
c("expr-rate","result","gauge-rate","value");
c("expr-rate","result","alert-rate","value");
c("sld-savetarget","value","expr-savet","t");
c("expr-savet","result","alert-rate","low");
c("red-net","result","cd-cash","in_0");
c("sumif-in","result","cd-cash","in_1");
c("expr-savet","result","cd-cash","in_4");
c("sumif-out","result","cd-cash","in_2");
c("expr-rate","result","cd-cash","in_3");
fc("fc-net", "disp-net", "currency_usd", GRP_CASH);
fc("fc-in", "disp-in", "currency_usd", GRP_CASH);
fc("fc-out", "disp-out", "currency_usd", GRP_CASH);

// ─── C · Spending pivot (expenses only) ─────────────────────────────────────────
note("note-pivot", 40, -600,
  "3 · Spending pivot",
  "# Group By as a pivot table\nA **Slicer** drops the income rows, then **Group By** — the frame verb, native Polars on desktop — collapses the rest to one row per **Category**. Click the grouped-table chip to inspect it; **Get Column** pulls the totals out for the chart (absolute spend) and a second Group By counts transactions.",
  "gold", 380, 200);
n("slicer-exp","SlicerNode",   60, -300, { label: "Expenses only", selectedColumn: "Category", selectedValues: ["Housing","Groceries","Dining","Transport","Utilities","Entertainment","Shopping","Health"], multiSelect: true });
// The frame Group By is one relational verb over the frame, then Get Column
// pulls the lists the chart/sparkline need. Coords in the TUNED frame.
n("gbf-spend","GroupByFrameNode", 900, -150, { label: "Spend by category", op: "sum" }, { stringLiterals: { keys: "Category", column: "Amount" } });
n("col-ptotal","GetColumnNode", 1230,  60, { label: "Category totals", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("abs-spend","MathFnNode",   600, -180, { label: "Magnitude", op: "abs" });
n("disp-pivot","DisplayNode", 1889, 207, { label: "Spend by category" });
n("chart-cat","ChartNode",   1120,  -40, { label: "Spending by category", op: "column" });
n("gbf-cnt", "GroupByFrameNode",  900, 140, { label: "Count by category", op: "count" }, { stringLiterals: { keys: "Category", column: "Amount" } });
n("col-pcnt","GetColumnNode", 1230, -160, { label: "Counts", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("spark-cnt","SparklineNode",600,  40, { label: "# transactions", op: "column" });
const GRP_PIVOT = ["slicer-exp","gbf-spend","col-ptotal","abs-spend","disp-pivot","chart-cat","gbf-cnt","col-pcnt","spark-cnt"];

c("ws-tx","frame","slicer-exp","frame");
c("slicer-exp","result","gbf-spend","frame");
c("gbf-spend","frame","disp-pivot","in");
c("gbf-spend","frame","col-ptotal","frame");
c("col-ptotal","values","abs-spend","in");
c("abs-spend","result","chart-cat","values");
c("slicer-exp","result","gbf-cnt","frame");
c("gbf-cnt","frame","col-pcnt","frame");
c("col-pcnt","values","spark-cnt","values");

// ─── D · Accounts / net worth ───────────────────────────────────────────────────
note("note-acct", 40, 560,
  "4 · Net worth",
  "# Assets − liabilities\nLiabilities are stored as negative balances, so net worth is **SUM(Balance)**. **SUMIFS** splits by sign straight off the accounts frame: `Balance > 0` for assets, `< 0` for debt — the split holds in any account order. **Group By** (the frame verb) collapses accounts to one row per **Type** for the chart; click the class-totals chip to inspect the grouped table. The gauge tracks the goal slider and the alert watches the emergency fund.",
  "violet", 380, 230);
n("col-bal", "GetColumnNode", 60,  860, { label: "Balance", readAs: "number" }, { stringLiterals: { name: "Balance" } });
n("red-nw",  "AggregateNode",   340,  820, { label: "Net worth", op: "sum" });
n("disp-nw", "DisplayNode",  620,  800, { label: "Net worth" });
n("gauge-nw","GaugeNode",    620, 1020, { label: "Toward goal" }, { literals: { value: 0 } });
n("ratio-nw","ExpressionNode", 430, 1180, { label: "Progress", expr: "nw / goal" });
n("slider-goal","SliderInputNode", 60, 1340, { label: "Net-worth goal", value: 120000, min: 50000, max: 250000, step: 5000 }, { literals: { min: 50000, max: 250000, step: 5000 } });
// SUMIFS (conditional aggregate over one frame) + the frame Group By
// (keys+values through GetColumn). Coords in the TUNED frame.
n("sumif-assets","SumIfsNode", 1250, 1110, { label: "Assets (Balance > 0)", op: "sumifs", condConfig: { "0": { op: "gt" } }, valueKeys: ["column0"] }, { stringLiterals: { values: "Balance", column0: "Balance", value0: "0" } });
n("sumif-liab", "SumIfsNode",  1050, 1680, { label: "Debt (Balance < 0)", op: "sumifs", condConfig: { "0": { op: "lt" } }, valueKeys: ["column0"] }, { stringLiterals: { values: "Balance", column0: "Balance", value0: "0" } });
n("expr-debt","ExpressionNode",    860, 1540, { label: "Liabilities", expr: "-l" });
n("gbf-type", "GroupByFrameNode",  881, 2042, { label: "By asset class", op: "sum" }, { stringLiterals: { keys: "Type", column: "Balance" } });
n("col-tbal", "GetColumnNode",     881, 2270, { label: "Class totals", readAs: "number" }, { stringLiterals: { name: "Balance" } });
n("chart-type","ChartNode",  620, 1260, { label: "Assets vs liabilities", op: "column" });
n("disp-type","DisplayNode", 900, 1080, { label: "Class totals" });
n("alert-nw","AlertNode",    900,  820, { label: "Emergency-fund watch", mode: "range" }, { literals: { value: 50, low: 0, high: 1000000000, target: 0 } });
n("cd-acct", "ConduitNode", 1160,  900, { angle: 0, seq: 2 });
const GRP_ACCT = ["col-bal","red-nw","disp-nw","gauge-nw","ratio-nw","slider-goal","sumif-assets","sumif-liab","expr-debt","gbf-type","col-tbal","chart-type","disp-type","alert-nw","cd-acct"];

c("ws-acct","frame","col-bal","frame");
c("col-bal","values","red-nw","list");
c("red-nw","result","disp-nw","in");
c("red-nw","result","ratio-nw","nw");
c("slider-goal","value","ratio-nw","goal");
c("ratio-nw","result","gauge-nw","value");
c("ws-acct","frame","sumif-assets","frame");
c("ws-acct","frame","sumif-liab","frame");
c("sumif-liab","result","expr-debt","l");
c("ws-acct","frame","gbf-type","frame");
c("gbf-type","frame","disp-type","in");
c("gbf-type","frame","col-tbal","frame");
c("col-tbal","values","chart-type","values");
c("red-nw","result","alert-nw","value");
c("red-nw","result","cd-acct","in_0");
c("sumif-assets","result","cd-acct","in_1");
c("expr-debt","result","cd-acct","in_2");
c("chart-type","chart","cd-acct","in_3");
fc("fc-nw", "disp-nw", "currency_usd", GRP_ACCT);

// ─── S · Assumptions (stray external inputs) ────────────────────────────────────
note("note-assump", -1920, 820,
  "Assumptions (your numbers)",
  "# Stray inputs\nHand-entered values that appear in no CSV. They feed the projections and alerts; change one and the right side recomputes.",
  "vermilion", 360, 170);
n("in-inflation","NumberInputNode", -1900, 1020, { label: "Inflation %/yr", value: 3.2 });
n("in-emerg",    "SliderInputNode", -1900, 1180, { label: "Emergency-fund target $", value: 15000, min: 0, max: 60000, step: 1000 }, { literals: { min: 0, max: 60000, step: 1000 } });
n("in-takehome", "NumberInputNode", -1900, 1480, { label: "Monthly take-home $", value: 5200 });
n("in-years",    "NumberInputNode", -1900, 1660, { label: "Years to retire", value: 30 });
const GRP_ASSUMP = ["in-inflation","in-emerg","in-takehome","in-years"];

c("in-emerg","value","alert-nw","low");

// ─── E · Retirement projection (what-if) ────────────────────────────────────────
note("note-proj", 1420, -560,
  "5 · Retirement what-if",
  "# Retirement projection\n**TVM (FV)** grows today's net worth plus monthly contributions at the assumed return; that is the headline number. The **year-by-year** curve broadcasts the same FV formula across a **SEQUENCE** of years, one Expression over a list, so its last point equals the headline. Drag **Contribution** or **Return** and the projection updates.",
  "green", 400, 220);
n("sld-contrib","SliderInputNode", 1420, -360, { label: "Monthly contribution $", value: 600, min: 0, max: 3000, step: 50 }, { literals: { min: 0, max: 3000, step: 50 } });
n("sld-return", "SliderInputNode", 1420,  -60, { label: "Annual return %", value: 7, min: 0, max: 15, step: 0.5 }, { literals: { min: 0, max: 15, step: 0.5 } });
n("expr-pmt",  "ExpressionNode", 1700, -360, { label: "Contribution (outflow)", expr: "-contrib" });
n("expr-mrate","ExpressionNode", 1700,  -60, { label: "Monthly rate", expr: "ret / 100 / 12" });
n("expr-nper", "ExpressionNode", 1960, -360, { label: "Months", expr: "years * 12" });
n("expr-pv",   "ExpressionNode", 1960, -120, { label: "Today (outflow)", expr: "-nw" });
n("tvm-fv",    "TvmNode",        2220, -260, { label: "Projected nest egg", paymentTiming: "end" });
n("disp-proj", "DisplayNode",    2480, -300, { label: "Projected nest egg" });
n("gauge-proj","GaugeNode",      2480,  -60, { label: "Toward target" }, { literals: { value: 0 } });
n("ratio-proj","ExpressionNode", 2340,  100, { label: "Progress", expr: "fv / target" });
n("sld-target","SliderInputNode",2220,  200, { label: "Retirement target $", value: 1000000, min: 100000, max: 3000000, step: 50000 }, { literals: { min: 100000, max: 3000000, step: 50000 } });
n("alert-proj","AlertNode",      2480,  200, { label: "Off-track watch", mode: "range" }, { literals: { value: 50, low: 0, high: 1000000000000, target: 0 } });
n("seq-years","SequenceNode",    1960,  440, { label: "Years 1…N" });
n("expr-traj","ExpressionNode",   2240,  440, { label: "FV after c years", expr: "pv*(1+i)^(12*c) + IF(i=0, pmt*12*c, pmt*((1+i)^(12*c)-1)/i)" });
n("spark-growth","SparklineNode", 2520,  440, { label: "Growth trajectory", op: "line" });
// The projection group's exit conduit (the group predates the convention): the
// nest egg, its target and the growth chart leave as one ribbon — to the
// dashboard readout and the advisor circuits. Coords in the TUNED frame.
n("cd-proj", "ConduitNode",       3620,  700, { angle: 0, seq: 5 });
const GRP_PROJ = ["sld-contrib","sld-return","expr-pmt","expr-mrate","expr-nper","expr-pv","tvm-fv","disp-proj","gauge-proj","ratio-proj","sld-target","alert-proj","seq-years","expr-traj","spark-growth","cd-proj"];

c("sld-contrib","value","expr-pmt","contrib");
c("sld-return","value","expr-mrate","ret");
c("in-years","value","expr-nper","years");
c("red-nw","result","expr-pv","nw");
c("expr-mrate","result","tvm-fv","rate");
c("expr-nper","result","tvm-fv","nper");
c("expr-pmt","result","tvm-fv","pmt");
c("expr-pv","result","tvm-fv","pv");
c("tvm-fv","fv","disp-proj","in");
c("tvm-fv","fv","ratio-proj","fv");
c("sld-target","value","ratio-proj","target");
c("ratio-proj","result","gauge-proj","value");
c("tvm-fv","fv","alert-proj","value");
c("sld-target","value","alert-proj","low");
c("tvm-fv","fv","cd-proj","in_0");
c("sld-target","value","cd-proj","in_1");
c("spark-growth","chart","cd-proj","in_2");
c("in-years","value","seq-years","count");
c("seq-years","list","expr-traj","c");
c("red-nw","result","expr-traj","pv");
c("expr-mrate","result","expr-traj","i");
c("sld-contrib","value","expr-traj","pmt");
c("expr-traj","result","spark-growth","values");
fc("fc-proj", "disp-proj", "currency_usd", GRP_PROJ);

// ─── F · Mortgage / debt ────────────────────────────────────────────────────────
note("note-mort", 1420, 660,
  "6 · Mortgage stress-test",
  "# Mortgage stress test\n**TVM (PMT)** turns a loan, rate and term into a monthly payment; **CUMIPMT** totals lifetime interest. The **Alert** trips when the payment exceeds 28% of take-home pay.",
  "vermilion", 380, 200);
n("sld-loan", "SliderInputNode", 1420,  860, { label: "Home loan $", value: 350000, min: 100000, max: 800000, step: 10000 }, { literals: { min: 100000, max: 800000, step: 10000 } });
n("sld-apr",  "SliderInputNode", 1420, 1140, { label: "Mortgage APR %", value: 6.25, min: 2, max: 9, step: 0.05 }, { literals: { min: 2, max: 9, step: 0.05 } });
n("in-term",  "NumberInputNode", 1420, 1420, { label: "Term (years)", value: 30 });
// TVM's fv must be WIRED, not a literal — the Equation-family card is
// wire-driven, so a seed literal would be an invisible hardcoded known
// (seeds.test.ts rejects it). fv = 0 ⇒ fully amortized at end of term.
// Coords are in the TUNED frame (committed JSON), inside grp-mort's left
// input column between sld-apr and in-term.
n("in-endbal","NumberInputNode", 2216, 1900, { label: "End balance", value: 0 });
n("expr-mapr","ExpressionNode",  1700, 1140, { label: "Monthly rate", expr: "apr / 100 / 12" });
n("expr-mnper","ExpressionNode", 1700, 1420, { label: "Payments", expr: "term * 12" });
n("tvm-pmt",  "TvmNode",         1960,  980, { label: "Monthly payment", paymentTiming: "end" });
n("expr-absp","ExpressionNode",  2240,  980, { label: "Payment (positive)", expr: "-pmt" });
n("disp-pmt", "DisplayNode",     2520,  980, { label: "Monthly payment" });
n("cumipmt",  "CumPmtNode",      1960, 1280, { label: "Interest (signed)", op: "cumipmt", paymentTiming: "end" });
n("expr-absint","ExpressionNode",2240, 1280, { label: "Total interest", expr: "-i" });
n("disp-int", "DisplayNode",     2520, 1280, { label: "Total interest" });
n("expr-aff", "ExpressionNode",  2240, 1540, { label: "Affordable (28%)", expr: "0.28 * take" });
n("alert-afford","AlertNode",    2520, 1540, { label: "Affordability watch", mode: "range" }, { literals: { value: 50, low: 0, high: 100, target: 0 } });
n("cd-mort", "ConduitNode",      2800, 1080, { angle: 0, seq: 3 });
const GRP_MORT = ["sld-loan","sld-apr","in-term","in-endbal","expr-mapr","expr-mnper","tvm-pmt","expr-absp","disp-pmt","cumipmt","expr-absint","disp-int","expr-aff","alert-afford","cd-mort"];

c("sld-apr","value","expr-mapr","apr");
c("in-term","value","expr-mnper","term");
c("expr-mapr","result","tvm-pmt","rate");
c("expr-mnper","result","tvm-pmt","nper");
c("sld-loan","value","tvm-pmt","pv");
c("in-endbal","value","tvm-pmt","fv");
c("tvm-pmt","pmt","expr-absp","pmt");
c("expr-absp","result","disp-pmt","in");
c("expr-mapr","result","cumipmt","rate");
c("expr-mnper","result","cumipmt","nper");
c("sld-loan","value","cumipmt","pv");
c("expr-mnper","result","cumipmt","end");
c("cumipmt","result","expr-absint","i");
c("expr-absint","result","disp-int","in");
c("in-takehome","value","expr-aff","take");
c("expr-absp","result","alert-afford","value");
c("expr-aff","result","alert-afford","high");
c("expr-absp","result","cd-mort","in_0");
c("expr-absint","result","cd-mort","in_1");
c("expr-aff","result","cd-mort","in_2");
fc("fc-pmt", "disp-pmt", "currency_usd", GRP_MORT);
fc("fc-int", "disp-int", "currency_usd", GRP_MORT);

// ─── G · Budget vs actual (interactive slicer) ──────────────────────────────────
note("note-bud", 1420, 1860,
  "7 · Budget vs actual",
  "# Spend vs. the Budgets CSV\nThe **Slicer** keeps the rows for the category you pick (try Groceries), summed into the quarter's spend. The same category's `MonthlyBudget` comes from the **Budgets CSV**, tripled for the quarter; no number is hand-typed. The **Alert** trips the moment spend passes budget.",
  "amber", 380, 210);
n("slicer",  "SlicerNode",     1420, 2060, { label: "Pick category", selectedColumn: "Category", selectedValues: ["Groceries"], multiSelect: true });
n("col-gamt","GetColumnNode",  1700, 2060, { label: "Amount", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("red-g",   "AggregateNode",     1960, 2060, { label: "Category spend", op: "sum" });
n("expr-gabs","ExpressionNode",2220, 2060, { label: "Spend (positive)", expr: "-spend" });
n("disp-g",  "DisplayNode",    2480, 2040, { label: "Spent (3 mo)" });
n("slicer-bud","SlicerNode",   1420, 2320, { label: "Same category", selectedColumn: "Category", selectedValues: ["Groceries"], multiSelect: true });
n("col-bud", "GetColumnNode",  1700, 2320, { label: "MonthlyBudget", readAs: "number" }, { stringLiterals: { name: "MonthlyBudget" } });
n("red-bud", "AggregateNode",     1960, 2320, { label: "Monthly budget", op: "sum" });
n("expr-qbud","ExpressionNode",2220, 2320, { label: "Quarterly budget", expr: "m * 3" });
n("disp-bud","DisplayNode",    2480, 2300, { label: "Budget (3 mo)" });
n("alert-g", "AlertNode",      2760, 2160, { label: "Over-budget watch", mode: "range" }, { literals: { value: 50, low: 0, high: 100, target: 0 } });
n("cd-bud",  "ConduitNode",    3020, 2200, { angle: 0, seq: 4 });
const GRP_BUD = ["slicer","col-gamt","red-g","expr-gabs","disp-g","slicer-bud","col-bud","red-bud","expr-qbud","disp-bud","alert-g","cd-bud"];

c("ws-tx","frame","slicer","frame");
c("slicer","result","col-gamt","frame");
c("col-gamt","values","red-g","list");
c("red-g","result","expr-gabs","spend");
c("expr-gabs","result","disp-g","in");
c("ws-bud","frame","slicer-bud","frame");
c("slicer-bud","result","col-bud","frame");
c("col-bud","values","red-bud","list");
c("red-bud","result","expr-qbud","m");
c("expr-qbud","result","disp-bud","in");
c("expr-gabs","result","alert-g","value");
c("expr-qbud","result","alert-g","high");
c("expr-gabs","result","cd-bud","in_0");
c("expr-qbud","result","cd-bud","in_1");
fc("fc-g", "disp-g", "currency_usd", GRP_BUD);
fc("fc-bud", "disp-bud", "currency_usd", GRP_BUD);

// ─── V · New in 1.2 (Waterfall / Calendar / Fill Down) ──────────────────────────
// Small self-contained Frame Inputs (no CSV dependency) so each new node shows
// its shape with hand-checkable numbers.
function frameText(cols) {
  return JSON.stringify(cols.map((c) => ({ name: c.name, type: c.type, cells: c.cells.map(String) })));
}
note("note-v12", 40, 1960,
  "9 · New in 1.2",
  "# Bridge, calendar, fill-down\nThe **Waterfall** walks the month from income down to what's left — its Total bar is computed, never typed. The **Calendar** tints each January day by its spend, streaks and splurges at a glance. Below, a report-shaped table names each **Category** only once; **Fill Down** carries the name through the blanks so **Group By** can sum it properly.",
  "gold", 400, 200);
n("fi-bridge", "FrameInputNode", 60, 2240, {
  label: "Monthly budget bridge",
  frameText: frameText([
    { name: "Item", type: "string", cells: ["Income", "Rent", "Groceries", "Transport", "Subscriptions", "Dining", "Savings transfer"] },
    { name: "Delta", type: "number", cells: [5200, -1650, -520, -180, -95, -240, -800] },
  ]),
});
n("wf-bridge", "WaterfallNode", 400, 2240, { label: "Where the month went" });
const V12_SPEND = [
  84, 23, 61, 132, 18, 42, 55, 37, 71, 145,
  96, 12, 48, 33, 27, 88, 156, 64, 21, 39,
  74, 58, 92, 173, 81, 15, 44, 67, 52, 118,
];
n("fi-daily", "FrameInputNode", 760, 2240, {
  label: "Daily spend · Jan 2026",
  frameText: frameText([
    { name: "Date", type: "date", cells: V12_SPEND.map((_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`) },
    { name: "Spend", type: "number", cells: V12_SPEND },
  ]),
});
n("cal-daily", "CalendarHeatmapNode", 1100, 2240, { label: "Spending calendar" });
n("fi-report", "FrameInputNode", 60, 2620, {
  label: "Report-shaped spend",
  frameText: frameText([
    { name: "Category", type: "string", cells: ["Housing", "", "", "Food", "", "", "Transport", ""] },
    { name: "Item", type: "string", cells: ["Rent", "Insurance", "Repairs", "Groceries", "Dining out", "Coffee", "Fuel", "Transit"] },
    { name: "Amount", type: "number", cells: [1650, 120, 85, 520, 240, 60, 110, 70] },
  ]),
});
n("fill-cat", "FillBlanksNode", 400, 2620, { label: "Fill Down → Category" }, { stringLiterals: { columns: "Category" } });
n("gb-cat", "GroupByFrameNode", 700, 2620, { label: "Sum by category", op: "sum" }, { stringLiterals: { keys: "Category", column: "Amount" } });
const GRP_V12 = ["fi-bridge", "wf-bridge", "fi-daily", "cal-daily", "fi-report", "fill-cat", "gb-cat"];

c("fi-bridge", "frame", "wf-bridge", "frame");
c("fi-daily", "frame", "cal-daily", "frame");
c("fi-report", "frame", "fill-cat", "frame");
c("fill-cat", "frame", "gb-cat", "frame");

// ─── H · Dashboard (in-group conduits → ribbons land here) ──────────────────────
note("note-dash", 3280, -600,
  "8 · One-glance dashboard",
  "# Bundled KPIs arrive as ribbons\nThe cash-flow, net-worth, mortgage and budget groups each ship their headline numbers through an in-group **Conduit**; the lanes travel together as one **Ribbon** and fan out into these readouts. Click a Conduit to fan its lanes; click a trunk to grab the whole ribbon.",
  "gray", 380, 210);
n("d-cash-net","DisplayNode", 3060, -300, { label: "Net cash flow" });
n("d-cash-in", "DisplayNode", 3060, -160, { label: "Income" });
n("d-cash-out","DisplayNode", 3060,  -20, { label: "Expenses" });
n("d-cash-rate","DisplayNode",3060,  120, { label: "Savings rate" });
n("d-proj",   "DisplayNode",  3060,  260, { label: "Projected nest egg" });
n("d-acct-nw","DisplayNode",  3060,  400, { label: "Net worth" });
n("d-acct-assets","DisplayNode",3060,540, { label: "Assets" });
n("d-acct-liab","DisplayNode",3060,  680, { label: "Liabilities" });
n("d-mort-pmt","DisplayNode", 3060,  820, { label: "Mortgage payment" });
n("d-mort-int","DisplayNode", 3060,  960, { label: "Lifetime interest" });
n("d-bud-spent","DisplayNode",3060, 1100, { label: "Groceries spent" });
n("d-bud-bud", "DisplayNode", 3060, 1240, { label: "Groceries budget" });
const GRP_DASH = ["d-cash-net","d-cash-in","d-cash-out","d-cash-rate","d-proj","d-acct-nw","d-acct-assets","d-acct-liab","d-mort-pmt","d-mort-int","d-bud-spent","d-bud-bud"];

c("cd-cash","out_0","d-cash-net","in");
c("cd-cash","out_1","d-cash-in","in");
c("cd-cash","out_2","d-cash-out","in");
c("cd-cash","out_3","d-cash-rate","in");
c("cd-proj","out_0","d-proj","in");
c("cd-acct","out_0","d-acct-nw","in");
c("cd-acct","out_1","d-acct-assets","in");
c("cd-acct","out_2","d-acct-liab","in");
c("cd-mort","out_0","d-mort-pmt","in");
c("cd-mort","out_1","d-mort-int","in");
c("cd-bud","out_0","d-bud-spent","in");
c("cd-bud","out_1","d-bud-bud","in");
// Format the dashboard readouts: money as $, the rate as %.
fc("fc-d-net", "d-cash-net", "currency_usd", GRP_DASH);
fc("fc-d-in", "d-cash-in", "currency_usd", GRP_DASH);
fc("fc-d-out", "d-cash-out", "currency_usd", GRP_DASH);
fc("fc-d-rate", "d-cash-rate", "percent", GRP_DASH);
fc("fc-d-proj", "d-proj", "currency_usd", GRP_DASH);
fc("fc-d-nw", "d-acct-nw", "currency_usd", GRP_DASH);
fc("fc-d-ast", "d-acct-assets", "currency_usd", GRP_DASH);
fc("fc-d-liab", "d-acct-liab", "currency_usd", GRP_DASH);
fc("fc-d-pmt", "d-mort-pmt", "currency_usd", GRP_DASH);
fc("fc-d-int", "d-mort-int", "currency_usd", GRP_DASH);
fc("fc-d-bspent", "d-bud-spent", "currency_usd", GRP_DASH);
fc("fc-d-bbud", "d-bud-bud", "currency_usd", GRP_DASH);

// ─── I · Advisor report (live prose over the whole graph) ───────────────────────
// A Report that reads like a financial advisor's letter. Scalar `=refs` are wired
// from the DASHBOARD's Format Controllers (an FC's `out` carries the value plus
// its $/% annotation, so the ref renders formatted); charts embed from the
// existing Chart/Sparkline nodes. The verdict WORDS are computed in-graph: a
// Compare feeds an IF that picks between two Text nodes, so the prose flips
// ("healthy" ↔ "running thin") the moment the numbers do. Coords are in the
// TUNED frame, fresh space right of the Dashboard (its box ends x≈4307).
note("note-advisor", 4460, -940,
  "10 · The advisor's letter",
  "# Prose that recomputes\nThe **Report** pulls live values through `` `=name` `` refs — dollars arrive through the dashboard's **Format Controllers** (so they read $1,234, not 1234.5678), charts embed as figures. Each verdict word is a tiny circuit: **Compare → IF → two Text nodes**. Drag a slider and the letter changes its mind.",
  "sky", 420, 220);
const REPORT_BODY = [
  "# The advisor's letter",
  "",
  "You brought in **`=income`** this quarter and let **`=outflow`** back out, leaving **`=net`** to put to work. Your savings rate is `=savingsRate!` — `=rateWord!` against the target you set.",
  "",
  "`=spendChart`",
  "",
  "## Net worth",
  "",
  "Assets minus debts puts you at **`=netWorth`** today.",
  "",
  "`=classChart`",
  "",
  "## Retirement",
  "",
  "Keep contributing at today's pace and the nest egg reaches **`=nestEgg`** — `=projWord!` your target.",
  "",
  "`=growthChart`",
  "",
  "## The house",
  "",
  "The mortgage costs **`=payment`** a month, which `=mortWord!` the 28%-of-take-home guideline. Carried to term, the interest alone comes to **`=interest`**.",
  "",
  "## Groceries",
  "",
  "**`=spent`** spent against a **`=budget`** budget for the quarter — you're `=budgetWord!` so far.",
  "",
  "*Move any slider and this letter rewrites itself.*",
].join("\n");
// The raw spend sum is negative; the letter wants "$12,400 went out", so flip it
// and give it its own Display + docked FC (the seed's formatting pattern).
n("expr-outflow","ExpressionNode", 4460, -620, { label: "Outflows (positive)", expr: "-spend" });
n("disp-outflow","DisplayNode",    4760, -600, { label: "Outflows (3 mo)" });
// The letter's intake conduit: the dashboard FCs' formatted scalars converge
// into one trunk at the group's edge instead of eight separate cables fanning
// across the report. (8-lane cap: `budget` rides direct.) The annotation walk
// crosses conduit lanes (unitFlow's lane map), so the $/% formats survive.
n("cd-adv", "ConduitNode",         4460, -380, { angle: 0, seq: 6 });
n("txt-rate-good","TextInputNode", 4460, -240, { label: "If saving enough", value: "healthy" });
n("txt-rate-bad", "TextInputNode", 4460,  -90, { label: "If saving too little", value: "running thin" });
n("cmp-rate","ComparisonNode",     4760, -200, { label: "Rate ≥ target?", op: "gte" });
n("if-rate", "IfNode",             5040, -160, { label: "Savings verdict" });
n("txt-proj-good","TextInputNode", 4460,  120, { label: "If on track", value: "on track for" });
n("txt-proj-bad", "TextInputNode", 4460,  270, { label: "If behind", value: "coming up short of" });
n("cmp-proj","ComparisonNode",     4760,  160, { label: "Nest egg ≥ target?", op: "gte" });
n("if-proj", "IfNode",             5040,  200, { label: "Retirement verdict" });
n("txt-mort-good","TextInputNode", 4460,  480, { label: "If affordable", value: "sits comfortably inside" });
n("txt-mort-bad", "TextInputNode", 4460,  630, { label: "If stretched", value: "pushes past" });
n("cmp-mort","ComparisonNode",     4760,  520, { label: "Payment ≤ 28%?", op: "lte" });
n("if-mort", "IfNode",             5040,  560, { label: "Mortgage verdict" });
n("txt-bud-good","TextInputNode",  4460,  840, { label: "If under budget", value: "under" });
n("txt-bud-bad", "TextInputNode",  4460,  990, { label: "If over budget", value: "over" });
n("cmp-bud","ComparisonNode",      4760,  880, { label: "Spend ≤ budget?", op: "lte" });
n("if-bud", "IfNode",              5040,  920, { label: "Budget verdict" });
n("report-adv","ReportNode",       5340,  100, { label: "Advisor's letter", color: "sky", width: 260, height: 150, body: REPORT_BODY });
const GRP_ADVISOR = ["expr-outflow","disp-outflow","cd-adv","txt-rate-good","txt-rate-bad","cmp-rate","if-rate",
  "txt-proj-good","txt-proj-bad","cmp-proj","if-proj","txt-mort-good","txt-mort-bad","cmp-mort","if-mort",
  "txt-bud-good","txt-bud-bad","cmp-bud","if-bud","report-adv"];

c("sumif-out","result","expr-outflow","spend");
c("expr-outflow","result","disp-outflow","in");
// Verdict comparisons read off the source groups' EXIT CONDUITS (cd-cash lane 3
// already carries the savings rate; new lanes carry the target/affordability
// lines), so the cross-canvas feeds ride the same ribbons as the dashboard's.
c("cd-cash","out_3","cmp-rate","a");
c("cd-cash","out_4","cmp-rate","b");
c("cmp-rate","result","if-rate","cond");
c("txt-rate-good","value","if-rate","then");
c("txt-rate-bad","value","if-rate","else");
c("cd-proj","out_0","cmp-proj","a");
c("cd-proj","out_1","cmp-proj","b");
c("cmp-proj","result","if-proj","cond");
c("txt-proj-good","value","if-proj","then");
c("txt-proj-bad","value","if-proj","else");
c("cd-mort","out_0","cmp-mort","a");
c("cd-mort","out_2","cmp-mort","b");
c("cmp-mort","result","if-mort","cond");
c("txt-mort-good","value","if-mort","then");
c("txt-mort-bad","value","if-mort","else");
c("cd-bud","out_0","cmp-bud","a");
c("cd-bud","out_1","cmp-bud","b");
c("cmp-bud","result","if-bud","cond");
c("txt-bud-good","value","if-bud","then");
c("txt-bud-bad","value","if-bud","else");
// Report refs — the dashboard FCs' formatted scalars bundle through cd-adv
// (lane order = reading order in the letter; `budget` direct, 8-lane cap),
// words from the IFs, figures from the group conduits' chart lanes.
c("fc-d-in","out","cd-adv","in_0");
c("fc-d-net","out","cd-adv","in_1");
c("fc-d-rate","out","cd-adv","in_2");
c("fc-d-nw","out","cd-adv","in_3");
c("fc-d-proj","out","cd-adv","in_4");
c("fc-d-pmt","out","cd-adv","in_5");
c("fc-d-int","out","cd-adv","in_6");
c("fc-d-bspent","out","cd-adv","in_7");
c("cd-adv","out_0","report-adv","income");
c("fc-adv-out","out","report-adv","outflow");
c("cd-adv","out_1","report-adv","net");
c("cd-adv","out_2","report-adv","savingsRate");
c("if-rate","result","report-adv","rateWord");
c("chart-cat","chart","report-adv","spendChart");
c("cd-adv","out_3","report-adv","netWorth");
c("cd-acct","out_3","report-adv","classChart");
c("cd-adv","out_4","report-adv","nestEgg");
c("if-proj","result","report-adv","projWord");
c("cd-proj","out_2","report-adv","growthChart");
c("cd-adv","out_5","report-adv","payment");
c("if-mort","result","report-adv","mortWord");
c("cd-adv","out_6","report-adv","interest");
c("cd-adv","out_7","report-adv","spent");
c("fc-d-bbud","out","report-adv","budget");
c("if-bud","result","report-adv","budgetWord");
fc("fc-adv-out", "disp-outflow", "currency_usd", GRP_ADVISOR);

// ─── Groups (rects auto-computed from members) ──────────────────────────────────
const byId = Object.fromEntries(nodes.map((nd) => [nd.id, nd]));
function rect(members, padL = 40, padT = 64, padR = 60, padB = 70, nodeW = 240, nodeH = 230) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    const nd = byId[m];
    minX = Math.min(minX, nd.x); minY = Math.min(minY, nd.y);
    maxX = Math.max(maxX, nd.x + nodeW); maxY = Math.max(maxY, nd.y + nodeH);
  }
  return { x: Math.round(minX - padL), y: Math.round(minY - padT),
           width: Math.round(maxX - minX + padL + padR), height: Math.round(maxY - minY + padT + padB) };
}
function group(id, label, members, color, collapsed = false) {
  const r = rect(members);
  n(id, "GroupNode", r.x, r.y, { label, members, color, collapsed, width: r.width, height: r.height });
}
group("grp-data",   "Data sources",            GRP_DATA,   "blue");
group("grp-cash",   "Cash flow",               GRP_CASH,   "green", true);
group("grp-pivot",  "Spending pivot",          GRP_PIVOT,  "gold", true);
group("grp-acct",   "Net worth",               GRP_ACCT,   "violet", true);
group("grp-assump", "Assumptions",             GRP_ASSUMP, "vermilion");
group("grp-proj",   "Retirement projection",   GRP_PROJ,   "green", true);
group("grp-mort",   "Mortgage stress-test",    GRP_MORT,   "vermilion", true);
group("grp-bud",    "Budget vs actual",        GRP_BUD,    "amber", true);
group("grp-v12",    "New in 1.2",              GRP_V12,    "gold");
group("grp-dash",   "Dashboard",               GRP_DASH,   "gray");
group("grp-advisor","Advisor report",          GRP_ADVISOR,"sky");

// ─── Pins, standoffs ────────────────────────────────────────────────────────────
const pins = [
  { nodeId: "red-net",  outputKey: "result" },
  { nodeId: "red-nw",   outputKey: "result" },
  { nodeId: "expr-rate", outputKey: "result" },
  { nodeId: "tvm-fv",   outputKey: "fv" },
  { nodeId: "expr-absp", outputKey: "result" },
];
// Each documentation Note is TIED to its group (2026-07-19, replacing the old
// group↔group spacing bands): every note sits just above its group, so a
// south→north band keeps it 30–160px off the group's top edge and makes the
// pair a standoff cluster — layout ops (push, tidy) move note + group as one
// block, and dragging the group chain-pulls its note along. Band-only (not
// locked): locked would also pull the note onto the group's centerline, which
// isn't the seed's left-aligned look.
const NOTE_TIES = [
  ["note-data", "grp-data"], ["note-cash", "grp-cash"], ["note-pivot", "grp-pivot"],
  ["note-acct", "grp-acct"], ["note-assump", "grp-assump"], ["note-proj", "grp-proj"],
  ["note-mort", "grp-mort"], ["note-bud", "grp-bud"], ["note-v12", "grp-v12"],
  ["note-dash", "grp-dash"], ["note-advisor", "grp-advisor"],
];
const standoffs = NOTE_TIES.map(([noteId, groupId]) => (
  { a: { nodeId: noteId, anchor: "s" }, b: { nodeId: groupId, anchor: "n" }, min: 30, max: 160 }
));

const graph = { label: "Personal Finance", v: 2, nodes, connections: conns, standoffs, pins };

// Geometry is owned by the COMMITTED JSON, structure by this generator. The
// seed-tune harness (scripts/tune-seeds.mjs) writes real tidy/autofit geometry
// into the JSON from the live app — sizes this generator can't know (it fakes
// nodes as 240×230). Adopt the committed x/y (+ group box sizes) by node id so
// re-running the generator never resets tuned layout; a NEW node keeps its
// authored coords until the next tune pass. This also keeps pfSeedCheck's
// deep-equal lockstep true against a tuned file.
(function adoptCommittedGeometry() {
  const file = path.join(__dirname, "..", "src", "graph", "seedGraphs", "personal-finance.json");
  let committed;
  try { committed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; }
  const prevById = new Map((committed.nodes ?? []).map((nd) => [nd.id, nd]));
  for (const nd of graph.nodes) {
    const prev = prevById.get(nd.id);
    if (!prev || prev.type !== nd.type) continue;
    if (typeof prev.x === "number") nd.x = prev.x;
    if (typeof prev.y === "number") nd.y = prev.y;
    if (nd.type === "GroupNode" && prev.init) {
      if (typeof prev.init.width === "number") nd.init.width = prev.init.width;
      if (typeof prev.init.height === "number") nd.init.height = prev.init.height;
    }
  }
})();

// Export the in-memory graph so a test can assert the committed seed stays in
// lockstep with this generator (pfSeedCheck.test.ts). The file is only WRITTEN
// when the script is run directly (`node scripts/gen-personal-finance-seed.cjs`),
// never as a side effect of being required.
module.exports = { graph };

if (require.main === module) {
  const out = path.join(__dirname, "..", "src", "graph", "seedGraphs", "personal-finance.json");
  fs.writeFileSync(out, JSON.stringify(graph, null, 2) + "\n");
  console.log(`wrote ${out}: ${nodes.length} nodes, ${conns.length} connections, ${FCS.length} format controllers, ${pins.length} pins, ${standoffs.length} standoffs`);
}
