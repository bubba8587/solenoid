// PROTOTYPE, not in the seed: a day-by-day Simulation composite. Correct, but about 5 s a simulated year and it leaks
// memory across Data Table runs (docs/dev-notes.md); kept as the reference for the dispatch rules while that is decided.
// The dispatch simulation: a Composite in Simulation mode, one round a day. Each day new incidents open at random by each
// site's rate, each with a severity of 1 to 5; every operator services one open incident in their territory, the highest
// severity, then the longest waiting, then the nearest; the rest stay open for tomorrow. An operator drives from the last
// site they serviced, starting from the first site in their territory. Every card that changes day to day sits on the loop, since
// Simulation mode computes a card off the loop only once.
import { readFileSync } from "node:fs";

// The Earth & Sky pack's Great-Circle Distance card, read from the pack so the two can't drift apart.
const pack = readFileSync(new URL("../../src/graph/packs/earthsky.ts", import.meta.url), "utf8");
const GREAT_CIRCLE = pack.match(/type: "es-haversine", label: "Great-Circle Distance", expr:\s*"([^"]+)"/)[1];

// A column's type is pinned, so a day with no rows still appends onto the days before it.
const cc = (id, label, name, expr, sideVars = [], addAs = "number") =>
  ({ id, type: "ComputedColumnNode", init: { label, expr, addAs, ...(sideVars.length ? { sideVars } : {}) }, stringLiterals: { name } });
const getCol = (id, name) => ({ id, type: "GetColumnNode", init: { label: name }, stringLiterals: { name } });
const value = (id, label, v) => ({ id, type: "ValueInputNode", init: { label, value: String(v) } });
const lists = (id, label, names) => ({
  id, type: "FrameFromListsNode", init: { label, valueKeys: names.map((_, i) => `name${i}`) },
  stringLiterals: Object.fromEntries(names.map((n, i) => [`name${i}`, n])),
});
const keep = (id, label, columns) => ({ id, type: "ColumnsNode", init: { label }, stringLiterals: { columns } });
const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });

/** The composite, `days` rounds long. In: Sites (with Incidents per Yr). Out: the day log and each operator's totals. */
export function simulationComposite({ id = "sim", label = "Simulate dispatch", days = 365, x = 0, y = 0 } = {}) {
  // Order matters: Simulation steps the loop's cards in this order, a card before its first input has run reading it as
  // unwired. The day counter goes first so day 1 reads an empty log.
  const nodes = [
    { id: "s_in", type: "CompositeInputNode", init: { label: "Sites" } },
    value("s_mph", "Average speed (mph)", 50),
    value("s_road", "Road factor", 1.25),
    cc("s_rate", "Daily rate", "Daily Rate", "@[Incidents per Yr] / 365"),
    // Where each operator starts: the first site in their territory.
    { id: "s_first", type: "WindowNode", init: { label: "Number each territory's sites", agg: "row_number" }, stringLiterals: { keys: "Operator", name: "Nth" } },
    { id: "s_startrow", type: "FilterFrameNode", init: { label: "First site", condConfig: { 0: { op: "eq" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Nth", value0: "1" } },
    cc("s_slat0", "Start lat", "Lat", "@Latitude"),
    cc("s_slon0", "Start lon", "Lon", "@Longitude"),
    keep("s_start", "Starting positions", "Operator, Lat, Lon"),
    // ── the loop ──
    getCol("s_logdays", "Day"),
    { id: "s_day", type: "ExpressionNode", init: { label: "Day", expr: "COUNT(d) + 1" } },
    cc("s_hit", "Incident today?", "Hit", "RAND() < @[Daily Rate] + 0 * day", ["day"], "logical"),
    { id: "s_new", type: "FilterFrameNode", init: { label: "New incidents", condConfig: { 0: { op: "eq" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Hit", value0: "TRUE" } },
    cc("s_sev", "Severity", "Severity", "RANDBETWEEN(1, 5)"),
    cc("s_opened", "Opened", "Opened", "day", ["day"]),
    cc("s_id", "Incident ID", "ID", "@Site & \"-\" & day", ["day"], "text"),
    { id: "s_open", type: "AppendNode", init: { label: "Open incidents" } },
    getCol("s_ops", "Operator"),
    // The start, then every move: the last row for an operator is where they are now.
    { id: "s_where", type: "AppendNode", init: { label: "Start and moves" } },
    { id: "s_plat", type: "XLookupNode", init: { label: "Where is the operator (lat)", searchMode: "last" }, stringLiterals: { inColumn: "Operator", returnColumn: "Lat" } },
    { id: "s_plon", type: "XLookupNode", init: { label: "Where is the operator (lon)", searchMode: "last" }, stringLiterals: { inColumn: "Operator", returnColumn: "Lon" } },
    getCol("s_slat", "Latitude"),
    getCol("s_slon", "Longitude"),
    { id: "s_gcd", type: "ExpressionNode", init: { label: "Great-Circle Distance", expr: GREAT_CIRCLE, locked: true,
      varDescriptions: { lat1: "Start latitude (°)", lon1: "Start longitude (°)", lat2: "End latitude (°)", lon2: "End longitude (°)" } } },
    { id: "s_km", type: "AddColumnNode", init: { label: "Distance from the operator", addAs: "number" }, stringLiterals: { name: "Km" } },
    // Lower is better: severity first, then the earliest opened, then the nearest.
    cc("s_key", "Priority", "Priority", "-@Severity * 1000000 + @Opened * 1000 + MIN(@Km, 999)"),
    { id: "s_rank", type: "WindowNode", init: { label: "Rank per operator", agg: "row_number" }, stringLiterals: { keys: "Operator", orderBy: "Priority", name: "Pick" } },
    { id: "s_pick", type: "FilterFrameNode", init: { label: "Today's job", condConfig: { 0: { op: "eq" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Pick", value0: "1" } },
    cc("s_drive", "Drive", "Drive Min", "ROUND(@Km * 0.621371 * road / mph * 60, 1)", ["road", "mph"]),
    cc("s_dday", "Serviced on", "Day", "day", ["day"]),
    cc("s_mlat", "New lat", "Lat", "@Latitude"),
    cc("s_mlon", "New lon", "Lon", "@Longitude"),
    keep("s_moved", "Today's positions", "Operator, Lat, Lon"),
    { id: "s_pos", type: "AppendNode", init: { label: "Positions" } },
    { id: "s_jobs", type: "AppendNode", init: { label: "Every job" } },
    getCol("s_dmin", "Drive Min"),
    getCol("s_left", "ID"),
    { id: "s_today", type: "ExpressionNode", init: { label: "Today", expr: "SUM(drive)" } },
    { id: "s_served", type: "ExpressionNode", init: { label: "Served", expr: "COUNT(drive)" } },
    { id: "s_backlog", type: "ExpressionNode", init: { label: "Still open", expr: "COUNTA(ids)" } },
    lists("s_row", "Today's row", ["Day", "Drive Min", "Served", "Open"]),
    { id: "s_log", type: "AppendNode", init: { label: "Day log" } },
    // ── off the loop: read once, after the last day ──
    // An output fed straight from the loop answers a value per day; through a card off the loop it answers the last.
    { id: "s_logout", type: "SortFrameNode", init: { label: "By day", dir: "asc" }, stringLiterals: { column: "Day" } },
    { id: "s_tot", type: "PivotNode", init: { label: "Per operator", agg: "sum" }, stringLiterals: { rowFields: "Operator", values: "Drive Min" } },
    { id: "out_log", type: "CompositeOutputNode", init: { label: "Day log" } },
    { id: "out_ops", type: "CompositeOutputNode", init: { label: "Per operator" } },
  ];
  const connections = [
    wire("s_in", "value", "s_rate", "frame"),
    wire("s_log", "frame", "s_logdays", "frame"),
    wire("s_logdays", "values", "s_day", "d"),
    wire("s_rate", "frame", "s_hit", "frame"),
    wire("s_day", "result", "s_hit", "day"),
    wire("s_hit", "frame", "s_new", "frame"),
    wire("s_new", "frame", "s_sev", "frame"),
    wire("s_sev", "frame", "s_opened", "frame"),
    wire("s_day", "result", "s_opened", "day"),
    wire("s_opened", "frame", "s_id", "frame"),
    wire("s_day", "result", "s_id", "day"),
    wire("s_pick", "dropped", "s_open", "f0"),
    wire("s_id", "frame", "s_open", "f1"),
    wire("s_open", "frame", "s_ops", "frame"),
    wire("s_in", "value", "s_first", "frame"),
    wire("s_first", "frame", "s_startrow", "frame"),
    wire("s_startrow", "frame", "s_slat0", "frame"),
    wire("s_slat0", "frame", "s_slon0", "frame"),
    wire("s_slon0", "frame", "s_start", "frame"),
    wire("s_start", "frame", "s_where", "f0"),
    wire("s_pos", "frame", "s_where", "f1"),
    wire("s_where", "frame", "s_plat", "frame"),
    wire("s_ops", "values", "s_plat", "lookup"),
    wire("s_where", "frame", "s_plon", "frame"),
    wire("s_ops", "values", "s_plon", "lookup"),
    wire("s_open", "frame", "s_slat", "frame"),
    wire("s_open", "frame", "s_slon", "frame"),
    wire("s_plat", "value", "s_gcd", "lat1"),
    wire("s_plon", "value", "s_gcd", "lon1"),
    wire("s_slat", "values", "s_gcd", "lat2"),
    wire("s_slon", "values", "s_gcd", "lon2"),
    wire("s_open", "frame", "s_km", "frame"),
    wire("s_gcd", "result", "s_km", "values"),
    wire("s_km", "frame", "s_key", "frame"),
    wire("s_key", "frame", "s_rank", "frame"),
    wire("s_rank", "frame", "s_pick", "frame"),
    wire("s_pick", "frame", "s_drive", "frame"),
    wire("s_mph", "value", "s_drive", "mph"),
    wire("s_road", "value", "s_drive", "road"),
    wire("s_drive", "frame", "s_dday", "frame"),
    wire("s_day", "result", "s_dday", "day"),
    wire("s_pick", "frame", "s_mlat", "frame"),
    wire("s_mlat", "frame", "s_mlon", "frame"),
    wire("s_mlon", "frame", "s_moved", "frame"),
    wire("s_pos", "frame", "s_pos", "f0"),
    wire("s_moved", "frame", "s_pos", "f1"),
    wire("s_jobs", "frame", "s_jobs", "f0"),
    wire("s_dday", "frame", "s_jobs", "f1"),
    wire("s_dday", "frame", "s_dmin", "frame"),
    wire("s_pick", "dropped", "s_left", "frame"),
    wire("s_dmin", "values", "s_today", "drive"),
    wire("s_dmin", "values", "s_served", "drive"),
    wire("s_left", "values", "s_backlog", "ids"),
    wire("s_day", "result", "s_row", "vals0"),
    wire("s_today", "result", "s_row", "vals1"),
    wire("s_served", "result", "s_row", "vals2"),
    wire("s_backlog", "result", "s_row", "vals3"),
    wire("s_log", "frame", "s_log", "f0"),
    wire("s_row", "frame", "s_log", "f1"),
    wire("s_jobs", "frame", "s_tot", "frame"),
    wire("s_log", "frame", "s_logout", "frame"),
    wire("s_logout", "frame", "out_log", "value"),
    wire("s_tot", "frame", "out_ops", "value"),
  ];
  return {
    id, type: "CompositeNode", x, y,
    init: {
      label, runMode: "simulation", simulationSteps: days,
      inputPorts: [{ id: "in_sites", label: "Sites", exposure: "exposed", tier: "basic", internalNodeId: "s_in" }],
      outputPorts: [
        { id: "out_log", label: "Day log", tier: "basic", internalNodeId: "out_log" },
        { id: "out_ops", label: "Per operator", tier: "basic", internalNodeId: "out_ops" },
      ],
      scenarios: [], dataTableValues: {},
      internal: { nodes, connections },
    },
  };
}

/** The year, run `runs` times: a Data Table over a Run number nothing reads, so each pass is a fresh draw of the year.
 *  Out: each run's total drive hours, jobs served and incidents still open at the end, one entry per run. */
export function runsComposite({ id = "runs", label = "Run it N times", runs = 10, days = 365, x = 0, y = 0 } = {}) {
  const nodes = [
    { id: "r_in", type: "CompositeInputNode", init: { label: "Sites" } },
    { id: "r_run", type: "CompositeInputNode", init: { label: "Run" } },
    simulationComposite({ id: "r_sim", days }),
    getCol("r_drive", "Drive Min"),
    getCol("r_served", "Served"),
    getCol("r_open", "Open"),
    { id: "r_hours", type: "ExpressionNode", init: { label: "Drive hours", expr: "ROUND(SUM(m) / 60, 1)" } },
    { id: "r_jobs", type: "ExpressionNode", init: { label: "Jobs served", expr: "SUM(n)" } },
    { id: "r_left", type: "ExpressionNode", init: { label: "Open at the end", expr: "INDEX(o, COUNT(o))" } },
    { id: "out_hours", type: "CompositeOutputNode", init: { label: "Drive hours" } },
    { id: "out_jobs", type: "CompositeOutputNode", init: { label: "Jobs served" } },
    { id: "out_left", type: "CompositeOutputNode", init: { label: "Open at the end" } },
  ];
  const connections = [
    wire("r_in", "value", "r_sim", "in_sites"),
    wire("r_sim", "out_log", "r_drive", "frame"),
    wire("r_sim", "out_log", "r_served", "frame"),
    wire("r_sim", "out_log", "r_open", "frame"),
    wire("r_drive", "values", "r_hours", "m"),
    wire("r_served", "values", "r_jobs", "n"),
    wire("r_open", "values", "r_left", "o"),
    wire("r_hours", "result", "out_hours", "value"),
    wire("r_jobs", "result", "out_jobs", "value"),
    wire("r_left", "result", "out_left", "value"),
  ];
  return {
    id, type: "CompositeNode", x, y,
    init: {
      label, runMode: "data-table",
      inputPorts: [
        { id: "in_sites", label: "Sites", exposure: "exposed", tier: "basic", internalNodeId: "r_in" },
        { id: "in_run", label: "Run", exposure: "exposed", tier: "basic", internalNodeId: "r_run" },
      ],
      outputPorts: [
        { id: "out_hours", label: "Drive hours", tier: "basic", internalNodeId: "out_hours" },
        { id: "out_jobs", label: "Jobs served", tier: "basic", internalNodeId: "out_jobs" },
        { id: "out_left", label: "Open at the end", tier: "basic", internalNodeId: "out_left" },
      ],
      scenarios: [], dataTableValues: { in_run: Array.from({ length: runs }, (_, i) => i + 1) },
      internal: { nodes, connections },
    },
  };
}
