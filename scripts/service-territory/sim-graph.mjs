// The dispatch Monte Carlo: a Composite in Data Table mode, a pass per run. Each pass draws a year of incidents (each
// site, each day, an incident with its daily share of the site's yearly rate, a severity of 1 to 5) and runs them
// through the Greedy Queue card, a queue per operator a day at a time. The dispatch rule is the two LAMBDA cards beside
// it: Order by the Severity column, largest first, then a LAMBDA for the longest waiting and the nearest to the last stop
// (the Earth & Sky pack's great-circle formula), and a Cost formula for the drive in hours. An operator starts at their first job.

// The Earth & Sky pack's Great-Circle Distance in km, from the last stop to this incident.
const KM = "2*6371.0088*ASIN(SQRT(SIN((Latitude-last_Latitude)*PI()/360)^2+COS(last_Latitude*PI()/180)*COS(Latitude*PI()/180)*SIN((Longitude-last_Longitude)*PI()/360)^2))";

const cc = (id, label, name, expr, sideVars = [], addAs = "number") =>
  ({ id, type: "ComputedColumnNode", init: { label, expr, addAs, ...(sideVars.length ? { sideVars } : {}) }, stringLiterals: { name } });
const getCol = (id, name) => ({ id, type: "GetColumnNode", init: { label: name }, stringLiterals: { name } });
const value = (id, label, v) => ({ id, type: "ValueInputNode", init: { label, value: String(v) } });
const wire = (source, sourceOutput, target, targetInput) => ({ source, sourceOutput, target, targetInput });
const at = (n, x, y) => Object.assign(n, { x, y });

/** In: Sites (with Incidents per Yr, Plan B Operator and Plan C Operator) and Days. Out, a value per run: drive hours, jobs served, the mean
 *  wait in days, the incidents still open at the end, Plan B's and Plan C's drive hours on the same incidents and what each saves, and the incidents each plan leaves open. */
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
    at({ id: "m_cross", type: "JoinNode", init: { label: "Site-days", how: "cross" } }, 900, 0),
    at(cc("m_hit", "Incident that day?", "Hit", "RAND() < @[Incidents per Yr] / 365", [], "logical"), 1220, 0),
    at({ id: "m_new", type: "FilterFrameNode", init: { label: "Incidents", condConfig: { 0: { op: "eq" } }, valueKeys: ["frame", "column0", "value0"] }, stringLiterals: { column0: "Hit", value0: "TRUE" } }, 1540, 0),
    at(cc("m_sev", "Severity", "Severity", "RANDBETWEEN(1, 5)"), 1860, 0),
    // ── the year dispatched ──
    // ── the rule ──
    at({ id: "m_score", type: "LambdaNode", init: { label: "Oldest, then nearest",
      params: "Day, Latitude, Longitude, last_Latitude, last_Longitude",
      expr: `HSTACK(Day, IF(ISBLANK(last_Latitude), 0, ${KM}))` } }, 1860, 300),
    at({ id: "m_cost", type: "LambdaNode", init: { label: "Leg drive hours",
      params: "Latitude, Longitude, last_Latitude, last_Longitude",
      expr: `IF(ISBLANK(last_Latitude), 0, ${KM} * road / 1.609344 / mph)` } }, 1860, 560),
    // ── the year dispatched ──
    at({ id: "m_queue", type: "GreedyQueueNode", init: { label: "Daily dispatch", orderDir: "desc" },
      stringLiterals: { group: "Operator", step: "Day", orderColumn: "Severity" } }, 2180, 0),
    at(value("m_jobs_day", "Jobs per operator per day", 1), 1860, 820),
    at({ id: "m_queue_b", type: "GreedyQueueNode", init: { label: "Daily dispatch (Plan B)", orderDir: "desc" },
      stringLiterals: { group: "Plan B Operator", step: "Day", orderColumn: "Severity" } }, 2180, 700),
    at({ id: "m_saved", type: "ArithmeticNode", init: { label: "Plan B saving", op: "sub" } }, 3140, 860),
    // Plan C: each site with the operator whose home base is fewest incident-miles away (the Solver outside).
    at({ id: "m_queue_c", type: "GreedyQueueNode", init: { label: "Daily dispatch (Plan C)", orderDir: "desc" },
      stringLiterals: { group: "Plan C Operator", step: "Day", orderColumn: "Severity" } }, 2180, 1100),
    at({ id: "m_saved_c", type: "ArithmeticNode", init: { label: "Plan C saving", op: "sub" } }, 3140, 1160),
    at(getCol("m_left_c", "Site"), 2820, 1320),
    at(getCol("m_left_b", "Site"), 2820, 1020),
    at({ id: "m_open_b", type: "ListLengthNode", init: { label: "Still open (Plan B)" } }, 3140, 1020),
    at({ id: "o_open_b", type: "CompositeOutputNode", init: { label: "Still open (Plan B)" } }, 3460, 1480),
    at({ id: "m_open_c", type: "ListLengthNode", init: { label: "Still open (Plan C)" } }, 3140, 1320),
    at({ id: "o_hours_c", type: "CompositeOutputNode", init: { label: "Plan C drive hours" } }, 3460, 1020),
    at({ id: "o_saved_c", type: "CompositeOutputNode", init: { label: "Hours Plan C saves" } }, 3460, 1160),
    at({ id: "o_open_c", type: "CompositeOutputNode", init: { label: "Still open (Plan C)" } }, 3460, 1320),
    at({ id: "o_hours_b", type: "CompositeOutputNode", init: { label: "Plan B drive hours" } }, 3460, 700),
    at({ id: "o_saved", type: "CompositeOutputNode", init: { label: "Hours Plan B saves" } }, 3460, 860),
    at(getCol("m_dmin", "Cost"), 2820, 0),
    at(getCol("m_wait", "Wait"), 2820, 160),
    at(getCol("m_left", "Site"), 2820, 320),
    at({ id: "m_jobs", type: "AggregateNode", init: { label: "Jobs served", op: "count" } }, 3140, 160),
    at({ id: "m_meanwait", type: "AggregateNode", init: { label: "Mean wait (days)", op: "avg" } }, 3140, 320),
    at({ id: "m_open", type: "ListLengthNode", init: { label: "Still open" } }, 3140, 480),
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
    wire("m_jobs_day", "value", "m_queue", "perStep"),
    wire("m_sev", "frame", "m_queue_b", "items"),
    wire("m_days", "value", "m_queue_b", "steps"),
    wire("m_jobs_day", "value", "m_queue_b", "perStep"),
    wire("m_score", "result", "m_queue_b", "order"),
    wire("m_cost", "result", "m_queue_b", "cost"),
    wire("m_sev", "frame", "m_queue_c", "items"),
    wire("m_days", "value", "m_queue_c", "steps"),
    wire("m_jobs_day", "value", "m_queue_c", "perStep"),
    wire("m_score", "result", "m_queue_c", "order"),
    wire("m_cost", "result", "m_queue_c", "cost"),
    wire("m_queue", "total", "m_saved_c", "a"),
    wire("m_queue_c", "total", "m_saved_c", "b"),
    wire("m_queue_c", "total", "o_hours_c", "value"),
    wire("m_saved_c", "result", "o_saved_c", "value"),
    wire("m_queue_c", "left", "m_left_c", "frame"),
    wire("m_queue_b", "left", "m_left_b", "frame"),
    wire("m_left_b", "values", "m_open_b", "list"),
    wire("m_open_b", "result", "o_open_b", "value"),
    wire("m_left_c", "values", "m_open_c", "list"),
    wire("m_open_c", "result", "o_open_c", "value"),
    wire("m_queue", "total", "m_saved", "a"),
    wire("m_queue_b", "total", "m_saved", "b"),
    wire("m_queue_b", "total", "o_hours_b", "value"),
    wire("m_saved", "result", "o_saved", "value"),
    wire("m_score", "result", "m_queue", "order"),
    wire("m_cost", "result", "m_queue", "cost"),
    wire("m_road", "value", "m_cost", "road"),
    wire("m_mph", "value", "m_cost", "mph"),
    wire("m_queue", "picks", "m_dmin", "frame"),
    wire("m_queue", "picks", "m_wait", "frame"),
    wire("m_queue", "left", "m_left", "frame"),
    wire("m_dmin", "values", "m_jobs", "list"),
    wire("m_wait", "values", "m_meanwait", "list"),
    wire("m_left", "values", "m_open", "list"),
    wire("m_queue", "total", "o_hours", "value"),
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
        { id: "o_hours_b", label: "Plan B drive hours", tier: "basic", internalNodeId: "o_hours_b" },
        { id: "o_saved", label: "Hours Plan B saves", tier: "basic", internalNodeId: "o_saved" },
        { id: "o_hours_c", label: "Plan C drive hours", tier: "basic", internalNodeId: "o_hours_c" },
        { id: "o_saved_c", label: "Hours Plan C saves", tier: "basic", internalNodeId: "o_saved_c" },
        { id: "o_open_b", label: "Still open (Plan B)", tier: "basic", internalNodeId: "o_open_b" },
        { id: "o_open_c", label: "Still open (Plan C)", tier: "basic", internalNodeId: "o_open_c" },
      ],
      scenarios: [], dataTableValues: { in_run: Array.from({ length: runs }, (_, i) => i + 1) },
      internal: { nodes, connections },
    },
  };
}
