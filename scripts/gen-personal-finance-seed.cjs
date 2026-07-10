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
  "# Income vs. expenses\n**Filter** the Amount column twice, `> 0` for income and `< 0` for spend, then fold each slice with a **REDUCE** lambda (`acc + x`). Excel: SUMIF. **Savings rate** = net ÷ income drives a gauge and an alert; drag the target slider to trip it.",
  "green", 380, 200);
n("col-amt", "GetColumnNode", -1460, -260, { label: "Amount", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("red-net", "AggregateNode",    -1180, -360, { label: "Net cash flow", op: "sum" });
n("disp-net","DisplayNode",    -900, -360, { label: "Net cash flow" });
n("flt-in",  "FilterNode",      -1180, -120, { label: "Keep income (> 0)", condConfig: { "0": { op: "gt" } } }, { stringLiterals: { value0: "0" } });
n("red-in",  "ReduceLambdaNode", -900, -120, { label: "Income", expr: "acc + x" });
n("disp-in", "DisplayNode",      -640, -160, { label: "Income (3 mo)" });
n("flt-out", "FilterNode",      -1180,  140, { label: "Keep spend (< 0)", condConfig: { "0": { op: "lt" } } }, { stringLiterals: { value0: "0" } });
n("red-out", "ReduceLambdaNode", -900,  140, { label: "Spend", expr: "acc + x" });
n("disp-out","DisplayNode",      -640,  100, { label: "Expenses (3 mo)" });
n("expr-rate","ExpressionNode",-680,  380, { label: "Savings rate", expr: "(income + expense) / income" });
n("gauge-rate","GaugeNode",    -420,  360, { label: "Savings rate" }, { literals: { value: 0 } });
n("sld-savetarget","SliderInputNode", -420, 560, { label: "Target savings rate %", value: 20, min: 0, max: 60, step: 1 }, { literals: { min: 0, max: 60, step: 1 } });
n("expr-savet","ExpressionNode",-680, 560, { label: "Target (fraction)", expr: "t / 100" });
n("alert-rate","AlertNode",    -160,  360, { label: "Low-savings watch", mode: "range" }, { literals: { value: 50, low: 0.2, high: 1, target: 0 } });
n("cd-cash", "ConduitNode",    -260,  540, { angle: 0, seq: 1 });
const GRP_CASH = ["col-amt","red-net","disp-net","flt-in","red-in","disp-in","flt-out","red-out","disp-out","expr-rate","gauge-rate","sld-savetarget","expr-savet","alert-rate","cd-cash"];

c("ws-tx","frame","col-amt","frame");
c("col-amt","values","red-net","list");
c("red-net","result","disp-net","in");
c("col-amt","values","flt-in","list");
c("flt-in","result","red-in","table");
c("red-in","result","disp-in","in");
c("col-amt","values","flt-out","list");
c("flt-out","result","red-out","table");
c("red-out","result","disp-out","in");
c("red-in","result","expr-rate","income");
c("red-out","result","expr-rate","expense");
c("expr-rate","result","gauge-rate","value");
c("expr-rate","result","alert-rate","value");
c("sld-savetarget","value","expr-savet","t");
c("expr-savet","result","alert-rate","low");
c("red-net","result","cd-cash","in_0");
c("red-in","result","cd-cash","in_1");
c("red-out","result","cd-cash","in_2");
c("expr-rate","result","cd-cash","in_3");
fc("fc-net", "disp-net", "currency_usd", GRP_CASH);
fc("fc-in", "disp-in", "currency_usd", GRP_CASH);
fc("fc-out", "disp-out", "currency_usd", GRP_CASH);

// ─── C · Spending pivot (expenses only) ─────────────────────────────────────────
note("note-pivot", 40, -600,
  "3 · Spending pivot",
  "# Group By as a pivot table\nA **Slicer** drops the income rows, then **Group By** collapses the rest to one row per **Category**, summing the absolute spend. A second Group By counts transactions. Totals feed a **Chart**.",
  "gold", 380, 200);
n("slicer-exp","SlicerNode",   60, -300, { label: "Expenses only", selectedColumn: "Category", selectedValues: ["Housing","Groceries","Dining","Transport","Utilities","Entertainment","Shopping","Health"], multiSelect: true });
n("col-cat", "GetColumnNode", 340, -380, { label: "Category", readAs: "text" }, { stringLiterals: { name: "Category" } });
n("col-amt-exp","GetColumnNode",340,-180, { label: "Amount", readAs: "number" }, { stringLiterals: { name: "Amount" } });
n("abs-spend","MathFnNode",   600, -180, { label: "Magnitude", op: "abs" });
n("gb-sum",  "GroupByNode",   860, -320, { label: "Spend by category", op: "sum" });
n("disp-keys","DisplayNode", 1120, -400, { label: "Categories" });
n("disp-vals","DisplayNode", 1120, -220, { label: "Spend by category" });
n("chart-cat","ChartNode",   1120,  -40, { label: "Spending by category", op: "column" });
n("gb-cnt",  "GroupByNode",   860,  -40, { label: "Count by category", op: "count" });
n("spark-cnt","SparklineNode",600,  40, { label: "# transactions", op: "column" });
const GRP_PIVOT = ["slicer-exp","col-cat","col-amt-exp","abs-spend","gb-sum","disp-keys","disp-vals","chart-cat","gb-cnt","spark-cnt"];

c("ws-tx","frame","slicer-exp","frame");
c("slicer-exp","result","col-cat","frame");
c("slicer-exp","result","col-amt-exp","frame");
c("col-amt-exp","values","abs-spend","in");
c("col-cat","values","gb-sum","keys");
c("abs-spend","result","gb-sum","values");
c("gb-sum","keys","disp-keys","in");
c("gb-sum","values","disp-vals","in");
c("gb-sum","values","chart-cat","values");
c("col-cat","values","gb-cnt","keys");
c("col-amt-exp","values","gb-cnt","values");
c("gb-cnt","values","spark-cnt","values");

// ─── D · Accounts / net worth ───────────────────────────────────────────────────
note("note-acct", 40, 560,
  "4 · Net worth",
  "# Assets − liabilities\nLiabilities are stored as negative balances, so net worth is **SUM(Balance)**. Split by sign as in cash flow: **Filter** `> 0` for assets, `< 0` for debt, **REDUCE** each. The split holds in any account order. A **Group By Type** pivot drives the chart; the gauge tracks the goal slider and the alert watches the emergency fund.",
  "violet", 380, 230);
n("col-bal", "GetColumnNode", 60,  860, { label: "Balance", readAs: "number" }, { stringLiterals: { name: "Balance" } });
n("col-type","GetColumnNode", 60, 1100, { label: "Type", readAs: "text" }, { stringLiterals: { name: "Type" } });
n("red-nw",  "AggregateNode",   340,  820, { label: "Net worth", op: "sum" });
n("disp-nw", "DisplayNode",  620,  800, { label: "Net worth" });
n("gauge-nw","GaugeNode",    620, 1020, { label: "Toward goal" }, { literals: { value: 0 } });
n("ratio-nw","ExpressionNode", 430, 1180, { label: "Progress", expr: "nw / goal" });
n("slider-goal","SliderInputNode", 60, 1340, { label: "Net-worth goal", value: 120000, min: 50000, max: 250000, step: 5000 }, { literals: { min: 50000, max: 250000, step: 5000 } });
n("flt-assets","FilterNode",      340, 1320, { label: "Keep assets (> 0)", condConfig: { "0": { op: "gt" } } }, { stringLiterals: { value0: "0" } });
n("red-assets","ReduceLambdaNode", 600, 1320, { label: "Assets total", expr: "acc + x" });
n("flt-liab", "FilterNode",       340, 1540, { label: "Keep debt (< 0)", condConfig: { "0": { op: "lt" } } }, { stringLiterals: { value0: "0" } });
n("red-liab", "ReduceLambdaNode",  600, 1540, { label: "Liabilities (signed)", expr: "acc + x" });
n("expr-debt","ExpressionNode",    860, 1540, { label: "Liabilities", expr: "-l" });
n("gb-type", "GroupByNode",  340, 1080, { label: "By asset class", op: "sum" });
n("chart-type","ChartNode",  620, 1260, { label: "Assets vs liabilities", op: "column" });
n("disp-type","DisplayNode", 900, 1080, { label: "Class totals" });
n("alert-nw","AlertNode",    900,  820, { label: "Emergency-fund watch", mode: "range" }, { literals: { value: 50, low: 0, high: 1000000000, target: 0 } });
n("cd-acct", "ConduitNode", 1160,  900, { angle: 0, seq: 2 });
const GRP_ACCT = ["col-bal","col-type","red-nw","disp-nw","gauge-nw","ratio-nw","slider-goal","flt-assets","red-assets","flt-liab","red-liab","expr-debt","gb-type","chart-type","disp-type","alert-nw","cd-acct"];

c("ws-acct","frame","col-bal","frame");
c("ws-acct","frame","col-type","frame");
c("col-bal","values","red-nw","list");
c("red-nw","result","disp-nw","in");
c("red-nw","result","ratio-nw","nw");
c("slider-goal","value","ratio-nw","goal");
c("ratio-nw","result","gauge-nw","value");
c("col-bal","values","flt-assets","list");
c("flt-assets","result","red-assets","table");
c("col-bal","values","flt-liab","list");
c("flt-liab","result","red-liab","table");
c("red-liab","result","expr-debt","l");
c("col-type","values","gb-type","keys");
c("col-bal","values","gb-type","values");
c("gb-type","values","disp-type","in");
c("gb-type","values","chart-type","values");
c("red-nw","result","alert-nw","value");
c("red-nw","result","cd-acct","in_0");
c("red-assets","result","cd-acct","in_1");
c("expr-debt","result","cd-acct","in_2");
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
const GRP_PROJ = ["sld-contrib","sld-return","expr-pmt","expr-mrate","expr-nper","expr-pv","tvm-fv","disp-proj","gauge-proj","ratio-proj","sld-target","alert-proj","seq-years","expr-traj","spark-growth"];

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
n("expr-mapr","ExpressionNode",  1700, 1140, { label: "Monthly rate", expr: "apr / 100 / 12" });
n("expr-mnper","ExpressionNode", 1700, 1420, { label: "Payments", expr: "term * 12" });
n("tvm-pmt",  "TvmNode",         1960,  980, { label: "Monthly payment", paymentTiming: "end" }, { literals: { fv: 0 } });
n("expr-absp","ExpressionNode",  2240,  980, { label: "Payment (positive)", expr: "-pmt" });
n("disp-pmt", "DisplayNode",     2520,  980, { label: "Monthly payment" });
n("cumipmt",  "CumPmtNode",      1960, 1280, { label: "Interest (signed)", op: "cumipmt", paymentTiming: "end" });
n("expr-absint","ExpressionNode",2240, 1280, { label: "Total interest", expr: "-i" });
n("disp-int", "DisplayNode",     2520, 1280, { label: "Total interest" });
n("expr-aff", "ExpressionNode",  2240, 1540, { label: "Affordable (28%)", expr: "0.28 * take" });
n("alert-afford","AlertNode",    2520, 1540, { label: "Affordability watch", mode: "range" }, { literals: { value: 50, low: 0, high: 100, target: 0 } });
n("cd-mort", "ConduitNode",      2800, 1080, { angle: 0, seq: 3 });
const GRP_MORT = ["sld-loan","sld-apr","in-term","expr-mapr","expr-mnper","tvm-pmt","expr-absp","disp-pmt","cumipmt","expr-absint","disp-int","expr-aff","alert-afford","cd-mort"];

c("sld-apr","value","expr-mapr","apr");
c("in-term","value","expr-mnper","term");
c("expr-mapr","result","tvm-pmt","rate");
c("expr-mnper","result","tvm-pmt","nper");
c("sld-loan","value","tvm-pmt","pv");
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
c("tvm-fv","fv","d-proj","in");
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
group("grp-dash",   "Dashboard",               GRP_DASH,   "gray");

// ─── Pins, standoffs ────────────────────────────────────────────────────────────
const pins = [
  { nodeId: "red-net",  outputKey: "result" },
  { nodeId: "red-nw",   outputKey: "result" },
  { nodeId: "expr-rate", outputKey: "result" },
  { nodeId: "tvm-fv",   outputKey: "fv" },
  { nodeId: "expr-absp", outputKey: "result" },
];
const standoffs = [
  { a: { nodeId: "grp-data", anchor: "e" }, b: { nodeId: "grp-cash", anchor: "w" }, min: 60, max: 600 },
  { a: { nodeId: "grp-pivot", anchor: "e" }, b: { nodeId: "grp-proj", anchor: "w" }, min: 80, max: 700 },
];

const graph = { label: "Personal Finance", v: 2, nodes, connections: conns, standoffs, pins };

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
