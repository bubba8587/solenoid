// Generator for the Garden Dashboard seed — the C1 widget-node showcase
// (docs/v2.0/16-widget-nodes.md). Authored in code so group rects are computed
// from member centers rather than hand-placed. Run:
//   node scripts/gen-garden-dashboard-seed.cjs
// Then `npx vitest run tests/graph/seeds.test.ts` validates it against the real
// classes, and scripts/tune-seeds.mjs bakes the tidy geometry against a dev server.
//
// The chain is the plan's watering example: Geocode -> Weather -> split the daily
// frame at TODAY -> total the rain each side -> a Report + an Alert. It is
// offline-meaningful (structure + Note captions) and fills once the document is
// allowed to connect.
const fs = require("fs");
const path = require("path");

// Class default sizes (for center math); Note/Report pass explicit width/height.
const SIZES = {
  GeocodeNode: [240, 230], WeatherNode: [240, 280], TodayNowNode: [160, 140],
  FilterFrameNode: [210, 240], GetColumnNode: [200, 205], AggregateNode: [180, 160],
  NoteNode: [345, 150], ReportNode: [300, 200], AlertNode: [190, 220],
};

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
function note(id, x, y, label, body, color) {
  n(id, "NoteNode", x, y, { label, body, color, width: 345, height: 150, collapsed: false });
}

// ── Group A — where & the weather ────────────────────────────────────────────
n("geocode", "GeocodeNode", 0, 0, { label: "Boise" }, { stringLiterals: { place: "Boise" } });
n("weather", "WeatherNode", 300, 0, { label: "Boise weather", unit: "C", pastDays: 14, forecastDays: 7, refreshMinutes: 360 });
note("note-a", 0, 320, "Where & the weather",
  "Type a place. Geocode turns it into latitude, longitude and a time zone, and Weather pulls the daily forecast. Allow the document to connect in Settings, Data, and it fills in.", "sky");
c("geocode", "lat", "weather", "lat");
c("geocode", "lon", "weather", "lon");

// ── Group B — rain math (your rules over the data) ───────────────────────────
n("today", "TodayNowNode", 820, 0, { label: "Today", op: "today" });
n("filterPast", "FilterFrameNode", 820, 200, { label: "Days behind", condConfig: { "0": { op: "lt" } }, valueKeys: ["frame", "column0", "value0"] }, { stringLiterals: { column0: "Date" } });
n("colPast", "GetColumnNode", 1080, 220, { label: "Rain (behind)", readAs: "number" }, { stringLiterals: { name: "Rain mm" } });
n("aggPast", "AggregateNode", 1340, 240, { label: "Rain last 14 days", op: "sum" });
n("filterFuture", "FilterFrameNode", 820, 560, { label: "Days ahead", condConfig: { "0": { op: "gte" } }, valueKeys: ["frame", "column0", "value0"] }, { stringLiterals: { column0: "Date" } });
n("colFuture", "GetColumnNode", 1080, 580, { label: "Rain (ahead)", readAs: "number" }, { stringLiterals: { name: "Rain mm" } });
n("aggFuture", "AggregateNode", 1340, 600, { label: "Rain next 7 days", op: "sum" });
note("note-b", 1600, 300, "Rain math",
  "Split the forecast at today: the days behind and the days ahead, then total the rain in each. Your own rule over the data, not a fixed number off a website.", "amber");
c("weather", "daily", "filterPast", "frame");
c("weather", "daily", "filterFuture", "frame");
c("today", "result", "filterPast", "value0");
c("today", "result", "filterFuture", "value0");
c("filterPast", "frame", "colPast", "frame");
c("colPast", "values", "aggPast", "list");
c("filterFuture", "frame", "colFuture", "frame");
c("colFuture", "values", "aggFuture", "list");

// ── Group C — the dashboard ──────────────────────────────────────────────────
note("note-c", 2300, 0, "The dashboard",
  "A docked Report reads the two totals; the Alert watches the coming week's rain. Leave the document open and Weather's refresh keeps it live.", "green");
n("report", "ReportNode", 2300, 220, {
  label: "Watering call", color: "green", width: 300, height: 200,
  body: "# Watering call\n\nRain over the **last 14 days**: `=rainPast` mm. Rain forecast for the **next 7 days**: `=rainNext` mm.\n\nRule of thumb: when both are low (under about 25 mm behind and 10 mm ahead), water. Set your own thresholds with an IF, or let the Alert nudge you.",
});
n("alert", "AlertNode", 2320, 470, { label: "Water the garden?", mode: "range" }, { literals: { value: 0, low: 10, high: 1000000, target: 0 } });
c("aggPast", "result", "report", "rainPast");
c("aggFuture", "result", "report", "rainNext");
c("aggFuture", "result", "alert", "value");

// ── Groups: box computed to contain member centers, with padding ──────────────
const PAD = 110;
const byId = Object.fromEntries(nodes.map((nd) => [nd.id, nd]));
function box(memberIds) {
  const cs = memberIds.map((id) => {
    const nd = byId[id];
    const [w, h] = [nd.init.width ?? SIZES[nd.type][0], nd.init.height ?? SIZES[nd.type][1]];
    return [nd.x + w / 2, nd.y + h / 2];
  });
  const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
  const x = Math.min(...xs) - PAD, y = Math.min(...ys) - PAD;
  return { x, y, width: Math.max(...xs) - Math.min(...xs) + 2 * PAD, height: Math.max(...ys) - Math.min(...ys) + 2 * PAD };
}
function group(id, label, color, members) {
  const b = box(members);
  n(id, "GroupNode", Math.round(b.x), Math.round(b.y), { label, members, color, collapsed: false, width: Math.round(b.width), height: Math.round(b.height) });
}
group("grp-where", "Where & the weather", "sky", ["geocode", "weather", "note-a"]);
group("grp-rain", "Rain math", "amber", ["today", "filterPast", "colPast", "aggPast", "filterFuture", "colFuture", "aggFuture", "note-b"]);
group("grp-dash", "The dashboard", "green", ["report", "alert", "note-c"]);

const seed = {
  v: 2,
  order: 415,
  label: "Garden dashboard",
  group: "Charts & reports",
  nodes,
  connections: conns,
};
const out = path.join(__dirname, "..", "src", "graph", "seedGraphs", "garden-dashboard.json");
fs.writeFileSync(out, JSON.stringify(seed, null, 2) + "\n");
console.log(`wrote ${out} — ${nodes.length} nodes, ${conns.length} connections`);
