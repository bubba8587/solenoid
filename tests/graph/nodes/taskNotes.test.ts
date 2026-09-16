import { describe, it, expect } from "vitest";
import { TaskNotesNode } from "../../../src/graph/rete-nodes";
import { extractInit } from "../../../src/graph/copyPaste";
import { isCubeValue, isFrameValue } from "../../../src/graph/frame";

// The TaskNotes node's SHAPE: provider select reshapes sockets, the switch reports the
// departing keys for the prune, init round-trips. The API mapping is taskNotesApi.test.ts.

describe("TaskNotesNode", () => {
  it("defaults to Tasks with one cube output and no inputs; a stale provider falls back", () => {
    const n = new TaskNotesNode();
    expect(n.provider).toBe("tasks");
    expect(Object.keys(n.inputs)).toEqual([]);
    expect(Object.keys(n.outputs)).toEqual(["tasks"]);
    expect(new TaskNotesNode({ provider: "bogus" as never }).provider).toBe("tasks");
  });

  it("calendar = From/To inputs + an events frame; stats = one Status/Count frame", () => {
    const c = new TaskNotesNode({ provider: "calendar" });
    expect(Object.keys(c.inputs)).toEqual(["from", "to"]);
    expect(Object.keys(c.outputs)).toEqual(["events"]);
    const s = new TaskNotesNode({ provider: "stats" });
    expect(Object.keys(s.outputs)).toEqual(["stats"]);
  });

  it("keysDroppedBySwitch names the sockets a switch removes (both sides), and setProvider applies it", () => {
    const n = new TaskNotesNode({ provider: "calendar" });
    expect(n.keysDroppedBySwitch("stats")).toEqual({ inputs: ["from", "to"], outputs: ["events"] });
    expect(n.keysDroppedBySwitch("calendar")).toEqual({ inputs: [], outputs: [] });
    n.setProvider("tasks");
    expect(Object.keys(n.inputs)).toEqual([]);
    expect(Object.keys(n.outputs)).toEqual(["tasks"]);
  });

  it("provider + refreshMinutes round-trip through extractInit", () => {
    const init = extractInit(new TaskNotesNode({ provider: "stats", refreshMinutes: 15 }) as never);
    expect(init.provider).toBe("stats");
    expect(init.refreshMinutes).toBe(15);
  });

  it("a wired BLANK date on the calendar window fetches nothing and emits the empty events frame", () => {
    const n = new TaskNotesNode({ provider: "calendar" });
    const out = n.data({ from: [null], to: [null] });
    expect(isFrameValue(out.events)).toBe(true);
    expect((out.events as { columns: { values: unknown[] }[] }).columns[0].values).toEqual([]);
  });

  it("before any fetch the Tasks provider emits an empty cube (a cube, never null)", () => {
    const n = new TaskNotesNode();
    // The network gate + fetch run in the background; the sync answer is the empty shape.
    const out = n.data({});
    expect(isCubeValue(out.tasks)).toBe(true);
  });
});
