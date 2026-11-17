// Writes src/graph/seedGraphs/greedy-queue.json: three run problems on the Greedy Queue card, each a rule written as
// LAMBDA cards and compared against a second rule on the same items. Seeded, so the seed is the same on every run;
// `node scripts/tune-seeds.mjs greedy-queue` then lays it out.
//   node scripts/greedy-queue/gen-examples.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let state = 11;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const frame = (cols) => ({ frame: Object.entries(cols).map(([name, cells]) => ({ name, cells, type: typeof cells[0] === "number" ? "number" : "string" })) });

const nodes = [];
const cables = [];
const add = (id, type, init, extra = {}) => nodes.push({ id, type, init, ...extra });
const wire = (...cs) => cables.push(...cs);
const lambda = (id, label, params, expr) => add(id, "LambdaNode", { label, params, expr });
const queue = (id, label, extra, strs, lits) =>
  add(id, "GreedyQueueNode", { label, ...extra }, { stringLiterals: strs, ...(lits ? { literals: lits } : {}) });
const sumOf = (id, label, expr) => add(id, "ExpressionNode", { label, expr });
const getCol = (id, label, name) => add(id, "GetColumnNode", { label }, { stringLiterals: { name } });

// ── 1. A job shop: three machines, 8 hours a day, jobs arriving with due days ──
const jobs = Array.from({ length: 60 }, (_, i) => {
  const arrives = int(1, 8);
  return { Job: `J${String(i + 1).padStart(2, "0")}`, Arrives: arrives, Hours: pick([1, 1, 2, 2, 3, 4, 5, 6, 8]), Due: arrives + int(0, 3) };
}).sort((a, b) => a.Arrives - b.Arrives || a.Job.localeCompare(b.Job));
add("jobs", "FrameInputNode", { label: "Jobs" }, frame({ Job: jobs.map((j) => j.Job), Arrives: jobs.map((j) => j.Arrives), Hours: jobs.map((j) => j.Hours), Due: jobs.map((j) => j.Due) }));
add("machines", "FrameInputNode", { label: "Machines" }, frame({ Machine: ["Lathe 1", "Lathe 2", "Mill"] }));
lambda("edd", "Earliest due first", "Due", "Due");
lambda("spt", "Shortest first", "Hours", "Hours");
lambda("work", "Hours of work", "Hours", "Hours");
for (const [id, label, rule] of [["by_due", "Earliest due first", "edd"], ["by_short", "Shortest first", "spt"]]) {
  queue(id, label, { mode: "skip" }, { group: "Machine", step: "Arrives" }, { budget: 8 });
  wire(`jobs.frame -> ${id}.items`, `machines.frame -> ${id}.start`, `${rule}.result -> ${id}.order`, `work.result -> ${id}.cost`);
  add(`${id}_late`, "ComputedColumnNode", { label: "Days late", expr: "MAX(0, @Picked - @Due)" }, { stringLiterals: { name: "Late" } });
  getCol(`${id}_col`, "Late", "Late");
  sumOf(`${id}_sum`, `${label}: days late`, "SUM(late)");
  wire(`${id}.picks -> ${id}_late.frame`, `${id}_late.frame -> ${id}_col.frame`, `${id}_col.values -> ${id}_sum.late`);
}

// ── 2. Loading trucks: boxes, 1,000 kg a truck, heaviest first ──
const kg = Array.from({ length: 36 }, () => pick([60, 80, 120, 150, 200, 250, 300, 350, 400, 450, 500, 600]));
add("boxes", "FrameInputNode", { label: "Boxes" }, frame({ Box: kg.map((_, i) => `B${String(i + 1).padStart(2, "0")}`), Kg: kg }));
lambda("heaviest", "Heaviest first", "Kg", "-Kg");
lambda("weight", "Weight", "Kg", "Kg");
for (const [id, label, mode] of [["fit", "Load trucks", "skip"], ["nofit", "Load trucks, no skipping", "stop"]]) {
  queue(id, label, { mode }, {}, { budget: 1000 });
  wire(`boxes.frame -> ${id}.items`, `heaviest.result -> ${id}.order`, `weight.result -> ${id}.cost`);
  add(`${id}_kg`, "GroupByFrameNode", { label: `${label}: kg a truck`, agg: "sum" }, { stringLiterals: { keys: "Picked", column: "Kg" } });
  add(`${id}_chart`, "ChartNode", { label: `${label}`, op: "column" }, { stringLiterals: { options: "xlabel=Truck; ylabel=Kg; ymax=1000" } });
  wire(`${id}.picks -> ${id}_kg.frame`, `${id}_kg.frame -> ${id}_chart.values`);
}

// ── 3. A delivery route: stops around Knoxville from a depot, the nearest next ──
const stops = Array.from({ length: 16 }, (_, i) => ({
  Stop: `Stop ${i + 1}`, Latitude: Math.round((35.96 + (rand() - 0.5) * 0.7) * 1e4) / 1e4, Longitude: Math.round((-83.92 + (rand() - 0.5)) * 1e4) / 1e4,
}));
add("stops", "FrameInputNode", { label: "Stops" }, frame({ Stop: stops.map((s) => s.Stop), Latitude: stops.map((s) => s.Latitude), Longitude: stops.map((s) => s.Longitude) }));
add("depot", "FrameInputNode", { label: "Depot" }, frame({ Stop: ["Depot"], Latitude: [35.96], Longitude: [-83.92] }));
const KM = "2*6371.0088*ASIN(SQRT(SIN((Latitude-last_Latitude)*PI()/360)^2+COS(last_Latitude*PI()/180)*COS(Latitude*PI()/180)*SIN((Longitude-last_Longitude)*PI()/360)^2))";
lambda("km", "Km from the last stop", "Latitude, Longitude, last_Latitude, last_Longitude", KM);
for (const [id, label, ordered] of [["nearest", "Nearest next", true], ["listed", "In the listed order", false]]) {
  queue(id, label, {}, {});
  wire(`stops.frame -> ${id}.items`, `depot.frame -> ${id}.start`, `km.result -> ${id}.cost`, ...(ordered ? [`km.result -> ${id}.order`] : []));
  sumOf(`${id}_sum`, `${label}: km`, "ROUND(km, 1)");
  add(`${id}_chart`, "ChartNode", { label, op: "xyline" }, { stringLiterals: { options: "x=Longitude; y=Latitude; annotate=Stop; aspect=equal" } });
  wire(`${id}.total -> ${id}_sum.km`, `${id}.picks -> ${id}_chart.values`);
}

const groups = [
  ["grp_jobs", "A job shop: which job next on a free machine", ["jobs", "machines", "edd", "spt", "work", "by_due", "by_short", "by_due_late", "by_short_late", "by_due_col", "by_short_col", "by_due_sum", "by_short_sum"]],
  ["grp_trucks", "Loading trucks: which box next", ["boxes", "heaviest", "weight", "fit", "nofit", "fit_kg", "nofit_kg", "fit_chart", "nofit_chart"]],
  ["grp_route", "A delivery route: which stop next", ["stops", "depot", "km", "nearest", "listed", "nearest_sum", "listed_sum", "nearest_chart", "listed_chart"]],
];
for (const [id, label, members] of groups) nodes.push({ id, type: "GroupNode", init: { label, members, color: "gray" } });

const shortForm = new URL("./examples.json", import.meta.url);
writeFileSync(shortForm, JSON.stringify({ nodes, cables }, null, 1) + "\n");
const saved = JSON.parse(execFileSync("npm", ["run", "-s", "validate-graph", "--", shortForm.pathname, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 }));
delete saved.cables;
const seed = { v: saved.v, order: 335, label: "Greedy Queue: three run problems", group: "Modeling", nodes: saved.nodes, connections: saved.connections };
writeFileSync(new URL("../../src/graph/seedGraphs/greedy-queue.json", import.meta.url), JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.nodes.length} cards`);
