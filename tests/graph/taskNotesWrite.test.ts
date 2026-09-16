import { describe, it, expect } from "vitest";
import { cellToTaskField, planTaskRow, planTaskWrites, taskPlanFrame, taskUrl, createTaskUrl, parseWrittenTaskPath } from "../../src/graph/taskNotesApi";
import { WriteTasksNode } from "../../src/graph/rete-nodes";
import { cubeFromColumns, isFrameValue } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { solError } from "../../src/graph/errorValue";

// F6 Write Tasks: rows → the API's create/update payloads and the plan frame, pure.

describe("cellToTaskField", () => {
  it("dates from serials or text → YYYY-MM-DD; lists from arrays or comma text; blocked-by as links", () => {
    expect(cellToTaskField("due", parseDateToSerial("2026-09-12"))).toBe("2026-09-12");
    expect(cellToTaskField("scheduled", "2026-09-08")).toBe("2026-09-08");
    expect(cellToTaskField("tags", ["a", " b "])).toEqual(["a", "b"]);
    expect(cellToTaskField("projects", "Solenoid 1.4, Vault")).toEqual(["Solenoid 1.4", "Vault"]);
    expect(cellToTaskField("blockedBy", ["[[Tasks/Read the docs|read]]"])).toEqual([{ uid: "[[Read the docs]]", reltype: "FINISHTOSTART" }]);
    expect(cellToTaskField("timeEstimate", "90")).toBe(90);
    expect(cellToTaskField("priority", "high")).toBe("high");
  });
  it("blank, a nested table, or an unreadable date is not sent", () => {
    expect(cellToTaskField("title", null)).toBeUndefined();
    expect(cellToTaskField("title", "")).toBeUndefined();
    expect(cellToTaskField("due", "soon")).toBeUndefined();
    expect(cellToTaskField("details", { __frame: true, columns: [] })).toBeUndefined();
  });
});

describe("planTaskRow / planTaskWrites", () => {
  it("a row with a path updates; without one it creates from its title; nothing to send skips", () => {
    expect(planTaskRow({ path: "Tasks/A.md", status: "done" }, []).action).toBe("update");
    const c = planTaskRow({ title: "New", due: parseDateToSerial("2026-10-01"), trackedMinutes: 5 }, []);
    expect(c.action).toBe("create");
    expect(c.payload).toEqual({ title: "New", due: "2026-10-01" }); // trackedMinutes is read-only → not sent
    expect(planTaskRow({ path: "Tasks/A.md" }, []).action).toBe("skip");
    expect(planTaskRow({ due: parseDateToSerial("2026-10-01") }, []).action).toBe("skip"); // a create needs a title
  });
  it("keys narrows the fields; path never becomes a field", () => {
    const r = planTaskRow({ path: "Tasks/A.md", title: "A", status: "open", priority: "high" }, ["status", "path"]);
    expect(r.payload).toEqual({ status: "open" });
    expect(r.title).toBe("A");
  });
  it("the plan frame carries path · title · action · fields, with Preview's resolutions overriding", () => {
    const cube = cubeFromColumns([
      { name: "path", cells: ["Tasks/A.md", null] },
      { name: "title", cells: ["A", "B"] },
      { name: "tags", cells: [["x"], ["y", "z"]] },
    ]);
    const plan = planTaskWrites(cube, []);
    expect(plan.map((r) => r.action)).toEqual(["update", "create"]);
    const f = taskPlanFrame(plan, new Map([[0, "unchanged"]]));
    expect(f.columns.map((c) => c.name)).toEqual(["path", "title", "action", "fields"]);
    expect(f.columns[2].values).toEqual(["unchanged", "create"]);
    expect(f.columns[3].values).toEqual(["title, tags", "title, tags"]);
  });
});

describe("urls + replies", () => {
  it("PUT addresses the URL-encoded task path; POST the collection", () => {
    expect(taskUrl("http://localhost:8080", "Tasks/Read docs.md")).toBe("http://localhost:8080/api/tasks/Tasks%2FRead%20docs.md");
    expect(createTaskUrl("")).toBe("http://localhost:8080/api/tasks");
  });
  it("a created task's path is read off the reply when present", () => {
    expect(parseWrittenTaskPath('{"success":true,"data":{"path":"Tasks/New.md","title":"New"}}')).toBe("Tasks/New.md");
    expect(parseWrittenTaskPath('{"success":true,"data":{}}')).toBeNull();
  });
});

describe("WriteTasksNode", () => {
  it("loads disarmed, caches the rows and emits the plan; a frame widens to a cube upstream", () => {
    const n = new WriteTasksNode();
    expect(n.enabled).toBe(false);
    const cube = cubeFromColumns([{ name: "title", cells: ["A"] }, { name: "status", cells: ["open"] }]);
    const out = n.data({ tasks: [cube] });
    expect(isFrameValue(out.plan)).toBe(true);
    expect((out.plan as { columns: { values: unknown[] }[] }).columns[2].values).toEqual(["create"]);
    expect(n.data({ tasks: [null] }).plan).toBeNull();
    const err = solError("#VALUE!", "x");
    expect(n.data({ tasks: [err] }).plan).toBe(err);
  });
  it("run refuses while disarmed, and with nothing to write, without touching the network", async () => {
    const n = new WriteTasksNode();
    n.data({ tasks: [cubeFromColumns([{ name: "title", cells: ["A"] }])] });
    await n.run();
    expect(n.status).toBe("error");
    expect(n.statusMessage).toMatch(/Arm/);
    n.enabled = true;
    n.data({ tasks: [null] });
    await n.run();
    expect(n.statusMessage).toMatch(/Nothing to write/);
  });
  it("the keys literal narrows the plan's fields", () => {
    const n = new WriteTasksNode();
    n.stringLiterals.keys = "status";
    const cube = cubeFromColumns([{ name: "path", cells: ["Tasks/A.md"] }, { name: "title", cells: ["A"] }, { name: "status", cells: ["done"] }]);
    const out = n.data({ tasks: [cube] });
    expect((out.plan as { columns: { values: unknown[] }[] }).columns[3].values).toEqual(["status"]);
  });
});
