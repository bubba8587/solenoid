// The dispatch Monte Carlo: a Composite in Data Table mode, a pass per run. Each pass draws a year of incidents (each
// site, each day, an incident with its daily share of the site's yearly rate, a severity of 1 to 5) and runs them
// through the Greedy Queue card, a queue per operator a day at a time. The dispatch rule is the two LAMBDA cards beside
// it: Order by (highest severity, then the longest waiting, then the nearest to the last stop, by the Earth & Sky pack's
// great-circle formula) and Cost (the drive in minutes). An operator starts at their first job.

// The Earth & Sky pack's Great-Circle Distance in km, from the last stop to this incident.
const KM = "2*6371.0088*ASIN(SQRT(SIN((Latitude-last_Latitude)*PI()/360)^2+COS(last_Latitude*PI()/180)*COS(Latitude*PI()/180)*SIN((Longitude-last_Longitude)*PI()/360)^2))";

const cc = (id, label, name, expr, sideVars = [], addAs = "number") =>
  ({ id, type: "ComputedColumnNode", init: { label, expr, addAs, ...(sideVars.length ? { sideVars } : {}) }, stringLiterals: { name } });
const getCol = (id, name) => ({ id, type: "GetColumnNode", init: { label: name }, stringLiterals: { name } });
const expr = (id, label, e) => ({ id, type: "ExpressionNode", init: { label, expr: e } });
const value = (id, label, v) => ({ id, type: "ValueInputNode", init: { label, value: String(v) } });
const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });
const at = (n, x, y) => Object.assign(n, { x, y });

/** In: Sites (with Incidents per Yr) and Days. Out, a value per run: drive hours, jobs served, the mean wait in days,
 *  and the incidents still open at the end. */
export function runsComposite({ id = "runs", label = "Monte Carlo runs", runs = 20, x = 0, y = 0 } = {}) {
  const nodes = [
    at({ id: "m_sites", type: "CompositeInputNode", init: { label: "Sites" } }, 0, 0),
    at({ id: "m_days", type: "CompositeInputNode", init: { label: "Days" } }, 0, 260),
    at({ id: "m_run", type: "CompositeInputNode", init: { label: "Run" } }, 0, 400),
    at(value("m_mph", "Average speed (mph)", 50), 0, 520),
    at(value("m_road", "Road factor", 1.25), 0, 660),
    // ── a year of incidents ──
    at({ id: "m_series", type: "SeriesNode", init: { label: "Each day", op: "range" }, literals: { start: 1, step: 1 } }, 300, 260),
    at({ id: "m_dayf", type: "FrameFromListsNode", init: { label: "Days", valueKeys: ["name0"] }, stringLiterals: { name0: "Day" } }, 600, 260),
    at({ id: "m_cross", type: "JoinNode", init: { label: "Every site, every day", how: "cross" } }, 900, 0),
    at(cc("m_hit", "Incident that day?", "Hit", "RAND() < @[Incidents per Yr] / 365", [], "logical"), 1220, 0),
    at({ id: "m_new", type: "FilterFrameNode", init: { label: "Incidents", condConfig: { 0: { op: "eq" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Hit", value0: "TRUE" } }, 1540, 0),
    at(cc("m_sev", "Severity", "Severity", "RANDBETWEEN(1, 5)"), 1860, 0),
    // ── the year dispatched ──
    // ── the rule ──
    at({ id: "m_score", type: "LambdaNode", init: { label: "Order by: severity, then age, then distance",
      params: "Severity, Day, Latitude, Longitude, last_Latitude, last_Longitude",
      expr: `HSTACK(-Severity, Day, IF(ISBLANK(last_Latitude), 0, ${KM}))` } }, 1860, 300),
    at({ id: "m_cost", type: "LambdaNode", init: { label: "Cost: drive minutes",
      params: "Latitude, Longitude, last_Latitude, last_Longitude",
      expr: `IF(ISBLANK(last_Latitude), 0, ${KM} * road / 1.609344 / mph * 60)` } }, 1860, 560),
    // ── the year dispatched ──
    at({ id: "m_queue", type: "GreedyQueueNode", init: { label: "Each operator, a day at a time" }, literals: { perStep: 1 },
      stringLiterals: { group: "Operator", step: "Day" } }, 2180, 0),
    at(getCol("m_dmin", "Cost"), 2820, 0),
    at(getCol("m_wait", "Wait"), 2820, 160),
    at(getCol("m_left", "Site"), 2820, 320),
    at(expr("m_hours", "Drive hours", "ROUND(minutes / 60, 1)"), 3140, 0),
    at(expr("m_jobs", "Jobs served", "COUNT(m)"), 3140, 160),
    at(expr("m_meanwait", "Mean wait (days)", "ROUND(AVERAGE(w), 2)"), 3140, 320),
    at(expr("m_open", "Still open", "COUNTA(s)"), 3140, 480),
    at({ id: "o_hours", type: "CompositeOutputNode", init: { label: "Drive hours" } }, 3460, 0),
    at({ id: "o_jobs", type: "CompositeOutputNode", init: { label: "Jobs served" } }, 3460, 160),
    at({ id: "o_wait", type: "CompositeOutputNode", init: { label: "Mean wait" } }, 3460, 320),
    at({ id: "o_open", type: "CompositeOutputNode", init: { label: "Still open" } }, 3460, 480),
  ];
  const connections = [
    wire("m_days", "value", "m_series", "stop"),
    wire("m_series", "list", "m_dayf", "vals0"),
    wire("m_sites", "value", "m_cross", "left"),
    wire("m_dayf", "frame", "m_cross", "right"),
    wire("m_cross", "frame", "m_hit", "frame"),
    wire("m_hit", "frame", "m_new", "frame"),
    wire("m_new", "frame", "m_sev", "frame"),
    wire("m_sev", "frame", "m_queue", "items"),
    wire("m_days", "value", "m_queue", "steps"),
    wire("m_score", "result", "m_queue", "order"),
    wire("m_cost", "result", "m_queue", "cost"),
    wire("m_road", "value", "m_cost", "road"),
    wire("m_mph", "value", "m_cost", "mph"),
    wire("m_queue", "picks", "m_dmin", "frame"),
    wire("m_queue", "picks", "m_wait", "frame"),
    wire("m_queue", "left", "m_left", "frame"),
    wire("m_queue", "total", "m_hours", "minutes"),
    wire("m_dmin", "values", "m_jobs", "m"),
    wire("m_wait", "values", "m_meanwait", "w"),
    wire("m_left", "values", "m_open", "s"),
    wire("m_hours", "result", "o_hours", "value"),
    wire("m_jobs", "result", "o_jobs", "value"),
    wire("m_meanwait", "result", "o_wait", "value"),
    wire("m_open", "result", "o_open", "value"),
  ];
  return {
    id, type: "CompositeNode", x, y,
    init: {
      label, runMode: "data-table",
      inputPorts: [
        { id: "in_sites", label: "Sites", exposure: "exposed", tier: "basic", internalNodeId: "m_sites" },
        { id: "in_days", label: "Days", exposure: "exposed", tier: "basic", internalNodeId: "m_days" },
        { id: "in_run", label: "Run", exposure: "exposed", tier: "basic", internalNodeId: "m_run" },
      ],
      outputPorts: [
        { id: "o_hours", label: "Drive hours", tier: "basic", internalNodeId: "o_hours" },
        { id: "o_jobs", label: "Jobs served", tier: "basic", internalNodeId: "o_jobs" },
        { id: "o_wait", label: "Mean wait", tier: "basic", internalNodeId: "o_wait" },
        { id: "o_open", label: "Still open", tier: "basic", internalNodeId: "o_open" },
      ],
      scenarios: [], dataTableValues: { in_run: Array.from({ length: runs }, (_, i) => i + 1) },
      internal: { nodes, connections },
    },
  };
}
