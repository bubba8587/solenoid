import { describe, it, expect } from "vitest";
import {
  tasksUrl, eventsUrl, statsUrl, authHeaders, isoToSerial, linkName, unwrap,
  parseTasksPage, tasksToCube, parseEvents, parseStats, taskRecord,
} from "../../src/graph/taskNotesApi";
import { parseDateToSerial, formatDateSerial } from "../../src/graph/nodes/dateSerial";
import { isCubeValue, isFrameValue, type FrameValue } from "../../src/graph/frame";

// Item F of the Obsidian bundle: the TaskNotes HTTP API's parse + cube mapping is pure
// and fixture-tested, one fixture per endpoint (shapes from the plugin's TaskInfo type).

const d = (s: string) => parseDateToSerial(s);
const iso = (v: unknown) => formatDateSerial(v as number, "YYYY-MM-DD");

const TASK_A = {
  id: "Tasks/Write the spec.md", path: "Tasks/Write the spec.md", title: "Write the spec",
  status: "open", priority: "high", due: "2026-09-12", scheduled: "2026-09-08", archived: false,
  tags: ["task", "docs"], contexts: ["desk"], projects: ["[[Solenoid 1.4]]"],
  timeEstimate: 240, dateCreated: "2026-09-01T09:00:00Z", dateModified: "2026-09-06T18:30:00Z",
  timeEntries: [
    { startTime: "2026-09-05T10:00:00Z", endTime: "2026-09-05T11:30:00Z", description: "outline" },
    { startTime: "2026-09-06T10:00:00Z" },
  ],
  complete_instances: ["2026-09-01", "2026-09-02"],
  blockedBy: [{ uid: "[[Tasks/Read the API docs|read]]", reltype: "FINISHTOSTART" }],
  customProperties: { client: "Acme", billable: true, effort: 3 },
};
const TASK_B = {
  path: "Tasks/Read the API docs.md", title: "Read the API docs", status: "done", priority: "normal",
  completedDate: "2026-09-04", archived: true, totalTrackedTime: 45, hours: 0.75,
};

const tasksFixture = (tasks: unknown[], pagination: Record<string, unknown>) =>
  JSON.stringify({ success: true, data: { tasks, pagination, vault: { name: "demo" } } });

describe("urls + auth", () => {
  it("builds the paged tasks, calendar-window and stats endpoints off the settings url", () => {
    expect(tasksUrl("http://localhost:8080/", 200)).toBe("http://localhost:8080/api/tasks?limit=200&offset=200");
    expect(tasksUrl("", 0, 999)).toBe("http://localhost:8080/api/tasks?limit=200&offset=0");
    expect(tasksUrl("localhost:8080", 0)).toBe("http://localhost:8080/api/tasks?limit=200&offset=0"); // a bare host gets its scheme
    expect(eventsUrl("http://127.0.0.1:9090", d("2026-09-07"), d("2026-09-14")))
      .toBe("http://127.0.0.1:9090/api/calendars/events?start=2026-09-07T00%3A00%3A00&end=2026-09-14T23%3A59%3A59");
    expect(statsUrl(" http://localhost:8080 ")).toBe("http://localhost:8080/api/stats");
  });
  it("a token becomes a bearer header; none → no header", () => {
    expect(authHeaders(" abc ")).toEqual({ Authorization: "Bearer abc" });
    expect(authHeaders("")).toEqual({});
  });
});

describe("value parsing", () => {
  it("dates and ISO datetimes → serials (a datetime keeps its fraction); blanks → null", () => {
    expect(isoToSerial("2026-09-12")).toBe(d("2026-09-12"));
    expect(isoToSerial("2026-09-05T12:00:00Z")).toBeCloseTo(d("2026-09-05") + 0.5, 9);
    expect(isoToSerial("")).toBeNull();
    expect(isoToSerial(undefined)).toBeNull();
    expect(isoToSerial("not a date")).toBeNull();
  });
  it("wikilinks and paths reduce to the note name", () => {
    expect(linkName("[[Solenoid 1.4]]")).toBe("Solenoid 1.4");
    expect(linkName("[[Tasks/Read the API docs|read]]")).toBe("Read the API docs");
    expect(linkName("Tasks/Read the API docs.md")).toBe("Read the API docs");
    expect(linkName(42)).toBe("");
  });
  it("unwrap reads the {success, data} envelope and throws the API's error text", () => {
    expect(unwrap('{"success":true,"data":{"a":1}}')).toEqual({ a: 1 });
    expect(() => unwrap('{"success":false,"error":"Unauthorized"}')).toThrow(/Unauthorized/);
    expect(() => unwrap("<html>")).toThrow(/not JSON/);
  });
});

describe("tasks → records → cube", () => {
  it("maps a full task: scalars, lists, nested time entries (minutes derived), instances, user fields", () => {
    const r = taskRecord(TASK_A);
    expect(r.path).toBe("Tasks/Write the spec.md");
    expect(iso(r.due)).toBe("2026-09-12");
    expect(r.projects).toEqual(["Solenoid 1.4"]);
    expect(r.blockedBy).toEqual(["Read the API docs"]);
    expect(r.timeEntries.columns.map((c) => c.name)).toEqual(["Start", "End", "Minutes", "Description"]);
    expect(r.timeEntries.columns[2].values).toEqual([90, null]); // a running entry has no minutes
    expect(r.trackedMinutes).toBe(90);
    expect(r.completeInstances.columns[0].values.map(iso)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(r.user).toEqual({ client: "Acme", billable: true, effort: 3 });
  });
  it("totalTrackedTime wins over derived minutes; unknown top-level keys are user fields, never dropped", () => {
    const r = taskRecord(TASK_B);
    expect(r.trackedMinutes).toBe(45);
    expect(r.archived).toBe(true);
    expect(iso(r.completed)).toBe("2026-09-04");
    expect(r.user).toEqual({ hours: 0.75 });
    expect(r.timeEntries.columns[0].values).toEqual([]);
  });
  it("a page reports hasMore from the pagination block (or total), and the next offset", () => {
    const p1 = parseTasksPage(tasksFixture([TASK_A], { total: 2, offset: 0, limit: 1, hasMore: true }), 0);
    expect(p1.tasks.length).toBe(1);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextOffset).toBe(1);
    const p2 = parseTasksPage(tasksFixture([TASK_B], { total: 2, offset: 1, limit: 1, hasMore: false }), 1);
    expect(p2.hasMore).toBe(false);
    const empty = parseTasksPage(tasksFixture([], { total: 2, offset: 2, limit: 200, hasMore: true }), 2);
    expect(empty.hasMore).toBe(false); // an empty page ends the loop even if the API says more
  });
  it("the cube: built-ins first, list cells, nested frames, then user fields in first-seen order", () => {
    const cube = tasksToCube([taskRecord(TASK_A), taskRecord(TASK_B)]);
    expect(isCubeValue(cube)).toBe(true);
    expect(cube.columns.map((c) => c.name)).toEqual([
      "path", "title", "status", "priority", "due", "scheduled", "completed", "timeEstimate", "trackedMinutes", "archived",
      "projects", "contexts", "tags", "blockedBy", "timeEntries", "complete_instances", "created", "modified",
      "client", "billable", "effort", "hours",
    ]);
    const col = (n: string) => cube.columns.find((c) => c.name === n)!;
    expect(col("tags").cells).toEqual([["task", "docs"], []]);
    expect(isFrameValue(col("timeEntries").cells[0])).toBe(true);
    expect(col("client").cells).toEqual(["Acme", null]);
    expect(col("hours").cells).toEqual([null, 0.75]);
    expect(col("due").type).toBe("date");
    expect(col("archived").cells).toEqual([false, true]);
  });
});

describe("calendar + stats", () => {
  it("events → Title · Start · End · Source", () => {
    const text = JSON.stringify({ success: true, data: { events: [
      { title: "Standup", start: "2026-09-08T09:00:00Z", end: "2026-09-08T09:15:00Z", source: "google" },
      { summary: "Dentist", startTime: "2026-09-09", endTime: "2026-09-09", provider: "ics" },
    ], total: 2 } });
    const f = parseEvents(text) as FrameValue;
    expect(f.columns.map((c) => c.name)).toEqual(["Title", "Start", "End", "Source"]);
    expect(f.columns[0].values).toEqual(["Standup", "Dentist"]);
    expect(iso(f.columns[1].values[1])).toBe("2026-09-09");
    expect(f.columns[3].values).toEqual(["google", "ics"]);
  });
  it("stats → the five counts, missing ones null", () => {
    expect(parseStats('{"success":true,"data":{"total":12,"completed":5,"active":7,"overdue":2,"archived":1}}'))
      .toEqual({ total: 12, completed: 5, active: 7, overdue: 2, archived: 1 });
    expect(parseStats('{"success":true,"data":{"total":1}}').overdue).toBeNull();
  });
});
