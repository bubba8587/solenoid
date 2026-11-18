// Writes src/graph/seedGraphs/greedy-queue.json: three run problems on the Greedy Queue card, each a rule written as
// LAMBDA cards and compared against a second rule on the same items, two then improved by the Local Search card. Seeded, so the seed is the same on every run;
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
add("day", "ValueInputNode", { label: "Hours a machine works a day", value: "8" });
for (const [id, label, column] of [["by_due", "Earliest due first", "Due"], ["by_short", "Shortest first", "Hours"]]) {
  queue(id, label, { mode: "skip" }, { group: "Machine", step: "Arrives", orderColumn: column, costColumn: "Hours" });
  wire(`jobs.frame -> ${id}.items`, `machines.frame -> ${id}.start`, `day.value -> ${id}.budget`);
  add(`${id}_late`, "ComputedColumnNode", { label: "Days late", expr: "MAX(0, @Picked - @Due)" }, { stringLiterals: { name: "Late" } });
  getCol(`${id}_col`, "Late", "Late");
  sumOf(`${id}_sum`, `${label}: days late`, "SUM(late)");
  wire(`${id}.picks -> ${id}_late.frame`, `${id}_late.frame -> ${id}_col.frame`, `${id}_col.values -> ${id}_sum.late`);
}
// Then improved: the earliest-due plan as a start, counted by the hour. A job waits for its arrival day, and each hour
// past its due day's end counts; Local Search moves jobs between machines and reorders them while that helps.
lambda("job_wait", "Wait for the job to arrive", "Arrives, before", "MAX(0, (Arrives - 1) * day - before)");
lambda("job_late", "Hours late", "Due, at", "MAX(0, at - Due * day)");
wire("day.value -> job_wait.day", "day.value -> job_late.day");
for (const [id, label, extra] of [["jobs_scored", "Earliest due, as it came", { literals: { passes: 0 } }], ["jobs_better", "Earliest due, improved", {}]]) {
  add(id, "LocalSearchNode", { label }, { stringLiterals: { group: "Machine", costColumn: "Hours" }, ...extra });
  wire(`by_due.picks -> ${id}.items`, `machines.frame -> ${id}.start`, `job_wait.result -> ${id}.cost`, `job_late.result -> ${id}.penalty`);
  getCol(`${id}_pen`, "Penalty", "Penalty");
  sumOf(`${id}_sum`, id === "jobs_scored" ? "Before: days late" : "After: days late", "ROUND(SUM(late) / day, 1)");
  wire(`${id}.plan -> ${id}_pen.frame`, `${id}_pen.values -> ${id}_sum.late`, `day.value -> ${id}_sum.day`);
}
add("jobs_better_chart", "ChartNode", { label: "Each change", op: "line" }, { stringLiterals: { options: "x=Change; y=Total; xlabel=Change; ylabel=Hours" } });
wire("jobs_better.history -> jobs_better_chart.values");

// ── 2. Loading trucks: boxes, 1,000 kg a truck, heaviest first ──
const kg = Array.from({ length: 36 }, () => pick([60, 80, 120, 150, 200, 250, 300, 350, 400, 450, 500, 600]));
add("boxes", "FrameInputNode", { label: "Boxes" }, frame({ Box: kg.map((_, i) => `B${String(i + 1).padStart(2, "0")}`), Kg: kg }));
add("capacity", "ValueInputNode", { label: "Truck capacity (kg)", value: "1000" });
for (const [id, label, mode] of [["fit", "Load trucks", "skip"], ["nofit", "Load trucks, no skipping", "stop"]]) {
  queue(id, label, { mode, orderDir: "desc" }, { orderColumn: "Kg", costColumn: "Kg" });
  wire(`boxes.frame -> ${id}.items`, `capacity.value -> ${id}.budget`);
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
// Then improved: 2-opt and relocate on the nearest-next route, by the same km formula.
add("route_better", "LocalSearchNode", { label: "Nearest next, improved", stuck: "look" });
wire("nearest.picks -> route_better.items", "depot.frame -> route_better.start", "km.result -> route_better.cost");
sumOf("route_better_sum", "Improved: km", "ROUND(km, 1)");
add("route_better_chart", "ChartNode", { label: "Nearest next, improved", op: "xyline" }, { stringLiterals: { options: "x=Longitude; y=Latitude; annotate=Stop; aspect=equal" } });
wire("route_better.total -> route_better_sum.km", "route_better.plan -> route_better_chart.values");

// Each problem is three groups: what both plans share, then the weaker plan and the better. The cards carry the rules;
// a note says only what no card shows.
const note = (id, label, body) => add(id, "NoteNode", { label, body, width: 320, height: 150 });
const problems = [
  ["grp_jobs", "Job shop: the jobs and machines", ["jobs", "machines", "day"],
    ["note_jobs", "The setup", "Jobs open on their **Arrives** day, and any machine can do any job."],
    ["grp_jobs_weak", "Job shop, not optimized: shortest job first", ["by_short", "by_short_late", "by_short_col", "by_short_sum"]],
    ["grp_jobs_good", "Job shop, optimized: earliest due first, then improved", ["by_due", "by_due_late", "by_due_col", "by_due_sum", "job_wait", "job_late", "jobs_scored", "jobs_scored_pen", "jobs_scored_sum", "jobs_better", "jobs_better_pen", "jobs_better_sum", "jobs_better_chart"]]],
  ["grp_trucks", "Loading trucks: the boxes", ["boxes", "capacity"],
    ["note_trucks", "The setup", "A truck is one step: it loads until its capacity is used, then the next truck pulls up."],
    ["grp_trucks_weak", "Loading trucks, not optimized: stop at the first box that won't fit", ["nofit", "nofit_kg", "nofit_chart"]],
    ["grp_trucks_good", "Loading trucks, optimized: skip boxes that won't fit", ["fit", "fit_kg", "fit_chart"]]],
  ["grp_route", "Delivery route: the stops", ["stops", "depot", "km"],
    ["note_route", "The setup", "One driver leaves the depot and visits each stop once."],
    ["grp_route_weak", "Delivery route, not optimized: the stops in listed order", ["listed", "listed_sum", "listed_chart"]],
    ["grp_route_good", "Delivery route, optimized: nearest stop next, then improved", ["nearest", "nearest_sum", "nearest_chart", "route_better", "route_better_sum", "route_better_chart"]]],
];
note("note_read", "How to read this page", "Each problem is three groups: gray is the setup both plans share, amber a simple plan, green a better one.");
for (const [id, label, shared, [nid, nlabel, nbody], ...sides] of problems) {
  note(nid, nlabel, nbody);
  nodes.push({ id, type: "GroupNode", init: { label, members: [nid, ...shared], color: "gray" } });
  for (const [sid, slabel, members] of sides) {
    nodes.push({ id: sid, type: "GroupNode", init: { label: slabel, members, color: sid.endsWith("good") ? "green" : "amber" } });
  }
}

const shortForm = new URL("./examples.json", import.meta.url);
writeFileSync(shortForm, JSON.stringify({ nodes, cables }, null, 1) + "\n");
const saved = JSON.parse(execFileSync("npm", ["run", "-s", "validate-graph", "--", shortForm.pathname, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 }));
delete saved.cables;
const seed = { v: saved.v, order: 335, label: "Greedy Queue and Local Search: three run problems", group: "Modeling", nodes: saved.nodes, connections: saved.connections };
writeFileSync(new URL("../../src/graph/seedGraphs/greedy-queue.json", import.meta.url), JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.nodes.length} cards`);
