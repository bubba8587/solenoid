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
// Then improved: the earliest-due plan as a start, in machine hours. A job waits for its arrival day, and each hour past
// its due day's end costs an hour; Local Search moves jobs between machines and reorders them while that helps.
lambda("job_time", "Wait, then the work", "Arrives, Hours, before", "MAX(0, (Arrives - 1) * 8 - before) + Hours");
lambda("job_late", "Hours late", "Due, at", "MAX(0, at - Due * 8)");
add("jobs_better", "LocalSearchNode", { label: "Earliest due, improved" }, { stringLiterals: { group: "Machine" } });
wire("by_due.picks -> jobs_better.items", "machines.frame -> jobs_better.start", "job_time.result -> jobs_better.cost", "job_late.result -> jobs_better.penalty");
add("jobs_scored", "LocalSearchNode", { label: "Earliest due, as it came" }, { stringLiterals: { group: "Machine" }, literals: { passes: 0 } });
wire("by_due.picks -> jobs_scored.items", "machines.frame -> jobs_scored.start", "job_time.result -> jobs_scored.cost", "job_late.result -> jobs_scored.penalty");
getCol("jobs_scored_pen", "Penalty", "Penalty");
sumOf("jobs_scored_sum", "Before: days late", "ROUND(SUM(late) / 8, 1)");
wire("jobs_scored.plan -> jobs_scored_pen.frame", "jobs_scored_pen.values -> jobs_scored_sum.late");
getCol("jobs_better_pen", "Penalty", "Penalty");
sumOf("jobs_better_sum", "After: days late", "ROUND(SUM(late) / 8, 1)");
add("jobs_better_chart", "ChartNode", { label: "Each change", op: "line" }, { stringLiterals: { options: "x=Change; y=Total; xlabel=Change; ylabel=Hours" } });
wire("jobs_better.plan -> jobs_better_pen.frame", "jobs_better_pen.values -> jobs_better_sum.late", "jobs_better.history -> jobs_better_chart.values");

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
// Then improved: 2-opt and relocate on the nearest-next route, by the same km formula.
add("route_better", "LocalSearchNode", { label: "Nearest next, improved" });
wire("nearest.picks -> route_better.items", "depot.frame -> route_better.start", "km.result -> route_better.cost");
sumOf("route_better_sum", "Improved: km", "ROUND(km, 1)");
add("route_better_chart", "ChartNode", { label: "Nearest next, improved", op: "xyline" }, { stringLiterals: { options: "x=Longitude; y=Latitude; annotate=Stop; aspect=equal" } });
wire("route_better.total -> route_better_sum.km", "route_better.plan -> route_better_chart.values");

// Each problem is three groups: what both plans share with a note on the problem, then the weaker plan and the better,
// each with a note on its rule.
const note = (id, label, body) => add(id, "NoteNode", { label, body, width: 320, height: 150 });
const problems = [
  ["grp_jobs", "Job shop: the jobs and machines", ["jobs", "machines", "work"],
    ["note_jobs", "Three machines, 8-hour days", "Jobs arrive over the first days, each with hours of work and a **due day**. Both plans hand jobs to the machines with the same Greedy Queue; only the **Order by** formula differs."],
    ["grp_jobs_weak", "Job shop, not optimized: shortest job first", ["spt", "by_short", "by_short_late", "by_short_col", "by_short_sum"],
      ["note_jobs_weak", "Shortest first", "Quick jobs go first, so long jobs keep getting pushed back and finish days late."]],
    ["grp_jobs_good", "Job shop, optimized: earliest due first, then improved", ["edd", "by_due", "by_due_late", "by_due_col", "by_due_sum", "job_time", "job_late", "jobs_scored", "jobs_scored_pen", "jobs_scored_sum", "jobs_better", "jobs_better_pen", "jobs_better_sum", "jobs_better_chart"],
      ["note_jobs_good", "Earliest due first", "The job due soonest goes next. **Local Search** then tries moving and swapping jobs between machines, counting by the hour, and keeps each change that cuts the hours late. The chart shows the total falling with each change."]]],
  ["grp_trucks", "Loading trucks: the boxes", ["boxes", "heaviest", "weight"],
    ["note_trucks", "1,000 kg a truck", "Boxes go heaviest first. A truck is one step, and the **Budget** is what it can carry."],
    ["grp_trucks_weak", "Loading trucks, not optimized: stop at the first box that won't fit", ["nofit", "nofit_kg", "nofit_chart"],
      ["note_trucks_weak", "Stop at the first misfit", "A truck leaves as soon as the next box is too heavy, even with room for a smaller one."]],
    ["grp_trucks_good", "Loading trucks, optimized: skip boxes that won't fit", ["fit", "fit_kg", "fit_chart"],
      ["note_trucks_good", "Skip what won't fit", "A truck keeps filling with smaller boxes that still fit. This is first-fit decreasing, a packing rule known to come close to the fewest trucks."]]],
  ["grp_route", "Delivery route: the stops", ["stops", "depot", "km"],
    ["note_route", "16 stops around Knoxville", "One driver leaves the depot. **Km from the last stop** is the great-circle distance, and it is the Cost in both plans."],
    ["grp_route_weak", "Delivery route, not optimized: the stops in listed order", ["listed", "listed_sum", "listed_chart"],
      ["note_route_weak", "In listed order", "No Order by formula, so the stops go in the order they were typed in, crossing back and forth."]],
    ["grp_route_good", "Delivery route, optimized: nearest stop next, then improved", ["nearest", "nearest_sum", "nearest_chart", "route_better", "route_better_sum", "route_better_chart"],
      ["note_route_good", "Nearest next", "The same km formula as the Order by sends the driver to the closest stop each time. **Local Search** then untangles the route by moving stops and flipping stretches of it."]]],
];
for (const [id, label, shared, [nid, nlabel, nbody], ...sides] of problems) {
  note(nid, nlabel, nbody);
  nodes.push({ id, type: "GroupNode", init: { label, members: [nid, ...shared], color: "gray" } });
  for (const [sid, slabel, members, [mid, mlabel, mbody]] of sides) {
    note(mid, mlabel, mbody);
    nodes.push({ id: sid, type: "GroupNode", init: { label: slabel, members: [mid, ...members], color: sid.endsWith("good") ? "green" : "amber" } });
  }
}

const shortForm = new URL("./examples.json", import.meta.url);
writeFileSync(shortForm, JSON.stringify({ nodes, cables }, null, 1) + "\n");
const saved = JSON.parse(execFileSync("npm", ["run", "-s", "validate-graph", "--", shortForm.pathname, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 }));
delete saved.cables;
const seed = { v: saved.v, order: 335, label: "Greedy Queue and Local Search: three run problems", group: "Modeling", nodes: saved.nodes, connections: saved.connections };
writeFileSync(new URL("../../src/graph/seedGraphs/greedy-queue.json", import.meta.url), JSON.stringify(seed, null, 2) + "\n");
console.log(`${seed.nodes.length} cards`);
