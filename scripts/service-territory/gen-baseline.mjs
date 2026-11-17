// Writes baseline.json beside this file: the service-territory Monte Carlo's step 1, a graph of 400 sites across
// Austin, Little Rock, Alabama, lower Georgia, Chattanooga and Knoxville, 10 operators, each site's class, its assigned
// operator and a random relative frequency of incidents. Seeded, so the baseline is the same on every run and a later
// simulation compares against one fixed world.
//   node scripts/service-territory/gen-baseline.mjs [--seed 2026]
// baseline-app.json is the same graph as the app opens it:
//   npm run -s validate-graph -- scripts/service-territory/baseline.json --json > scripts/service-territory/baseline-app.json
import { writeFileSync } from "node:fs";

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

const OPERATORS = [
  ["OP-01", "Austin, TX", 30.2672, -97.7431],
  ["OP-02", "Little Rock, AR", 34.7465, -92.2896],
  ["OP-03", "Birmingham, AL", 33.5186, -86.8104],
  ["OP-04", "Huntsville, AL", 34.7304, -86.5861],
  ["OP-05", "Montgomery, AL", 32.3792, -86.3077],
  ["OP-06", "Mobile, AL", 30.6954, -88.0399],
  ["OP-07", "Albany, GA", 31.5785, -84.1557],
  ["OP-08", "Savannah, GA", 32.0809, -81.0912],
  ["OP-09", "Chattanooga, TN", 35.0456, -85.3097],
  ["OP-10", "Knoxville, TN", 35.9606, -83.9207],
];

// Area, state, center, radius in miles, sites, and the bearings (degrees clockwise from north) land lies on.
const AREAS = [
  ["Austin", "TX", 30.27, -97.74, 35, 58],
  ["Little Rock", "AR", 34.75, -92.29, 40, 44],
  ["Birmingham", "AL", 33.52, -86.80, 35, 34],
  ["Huntsville", "AL", 34.73, -86.59, 30, 24],
  ["Montgomery", "AL", 32.37, -86.30, 40, 26],
  ["Mobile", "AL", 30.69, -88.04, 35, 22, [-100, 100]],
  ["Tuscaloosa", "AL", 33.21, -87.57, 25, 10],
  ["Dothan", "AL", 31.22, -85.39, 25, 10],
  ["Albany", "GA", 31.58, -84.16, 40, 30],
  ["Valdosta", "GA", 30.83, -83.28, 30, 16],
  ["Savannah", "GA", 32.08, -81.09, 35, 22, [180, 360]],
  ["Macon", "GA", 32.84, -83.63, 30, 14],
  ["Chattanooga", "TN", 35.05, -85.31, 35, 40],
  ["Knoxville", "TN", 35.96, -83.92, 35, 38],
];

// Far from any base, each kept with the operator named: the outliers a better assignment might move.
const OUTLIERS = [
  ["Houston", "TX", 29.76, -95.37, "OP-01"],
  ["Corpus Christi", "TX", 27.80, -97.40, "OP-01"],
  ["Texarkana", "AR", 33.43, -94.05, "OP-02"],
  ["Memphis", "TN", 35.15, -90.05, "OP-02"],
  ["Jonesboro", "AR", 35.84, -90.70, "OP-02"],
  ["Jackson", "MS", 32.30, -90.18, "OP-03"],
  ["Meridian", "MS", 32.36, -88.70, "OP-03"],
  ["Nashville", "TN", 36.16, -86.78, "OP-04"],
  ["Panama City", "FL", 30.16, -85.66, "OP-07"],
  ["Tallahassee", "FL", 30.44, -84.28, "OP-07"],
  ["Atlanta", "GA", 33.75, -84.39, "OP-09"],
  ["Asheville", "NC", 35.60, -82.55, "OP-10"],
];

const CROSSOVERS = 14;

const miles = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
};
const byDistance = (lat, lon) =>
  OPERATORS.map(([id, , blat, blon]) => ({ id, d: miles(lat, lon, blat, blon) })).sort((a, b) => a.d - b.d);

const sites = [];
for (const [area, st, lat, lon, radius, n, arc = [0, 360]] of AREAS) {
  for (let k = 0; k < n; k++) {
    const r = radius * Math.sqrt(rand());
    const bearing = ((arc[0] + rand() * (arc[1] - arc[0])) * Math.PI) / 180;
    const sLat = lat + (r * Math.cos(bearing)) / 69;
    const sLon = lon + (r * Math.sin(bearing)) / (69 * Math.cos((lat * Math.PI) / 180));
    const near = byDistance(sLat, sLon);
    sites.push({ area, st, lat: sLat, lon: sLon, op: near[0].id, how: "Nearest", near });
  }
}
// A crossover goes to the second-nearest base where the two are close calls: the sites a dispatcher would argue over.
const contested = sites.filter((s) => s.near[1].d < s.near[0].d * 1.6 && s.near[1].d < 150);
for (let k = 0; k < CROSSOVERS && contested.length > 0; k++) {
  const s = contested.splice(Math.floor(rand() * contested.length), 1)[0];
  s.op = s.near[1].id;
  s.how = "Crossover";
}
for (const [area, st, lat, lon, op] of OUTLIERS) {
  sites.push({ area, st, lat: lat + (rand() - 0.5) * 0.1, lon: lon + (rand() - 0.5) * 0.1, op, how: "Outlier" });
}

const rows = sites.map((s, i) => ({
  Site: `S-${String(i + 1).padStart(3, "0")}`,
  Area: s.area,
  State: s.st,
  Latitude: Math.round(s.lat * 10000) / 10000,
  Longitude: Math.round(s.lon * 10000) / 10000,
  Class: rand() < 0.35 ? "Class I" : "Class II",
  Operator: s.op,
  Assignment: s.how,
  // Lognormal: most sites see a few incidents, a handful see many.
  "Rel Freq": Math.round(Math.exp(0.6 * normal()) * 100) / 100,
}));
const col = (name, type) => ({ name, type, cells: rows.map((r) => r[name]) });

const cc = (id, label, name, expr, init = {}) => ({ id, type: "ComputedColumnNode", init: { label, expr, ...init }, stringLiterals: { name } });

const graph = {
  nodes: [
    { id: "sites", type: "FrameInputNode", init: { label: "Sites" }, frame: [
      col("Site", "string"), col("Area", "string"), col("State", "string"), col("Latitude", "number"), col("Longitude", "number"),
      col("Class", "string"), col("Operator", "string"), col("Assignment", "string"), col("Rel Freq", "number"),
    ] },
    { id: "ops", type: "FrameInputNode", init: { label: "Operators" }, frame: [
      { name: "Operator", type: "string", cells: OPERATORS.map((o) => o[0]) },
      { name: "Base", type: "string", cells: OPERATORS.map((o) => o[1]) },
      { name: "Base Lat", type: "number", cells: OPERATORS.map((o) => o[2]) },
      { name: "Base Lon", type: "number", cells: OPERATORS.map((o) => o[3]) },
    ] },
    { id: "annual", type: "ValueInputNode", init: { label: "Incidents per year", value: "1500" } },
    { id: "speed", type: "ValueInputNode", init: { label: "Average speed (mph)", value: "50" } },
    { id: "join", type: "JoinNode", init: { label: "Sites with their base", how: "left" }, stringLiterals: { leftKey: "Operator", rightKey: "Operator" } },
    // Great-circle miles to the base, times 1.25 for roads.
    cc("roadmi", "Road miles to base", "Road Miles",
      "ROUND(1.25 * 3958.8 * 2 * ASIN(SQRT(SIN(RADIANS(@[Base Lat] - @Latitude) / 2) ^ 2 + COS(RADIANS(@Latitude)) * COS(RADIANS(@[Base Lat])) * SIN(RADIANS(@[Base Lon] - @Longitude) / 2) ^ 2)), 1)"),
    cc("drive", "One-way drive", "Drive Min", "ROUND(@[Road Miles] / mph * 60, 0)", { sideVars: ["mph"] }),
    cc("expected", "Expected incidents", "Incidents per Yr", "ROUND(annual * @[Rel Freq] / SUM([Rel Freq]), 2)", { sideVars: ["annual"] }),
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
            cc("l_hrs", "Round-trip hours", "Drive Hours per Yr", "ROUND(@[Incidents per Yr] * @[Drive Min] * 2 / 60, 1)"),
            { id: "l_pivot", type: "PivotNode", init: { label: "Per operator", agg: "sum" },
              stringLiterals: { rowFields: "Operator", values: "Sites, Class I Sites, Incidents per Yr, Drive Hours per Yr" } },
            // PIVOTBY names each value "Sum of …".
            cc("l_avg", "Average response", "Avg Drive Min", "IF(@[Sum of Incidents per Yr] > 0, ROUND(@[Sum of Drive Hours per Yr] * 30 / @[Sum of Incidents per Yr], 1), 0)"),
            { id: "load_out", type: "CompositeOutputNode", init: { label: "Load" } },
          ],
          connections: [
            { source: "load_in", sourceOutput: "value", target: "l_one", targetInput: "frame" },
            { source: "l_one", sourceOutput: "frame", target: "l_c1", targetInput: "frame" },
            { source: "l_c1", sourceOutput: "frame", target: "l_hrs", targetInput: "frame" },
            { source: "l_hrs", sourceOutput: "frame", target: "l_pivot", targetInput: "frame" },
            { source: "l_pivot", sourceOutput: "frame", target: "l_avg", targetInput: "frame" },
            { source: "l_avg", sourceOutput: "frame", target: "load_out", targetInput: "value" },
          ],
        },
      },
    },
    { id: "map_ops", type: "UsMapNode", init: { label: "Sites by operator" }, stringLiterals: { options: "c=Operator; s=Rel Freq; annotate=Site; title=Baseline assignment" } },
    { id: "map_how", type: "UsMapNode", init: { label: "Crossovers and outliers" }, stringLiterals: { options: "c=Assignment; annotate=Site; title=How each site was assigned" } },
  ],
  cables: [
    "sites.frame -> join.left",
    "ops.frame -> join.right",
    "join.frame -> roadmi.frame",
    "roadmi.frame -> drive.frame",
    "speed.value -> drive.mph",
    "drive.frame -> expected.frame",
    "annual.value -> expected.annual",
    "expected.frame -> load.in_sites",
    "expected.frame -> map_ops.frame",
    "expected.frame -> map_how.frame",
  ],
};
const AT = {
  sites: [0, 0], ops: [0, 300], annual: [0, 560], speed: [0, 700], join: [340, 0], roadmi: [660, 0], drive: [980, 0],
  expected: [1300, 0], load: [1640, 0], map_ops: [1640, 340], map_how: [2300, 340],
};
for (const n of graph.nodes) [n.x, n.y] = AT[n.id];
for (const id of ["map_ops", "map_how"]) graph.nodes.find((n) => n.id === id).init.width = 620;
writeFileSync(new URL("./baseline.json", import.meta.url), JSON.stringify(graph, null, 1) + "\n");
const count = (k, v) => rows.filter((r) => r[k] === v).length;
console.log(`${rows.length} sites: ${count("Assignment", "Nearest")} nearest, ${count("Assignment", "Crossover")} crossovers, ${count("Assignment", "Outlier")} outliers; ${count("Class", "Class I")} Class I`);
