// Writes src/graph/seedGraphs/optimize.json: one worked problem for each of the Solver, Assignment, Shortest Path,
// Pareto Front and Staffing cards, built from plain tables and the existing cards around them. `node scripts/tune-seeds.mjs
// optimize` then lays it out.
//   node scripts/optimize/gen-seed.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const nodes = [];
const cables = [];
const add = (id, type, init, extra = {}) => nodes.push({ id, type, init, ...extra });
const wire = (...cs) => cables.push(...cs);
// A header "Name (unit)" is a column of that unit, as a person keys one ($ is US dollars).
const table = (id, label, cols) => add(id, "FrameInputNode", { label }, {
  frame: Object.entries(cols).map(([header, cells]) => {
    const [, name, unit] = header.match(/^(.*) \((\$|[A-Za-z/]+)\)$/) ?? [, header];
    const type = cells.some((c) => typeof c === "number") ? "number" : cells.some((c) => typeof c === "boolean") ? "logical" : "string";
    return { name, cells, type, ...(unit ? { unit: unit === "$" ? "usd" : unit } : {}) };
  }),
});
const keep = (id, label, columns) => add(id, "PickColumnsNode", { label }, { stringLiterals: { columns } });
const chart = (id, label, op, options) => add(id, "ChartNode", { label, op }, { stringLiterals: { options } });

// ── 1. A product mix: how many kg of each blend a coffee roaster should roast this week ──
table("blends", "Blends (per kg)", {
  Blend: ["House", "Espresso", "Breakfast", "Ethiopia single origin"],
  "Profit ($)": [6, 9, 7, 12],
  "Brazil (kg)": [0.6, 0.5, 0.3, 0],
  "Colombia (kg)": [0.4, 0.2, 0.5, 0],
  "Ethiopia (kg)": [0, 0.3, 0.2, 1],
  "Roaster (h)": [0.02, 0.03, 0.02, 0.025],
  Max: [600, 400, 350, 200],
});
// Each limit reads as a sentence in the card's Limits popup: total Brazil must be at most 500 (kg, the column's unit).
add("mix", "SolverNode", { label: "Roast plan", limitList: [
  { of: "Brazil", sign: "le", limit: 500 },
  { of: "Colombia", sign: "le", limit: 350 },
  { of: "Ethiopia", sign: "le", limit: 250 },
  { of: "Roaster", sign: "le", limit: 30 },
  { of: "", where: "Blend", is: "Espresso", sign: "ge", limit: 150 },
] }, { stringLiterals: { objective: "Profit" } });
wire("blends.frame -> mix.options");
keep("mix_units", "Kg per blend", "Blend, Amount");
chart("mix_chart", "Kg per blend", "column", "xlabel=Blend; ylabel=Kg");
keep("mix_room", "Sensitivity", "Limit, Bound, Used, Slack, Shadow Price");
wire("mix.plan -> mix_units.frame", "mix_units.frame -> mix_chart.values", "mix.limits -> mix_room.frame");

// ── 2. A project portfolio: which projects fit the budget and the team ──
table("projects", "Projects", {
  Project: ["CRM upgrade", "New warehouse", "Solar roof", "Fleet telematics", "Training program", "Web store", "Robot cell", "Data warehouse"],
  Area: ["IT", "Ops", "Facilities", "Ops", "People", "IT", "Ops", "IT"],
  Value: [120, 260, 90, 110, 60, 150, 210, 130],
  Cost: [80, 220, 70, 60, 25, 90, 180, 100],
  Staff: [3, 5, 1, 2, 2, 4, 4, 3],
  Max: [1, 1, 1, 1, 1, 1, 1, 1],
  Whole: [true, true, true, true, true, true, true, true],
});
add("portfolio", "SolverNode", { label: "Portfolio", limitList: [
  { of: "Cost", sign: "le", limit: 400 },
  { of: "Staff", sign: "le", limit: 12 },
  { measure: "used", of: "", where: "Area", is: "IT", sign: "le", limit: 2 },
] }, { stringLiterals: { objective: "Value" } });
wire("projects.frame -> portfolio.options");
keep("portfolio_pick", "Projects chosen", "Project, Area, Value, Amount");
wire("portfolio.plan -> portfolio_pick.frame");

// ── 2b. An ad budget: each channel reaches fewer new people per dollar the more it gets, so the best split is uneven ──
table("channels", "Channels", {
  Channel: ["Search", "Social", "Radio", "Billboards"],
  Reach: [40000, 65000, 30000, 22000],
  Scale: [3000, 6000, 2500, 4000],
});
add("ad_reach", "LambdaNode", { label: "People reached", params: "Reach, Scale, amount", expr: "Reach * (1 - EXP(-amount / Scale))" });
add("ads", "SolverNode", { label: "Ad budget split", limitList: [{ of: "", sign: "le", limit: 12000 }] });
keep("ads_spend", "Spend per channel", "Channel, Amount");
chart("ads_chart", "Spend per channel", "bar", "xlabel=Dollars");
wire("channels.frame -> ads.options", "ad_reach.result -> ads.goalFormula", "ads.plan -> ads_spend.frame", "ads_spend.frame -> ads_chart.values");

// ── 2c. A shipping plan: two warehouses, three stores, a row per lane. "For each" gives each warehouse its supply and
// each store its demand in one limit apiece, read from the lanes' own columns; the pivot lays the plan out as a grid. ──
table("lanes", "Lanes", {
  From: ["Memphis", "Memphis", "Memphis", "Atlanta", "Atlanta", "Atlanta"],
  To: ["Nashville", "Knoxville", "Chattanooga", "Nashville", "Knoxville", "Chattanooga"],
  "Cost ($)": [4.1, 6.3, 5.2, 5.6, 4.4, 2.9],
  Supply: [500, 500, 500, 400, 400, 400],
  Demand: [300, 250, 280, 300, 250, 280],
});
add("ship", "SolverNode", { label: "Shipping plan", goal: "min", limitList: [
  { of: "", by: "From", sign: "le", limit: null, limitColumn: "Supply" },
  { of: "", by: "To", sign: "ge", limit: null, limitColumn: "Demand" },
] }, { stringLiterals: { objective: "Cost" } });
add("ship_grid", "PivotNode", { label: "Units by lane", agg: "sum" }, { stringLiterals: { rowFields: "From", colFields: "To", values: "Amount" } });
wire("lanes.frame -> ship.options", "ship.plan -> ship_grid.frame");

// ── 2d. A feed blend: the cheapest tonne that's at least 18% protein and at most 6% fat, corn at most half ──
table("feeds", "Ingredients (per kg)", {
  Ingredient: ["Corn", "Soybean meal", "Wheat midds", "Fish meal", "Oats"],
  "Cost ($)": [0.19, 0.44, 0.24, 1.1, 0.26],
  Protein: [0.09, 0.47, 0.15, 0.62, 0.12],
  Fat: [0.04, 0.015, 0.045, 0.09, 0.05],
});
add("feed", "SolverNode", { label: "Feed blend", goal: "min", limitList: [
  { of: "", sign: "eq", limit: 1000 },
  { measure: "average", of: "Protein", sign: "ge", limit: 0.18 },
  { measure: "average", of: "Fat", sign: "le", limit: 0.06 },
  { measure: "share", of: "", where: "Ingredient", is: "Corn", sign: "le", limit: 0.5 },
] }, { stringLiterals: { objective: "Cost" } });
keep("feed_kg", "Kg in a tonne", "Ingredient, Amount");
keep("feed_check", "Blend check", "Limit, Bound, Used");
wire("feeds.frame -> feed.options", "feed.plan -> feed_kg.frame", "feed.limits -> feed_check.frame");

// ── 2e. A paint line: changing to a darker color is quick, to a lighter one a full clean. The changeovers are
// Transitions counted one way, matched by Color, every pair listed (an unlisted one isn't allowed), so the jobs run light
// to dark. ──
table("paint_jobs", "Paint jobs", {
  Job: ["Fence posts", "Mailboxes", "Gates", "Railings", "Planters", "Benches"],
  Color: ["Black", "White", "Red", "Yellow", "White", "Red"],
});
const shades = ["White", "Yellow", "Red", "Black"];
const pairs = shades.flatMap((a, i) => shades.filter((b) => b !== a).map((b) => [a, b, shades.indexOf(b) > i ? 10 * (shades.indexOf(b) - i) : 45 * (i - shades.indexOf(b))]));
table("changeovers", "Changeovers (min)", { From: pairs.map((p) => p[0]), To: pairs.map((p) => p[1]), "Minutes (min)": pairs.map((p) => p[2]) });
table("paint_start", "Line starts", { Job: ["Clean line"], Color: ["White"] });
const paintTransitions = { transitionsDirection: "one", transitionsMatch: "Color", transitionsUnlisted: "none" };
add("paint_first", "GreedyQueueNode", { label: "Quickest change next", orderBy: "cost", ...paintTransitions }, { stringLiterals: {} });
add("paint", "LocalSearchNode", { label: "Paint order", stuck: "look", ...paintTransitions }, { stringLiterals: {} });
wire("paint_jobs.frame -> paint_first.items", "paint_start.frame -> paint_first.start", "changeovers.frame -> paint_first.transitions",
  "paint_first.picks -> paint.items", "paint_start.frame -> paint.start", "changeovers.frame -> paint.transitions");

// ── 3. Crew assignment: who takes which job, hours each would need (blank: not certified) ──
table("hours", "Crew hours", {
  Crew: ["North", "South", "East", "West", "Central"],
  "Substation A (h)": [6, 8, 5, 9, 7],
  "Line repair B (h)": [4, null, 6, 5, 6],
  "Meter swap C (h)": [3, 4, 3, 5, 2],
  "Transformer D (h)": [9, 7, null, 8, 10],
  "Inspection E (h)": [2, 3, 4, 2, 3],
});
add("crews", "AssignmentNode", { label: "Crew assignment" });
wire("hours.frame -> crews.costs");

// ── 4. Shortest route: the fastest way through a small road network. The last road is listed Maryville to Downtown:
// both ways it's the fastest way there (34 min); From → To only, it can't be driven toward Maryville (39 min). ──
table("roads", "Roads", {
  From: ["Depot", "Depot", "Depot", "Halls", "Halls", "Powell", "Powell", "Bearden", "Bearden", "Downtown", "Downtown", "Sequoyah", "Farragut", "Maryville"],
  To: ["Halls", "Powell", "Downtown", "Powell", "Fountain City", "Bearden", "Fountain City", "Farragut", "Sequoyah", "Sequoyah", "Fountain City", "Maryville", "Maryville", "Downtown"],
  "Minutes (min)": [12, 15, 9, 8, 7, 14, 10, 11, 6, 8, 9, 22, 18, 25],
});
add("route", "ShortestPathNode", { label: "Depot to Maryville" }, { stringLiterals: { cost: "Minutes", from: "Depot", to: "Maryville" } });
add("reach", "ShortestPathNode", { label: "Depot distances" }, { stringLiterals: { cost: "Minutes", from: "Depot", to: "" } });
chart("reach_chart", "Minutes from depot", "bar", "xlabel=Minutes");
keep("reach_cols", "Minutes by place", "Place, Distance");
wire("roads.frame -> route.links", "roads.frame -> reach.links", "reach.path -> reach_cols.frame", "reach_cols.frame -> reach_chart.values");
// A van that visits every place and comes back: the same roads as Transitions, a pair with no road between them the
// fastest way through the others.
table("visits", "Places to visit", { Place: ["Halls", "Powell", "Bearden", "Downtown", "Fountain City", "Sequoyah", "Farragut", "Maryville"] });
table("home", "Start", { Place: ["Depot"] });
add("tour_first", "GreedyQueueNode", { label: "Nearest next", orderBy: "cost" }, { stringLiterals: {} });
add("tour", "LocalSearchNode", { label: "Round trip", ends: "return", stuck: "look" }, { stringLiterals: {} });
wire("visits.frame -> tour_first.items", "home.frame -> tour_first.start", "roads.frame -> tour_first.transitions",
  "tour_first.picks -> tour.items", "home.frame -> tour.start", "roads.frame -> tour.transitions");

// ── 5. Comparing plans: which territory plans are real tradeoffs ──
table("plans", "Territory plans", {
  Plan: ["Baseline", "Plan B", "Pooled", "Ten crews", "Weekend shift", "Split Houston"],
  "Drive hours": [2344, 2234, 3500, 2290, 2410, 2180],
  "Mean wait (day)": [1.6, 1.6, 0.4, 1.9, 1.1, 1.7],
  "Overtime hours": [120, 110, 40, 160, 300, 130],
});
add("front", "ParetoNode", { label: "Efficient plans" }, { stringLiterals: { lower: "Drive hours, Mean wait, Overtime hours", higher: "" } });
chart("front_chart", "Drive hours vs wait", "scatter", "x=Drive hours; y=Mean wait; annotate=Plan");
wire("plans.frame -> front.options", "front.all -> front_chart.values");

// ── 6. Staffing: how many dispatchers keep callers from waiting ──
add("calls", "ValueInputNode", { label: "Calls per hour", value: "42" });
add("call_min", "ValueInputNode", { label: "Minutes per call", value: "6" });
add("answer_min", "ValueInputNode", { label: "Answer within (min)", value: "1" });
add("answer_share", "ValueInputNode", { label: "Answered in time", value: "0.8", format: "percent", decimalDigits: 0 });
add("desk", "StaffingNode", { label: "Dispatch staffing" });
keep("desk_cols", "In time by staff level", "Staff, In Time");
chart("desk_chart", "In time by staff level", "column", "xlabel=Dispatchers; ylabel=Answered in time; ymax=1");
wire("calls.value -> desk.arrivals", "call_min.value -> desk.minutes", "answer_min.value -> desk.target", "answer_share.value -> desk.share",
  "desk.options -> desk_cols.frame", "desk_cols.frame -> desk_chart.values");

const groups = [
  ["grp_mix", "Roast mix", ["blends", "mix", "mix_units", "mix_chart", "mix_room"], "teal"],
  ["grp_portfolio", "Project portfolio", ["projects", "portfolio", "portfolio_pick"], "blue"],
  ["grp_ads", "Ad budget", ["channels", "ad_reach", "ads", "ads_spend", "ads_chart"], "pink"],
  ["grp_ship", "Shipping plan", ["lanes", "ship", "ship_grid"], "gold"],
  ["grp_feed", "Feed blend", ["feeds", "feed", "feed_kg", "feed_check"], "lime"],
  ["grp_paint", "Paint line", ["paint_jobs", "changeovers", "paint_start", "paint_first", "paint"], "purple"],
  ["grp_crews", "Crew assignment", ["hours", "crews"], "amber"],
  ["grp_route", "Road route", ["roads", "route", "reach", "reach_cols", "reach_chart", "visits", "home", "tour_first", "tour"], "green"],
  ["grp_front", "Plan trade-offs", ["plans", "front", "front_chart"], "violet"],
  ["grp_desk", "Dispatch staffing", ["calls", "call_min", "answer_min", "answer_share", "desk", "desk_cols", "desk_chart"], "sky"],
];
for (const [id, label, members, color] of groups) nodes.push({ id, type: "GroupNode", init: { label, members, color } });

const shortForm = new URL("./seed.json", import.meta.url);
writeFileSync(shortForm, JSON.stringify({ nodes, cables }, null, 1) + "\n");
const saved = JSON.parse(execFileSync("npm", ["run", "-s", "validate-graph", "--", shortForm.pathname, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 }));
delete saved.cables;
const seed = { v: saved.v, order: 336, label: "Optimization examples", group: "Modeling", nodes: saved.nodes, connections: saved.connections };
writeFileSync(new URL("../../src/graph/seedGraphs/optimize.json", import.meta.url), JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.nodes.length} cards`);
