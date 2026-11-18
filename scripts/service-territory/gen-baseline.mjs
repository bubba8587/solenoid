// Writes baseline.json beside this file: the service-territory Monte Carlo's step 1, a graph of 250 sites across
// Austin, Little Rock, Alabama, lower Georgia, Chattanooga and Knoxville (none in Mississippi or west Tennessee), 10 operators, each site's class, its assigned
// operator and a random relative frequency of incidents. Seeded, so the baseline is the same on every run and a later
// simulation compares against one fixed world.
//   node scripts/service-territory/gen-baseline.mjs [--seed 2026]
// The seed src/graph/seedGraphs/service-territory.json is this graph as the app saves it, with the menu fields added:
// `npm run -s validate-graph -- scripts/service-territory/baseline.json --json`, then label, order and group. A stand-in
// until the simulation is built; remove both together.
import { writeFileSync } from "node:fs";
import { runsComposite } from "./sim-graph.mjs";


const seedArg = process.argv.indexOf("--seed");
let state = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 2026;
// mulberry32, the generator monteCarlo.ts uses.
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// Each operator's home base, which hands out the sites here and is the Operators table Plan C measures from: four west (three
// in Texas), six east, so neither side's operators carry several times the other's load. The dispatch simulation still
// starts each operator at their first job.
const OPERATORS = [
  ["OP-01", "Round Rock, TX", 30.5083, -97.6789],
  ["OP-02", "San Marcos, TX", 29.8833, -97.9414],
  ["OP-03", "Little Rock, AR", 34.7465, -92.2896],
  ["OP-04", "Houston, TX", 29.7604, -95.3698],
  ["OP-05", "Birmingham, AL", 33.5186, -86.8104],
  ["OP-06", "Montgomery, AL", 32.3792, -86.3077],
  ["OP-07", "Mobile, AL", 30.6954, -88.0399],
  ["OP-08", "Albany, GA", 31.5785, -84.1557],
  ["OP-09", "Chattanooga, TN", 35.0456, -85.3097],
  ["OP-10", "Knoxville, TN", 35.9606, -83.9207],
];

// Area, center, radius in miles, relative share of sites, and the bearings (degrees clockwise from north) land lies on. The radii are wide
// enough that neighboring clusters touch, so the sites between two territories are close calls.
const AREAS = [
  ["Austin", 30.27, -97.74, 55, 30],
  ["Round Rock", 30.62, -97.62, 40, 12],
  ["San Marcos", 29.85, -98.02, 40, 12],
  ["Houston", 29.85, -95.45, 60, 30],
  ["Bryan", 30.67, -96.37, 45, 10],
  ["Beaumont", 30.08, -94.13, 40, 10, [180, 360]],
  ["Victoria", 28.81, -97.00, 45, 10],
  ["East Texas", 31.25, -94.90, 70, 16],
  ["Southeast Texas", 29.90, -96.30, 110, 19],
  ["Little Rock", 34.75, -92.29, 50, 22],
  ["Hot Springs", 34.50, -93.06, 30, 6],
  ["Birmingham", 33.52, -86.80, 45, 30],
  ["Tuscaloosa", 33.21, -87.57, 35, 14],
  ["Huntsville", 34.73, -86.59, 40, 20],
  ["Montgomery", 32.37, -86.30, 45, 24],
  ["Mobile", 30.69, -88.04, 35, 18, [-15, 100]],
  ["Dothan", 31.22, -85.39, 35, 12],
  ["Albany", 31.58, -84.16, 45, 22],
  ["Valdosta", 30.83, -83.28, 35, 12],
  ["Waycross", 31.21, -82.35, 30, 8],
  ["Chattanooga", 35.05, -85.31, 45, 28],
  ["Knoxville", 35.96, -83.92, 45, 26],
];

// Far from every territory, each kept with the operator named: the outliers a better assignment might move.
const OUTLIERS = [
  ["Laredo", 27.53, -99.49, "OP-02"],
  ["Corpus Christi", 27.80, -97.40, "OP-02"],
  ["Texarkana", 33.43, -94.05, "OP-03"],
  ["Jonesboro", 35.84, -90.70, "OP-03"],
  ["Nashville", 36.16, -86.78, "OP-09"],
  ["Panama City", 30.16, -85.66, "OP-08"],
  ["Tallahassee", 30.44, -84.28, "OP-08"],
  ["Atlanta", 33.75, -84.39, "OP-09"],
  ["Asheville", 35.60, -82.55, "OP-10"],
];

const SITES = 250;
const CROSSOVERS = 20;

// The clusters' counts above are proportions: scaled so they and the outliers make SITES, by largest remainder.
{
  const want = SITES - OUTLIERS.length;
  const total = AREAS.reduce((t, a) => t + a[4], 0);
  const exact = AREAS.map((a) => (a[4] * want) / total);
  AREAS.forEach((a, i) => { a[4] = Math.floor(exact[i]); });
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0, left = want - AREAS.reduce((t, a) => t + a[4], 0); k < left; k++) AREAS[order[k][1]][4]++;
}

// Mississippi and west Tennessee stay empty, and so does the Gulf off Texas (south of a line along the coast from Corpus
// Christi to Sabine Pass): a random point that lands in any of them is drawn again.
const offLimits = (lat, lon) =>
  (lat > 30.2 && lat < 35.0 && lon > -91.6 && lon < -88.1) || (lat >= 35.0 && lat < 36.7 && lon > -90.3 && lon < -87.9) ||
  (lon > -97.6 && lon < -93.6 && lat < 27.55 + (lon + 97.6) * 0.5) || (lon > -93.85 && lon < -91.6 && lat < 30.2);

const miles = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
};
const byDistance = (lat, lon) =>
  OPERATORS.map(([id, , blat, blon]) => ({ id, d: miles(lat, lon, blat, blon) })).sort((a, b) => a.d - b.d);

const sites = [];
for (const [area, lat, lon, radius, n, arc = [0, 360]] of AREAS) {
  for (let k = 0; k < n; k++) {
    let sLat, sLon;
    do {
      const r = radius * Math.sqrt(rand());
      const bearing = ((arc[0] + rand() * (arc[1] - arc[0])) * Math.PI) / 180;
      sLat = lat + (r * Math.cos(bearing)) / 69;
      sLon = lon + (r * Math.sin(bearing)) / (69 * Math.cos((lat * Math.PI) / 180));
    } while (offLimits(sLat, sLon));
    const near = byDistance(sLat, sLon);
    sites.push({ area, lat: sLat, lon: sLon, op: near[0].id, how: "Nearest", near });
  }
}
// A crossover goes to the second-nearest territory where the two are close calls: the sites a dispatcher would argue over.
const contested = sites.filter((s) => s.near[1].d < s.near[0].d * 1.6 && s.near[1].d < 150);
for (let k = 0; k < CROSSOVERS && contested.length > 0; k++) {
  const s = contested.splice(Math.floor(rand() * contested.length), 1)[0];
  s.op = s.near[1].id;
  s.how = "Crossover";
}
for (const [area, lat, lon, op] of OUTLIERS) {
  const oLat = lat + (rand() - 0.5) * 0.1;
  const oLon = lon + (rand() - 0.5) * 0.1;
  sites.push({ area, lat: oLat, lon: oLon, op, how: "Outlier", near: byDistance(oLat, oLon) });
}

const rows = sites.map((s, i) => ({
  Site: `S-${String(i + 1).padStart(3, "0")}`,
  Area: s.area,
  Latitude: Math.round(s.lat * 10000) / 10000,
  Longitude: Math.round(s.lon * 10000) / 10000,
  Class: rand() < 0.35 ? "Class I" : "Class II",
  Operator: s.op,
  Assignment: s.how,
  "Nearest Operator": s.near[0].id,
  // Lognormal: most sites see a few incidents, a handful see many.
  "Rel Freq": Math.round(Math.exp(0.6 * normal()) * 100) / 100,
}));
const col = (name, type) => ({ name, type, cells: rows.map((r) => r[name]) });

const cc = (id, label, name, expr, init = {}) => ({ id, type: "ComputedColumnNode", init: { label, expr, ...init }, stringLiterals: { name } });

const graph = {
  nodes: [
    { id: "sites", type: "FrameInputNode", init: { label: "Sites" }, frame: [
      col("Site", "string"), col("Area", "string"), col("Latitude", "number"), col("Longitude", "number"),
      col("Class", "string"), col("Operator", "string"), col("Assignment", "string"), col("Nearest Operator", "string"), col("Rel Freq", "number"),
    ] },
    { id: "annual", type: "ValueInputNode", init: { label: "Incidents per year", value: "1500" } },
    cc("expected", "Expected incidents", "Incidents per Yr", "ROUND(annual * @[Rel Freq] / SUM([Rel Freq]), 2)", { sideVars: ["annual"] }),
    // ── plan B: the same sites with the crossovers handed back to their nearest operator ──
    cc("plan_b", "Plan B operator", "Plan B Operator", 'IF(@Assignment = "Crossover", @[Nearest Operator], @Operator)'),
    // ── plan C: each site to the operator whose home base is fewest incident-miles away, by the Solver: every site and
    // operator paired, each pair's straight-line miles times the site's incidents a year, one whole operator a site, no
    // operator past their Capacity. Without the capacity limit this is each site's nearest base, which is Plan B. ──
    { id: "operators", type: "FrameInputNode", init: { label: "Operators" }, frame: [
      { name: "Operator", type: "string", cells: OPERATORS.map((o) => o[0]) },
      { name: "Home Base", type: "string", cells: OPERATORS.map((o) => o[1]) },
      { name: "Base Lat", type: "number", cells: OPERATORS.map((o) => o[2]) },
      { name: "Base Lon", type: "number", cells: OPERATORS.map((o) => o[3]) },
      // Incidents a year: one job a day is 365 at most, and a queue kept 80% busy (292) leaves room for a bad week.
      { name: "Capacity", type: "number", cells: OPERATORS.map(() => 292) },
    ] },
    { id: "c_sites", type: "PickColumnsNode", init: { label: "Where and how often" }, stringLiterals: { columns: "Site, Latitude, Longitude, Incidents per Yr" } },
    { id: "c_pairs", type: "JoinNode", init: { label: "Every site with every operator", how: "cross" } },
    cc("c_miles", "Miles from base", "Miles", "ROUND(3958.8 * 2 * ASIN(SQRT(SIN((@[Base Lat] - @Latitude) * PI() / 360)^2 + COS(@Latitude * PI() / 180) * COS(@[Base Lat] * PI() / 180) * SIN((@[Base Lon] - @Longitude) * PI() / 360)^2)), 1)"),
    cc("c_cost", "Incident-miles", "Incident Miles", "@[Incidents per Yr] * @Miles"),
    cc("c_whole", "One whole operator", "Whole", "TRUE", { addAs: "logical" }),
    { id: "c_solve", type: "SolverNode", init: { label: "Plan C: fewest incident-miles", goal: "min", limitList: [
      { of: "", by: "Site", sign: "eq", limit: 1 },
      { of: "Incidents per Yr", by: "Operator", sign: "le", limit: null, limitColumn: "Capacity" },
    ] },
      stringLiterals: { objective: "Incident Miles" } },
    { id: "c_take", type: "FilterFrameNode", init: { label: "The pairs it chose", condConfig: { 0: { op: "gt" } }, valueKeys: ["frame", "column0", "value0"] },
      stringLiterals: { column0: "Amount", value0: "0.5" } },
    { id: "c_pick", type: "PickColumnsNode", init: { label: "Site and operator" }, stringLiterals: { columns: "Site, Operator" } },
    { id: "c_ren", type: "RenameNode", init: { label: "As Plan C Operator" }, stringLiterals: { from: "Operator", to: "Plan C Operator" } },
    { id: "c_join", type: "JoinNode", init: { label: "Sites with Plan C", how: "left" }, stringLiterals: { leftKey: "Site" } },
    { id: "c_load", type: "PivotNode", init: { label: "Plan C load", agg: "sum" }, stringLiterals: { rowFields: "Plan C Operator", values: "Incidents per Yr" } },
    { id: "map_c", type: "UsMapNode", init: { label: "Plan C by operator" }, stringLiterals: { options: "c=Plan C Operator; s=Rel Freq; annotate=Site; title=Plan C: fewest incident-miles" } },
    {
      id: "load", type: "CompositeNode",
      init: {
        label: "Operator load", runMode: "single",
        inputPorts: [{ id: "in_sites", label: "Sites", exposure: "exposed", tier: "basic", internalNodeId: "load_in" }],
        outputPorts: [{ id: "out_load", label: "Load", tier: "basic", internalNodeId: "load_out" }],
        scenarios: [], dataTableValues: {},
        internal: {
          nodes: [
            { id: "load_in", type: "CompositeInputNode", init: { label: "Sites" } },
            cc("l_one", "Count each site", "Sites", "1"),
            cc("l_c1", "Class I flag", "Class I Sites", "IF(@Class = \"Class I\", 1, 0)"),
            { id: "l_pivot", type: "PivotNode", init: { label: "Per operator", agg: "sum" },
              stringLiterals: { rowFields: "Operator", values: "Sites, Class I Sites, Incidents per Yr" } },
            { id: "load_out", type: "CompositeOutputNode", init: { label: "Load" } },
          ],
          connections: [
            { source: "load_in", sourceOutput: "value", target: "l_one", targetInput: "frame" },
            { source: "l_one", sourceOutput: "frame", target: "l_c1", targetInput: "frame" },
            { source: "l_c1", sourceOutput: "frame", target: "l_pivot", targetInput: "frame" },
            { source: "l_pivot", sourceOutput: "frame", target: "load_out", targetInput: "value" },
          ],
        },
      },
    },
    { id: "map_ops", type: "UsMapNode", init: { label: "Sites by operator" }, stringLiterals: { options: "c=Operator; s=Rel Freq; annotate=Site; title=Baseline assignment" } },
    { id: "map_how", type: "UsMapNode", init: { label: "Crossovers and outliers" }, stringLiterals: { options: "c=Assignment; annotate=Site; title=How each site was assigned" } },
    // ── step 2: the dispatch Monte Carlo (Solve on the runs card runs it) ──
    { id: "days", type: "ValueInputNode", init: { label: "Days to simulate", value: "365" } },
    runsComposite({ runs: 50 }),
    { id: "mc_mean", type: "AggregateNode", init: { label: "Mean drive hours", op: "avg" } },
    { id: "mc_sd", type: "AggregateNode", init: { label: "Run std dev", op: "stdev" } },
    { id: "mc_n", type: "AggregateNode", init: { label: "Runs", op: "count" } },
    // Both plans run on each run's same incidents, so the saving is measured run by run and its interval is narrow.
    { id: "b_mean", type: "AggregateNode", init: { label: "Plan B saving", op: "avg" } },
    { id: "b_sd", type: "AggregateNode", init: { label: "Saving std dev", op: "stdev" } },
    { id: "b_ci", type: "ConfidenceNode", init: { label: "Plan B saving ± (95%)", op: "norm" }, literals: { alpha: 0.05 } },
    { id: "mc_ci", type: "ConfidenceNode", init: { label: "Mean drive hours ± (95%)", op: "norm" }, literals: { alpha: 0.05 } },
    { id: "c_mean", type: "AggregateNode", init: { label: "Plan C saving", op: "avg" } },
    { id: "c_sd", type: "AggregateNode", init: { label: "Plan C saving std dev", op: "stdev" } },
    { id: "c_ci", type: "ConfidenceNode", init: { label: "Plan C saving ± (95%)", op: "norm" }, literals: { alpha: 0.05 } },
    { id: "open_a", type: "AggregateNode", init: { label: "Still open, baseline", op: "avg" } },
    { id: "open_b", type: "AggregateNode", init: { label: "Still open, Plan B", op: "avg" } },
    { id: "open_c", type: "AggregateNode", init: { label: "Still open, Plan C", op: "avg" } },
    { id: "mc_run", type: "SeriesNode", init: { label: "Run", op: "range" }, literals: { start: 1, step: 1 } },
    { id: "mc_running", type: "RunningNode", init: { label: "Running mean", agg: "avg" } },
    { id: "mc_frame", type: "FrameFromListsNode", init: { label: "Convergence", valueKeys: ["name0", "name1", "name2"] },
      stringLiterals: { name0: "Run", name1: "Drive hours", name2: "Running mean" } },
    // The axis starts just under the lowest run, so the spread between runs shows.
    { id: "mc_opts", type: "ExpressionNode", init: { label: "Chart options",
      expr: '"title=Drive hours per run and the running mean; xlabel=Run; ylabel=Hours; ymin=" & ROUND(MIN(h) * 0.97, -1)' } },
    { id: "mc_chart", type: "ChartNode", init: { label: "Convergence", op: "line" } },
  ],
  cables: [
    "sites.frame -> expected.frame",
    "annual.value -> expected.annual",
    "expected.frame -> load.in_sites",
    "expected.frame -> map_ops.frame",
    "expected.frame -> map_how.frame",
    "expected.frame -> plan_b.frame",
    "expected.frame -> c_sites.frame",
    "c_sites.frame -> c_pairs.left",
    "operators.frame -> c_pairs.right",
    "c_pairs.frame -> c_miles.frame",
    "c_miles.frame -> c_cost.frame",
    "c_cost.frame -> c_whole.frame",
    "c_whole.frame -> c_solve.options",
    "c_solve.plan -> c_take.frame",
    "c_take.frame -> c_pick.frame",
    "c_pick.frame -> c_ren.frame",
    "plan_b.frame -> c_join.left",
    "c_ren.frame -> c_join.right",
    "c_join.frame -> c_load.frame",
    "c_join.frame -> map_c.frame",
    "c_join.frame -> runs.in_sites",
    "runs.o_saved_c -> c_mean.list",
    "runs.o_saved_c -> c_sd.list",
    "c_sd.result -> c_ci.stdev",
    "mc_n.result -> c_ci.n",
    "runs.o_open -> open_a.list",
    "runs.o_open_b -> open_b.list",
    "runs.o_open_c -> open_c.list",
    "days.value -> runs.in_days",
    "runs.o_hours -> mc_mean.list",
    "runs.o_hours -> mc_sd.list",
    "runs.o_hours -> mc_n.list",
    "mc_sd.result -> mc_ci.stdev",
    "mc_n.result -> mc_ci.n",
    "mc_n.result -> mc_run.stop",
    "runs.o_hours -> mc_running.list",
    "mc_run.list -> mc_frame.vals0",
    "runs.o_hours -> mc_frame.vals1",
    "mc_running.result -> mc_frame.vals2",
    "mc_frame.frame -> mc_chart.values",
    "runs.o_hours -> mc_opts.h",
    "mc_opts.result -> mc_chart.options",
    "runs.o_saved -> b_mean.list",
    "runs.o_saved -> b_sd.list",
    "b_sd.result -> b_ci.stdev",
    "mc_n.result -> b_ci.n",
  ],
};
const AT = {
  sites: [0, 421],
  annual: [60, 234],
  expected: [342, 213],
  plan_b: [771, 251],
  load: [721, -71],
  map_ops: [721, 660],
  map_how: [721, 1090],
  days: [881, 1504],
  runs: [1196, 689],
  mc_mean: [1577, 221],
  mc_sd: [1577, 1078],
  mc_n: [1577, 847],
  b_mean: [1577, 419],
  b_sd: [1577, 604],
  b_ci: [1863, 583],
  mc_ci: [1863, 1057],
  mc_run: [1863, 837],
  mc_running: [1863, 1311],
  mc_frame: [2143, 1028],
  mc_opts: [2143, 1468],
  mc_chart: [2491, 1418],
  operators: [60, 2160],
  c_sites: [342, 2160],
  c_pairs: [700, 2160],
  c_miles: [1000, 2160],
  c_cost: [1300, 2160],
  c_whole: [1600, 2160],
  c_solve: [1900, 2160],
  c_take: [2260, 2160],
  c_pick: [2560, 2160],
  c_ren: [2860, 2160],
  c_join: [881, 1760],
  c_mean: [2850, 221],
  c_sd: [2850, 419],
  c_ci: [2850, 604],
  open_a: [2850, 847],
  open_b: [2850, 1057],
  open_c: [2850, 1267],
  c_load: [3200, 221],
  map_c: [3200, 660],
};
for (const n of graph.nodes) [n.x, n.y] = AT[n.id];
for (const id of ["map_ops", "map_how", "map_c", "mc_chart"]) graph.nodes.find((n) => n.id === id).init.width = 620;
writeFileSync(new URL("./baseline.json", import.meta.url), JSON.stringify(graph, null, 1) + "\n");
const count = (k, v) => rows.filter((r) => r[k] === v).length;
const west = sites.filter((x) => x.lon < -91).length;
const loads = OPERATORS.map(([id]) => `${id} ${sites.filter((x) => x.op === id).length}`).join(", ");
if (sites.some((x) => offLimits(x.lat, x.lon))) throw new Error("a site landed in Mississippi, west Tennessee or the Gulf");
console.log(`west ${west}, east ${sites.length - west}; ${loads}`);
console.log(`${rows.length} sites: ${count("Assignment", "Nearest")} nearest, ${count("Assignment", "Crossover")} crossovers, ${count("Assignment", "Outlier")} outliers; ${count("Class", "Class I")} Class I`);
