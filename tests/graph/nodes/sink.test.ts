import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractInit } from "../../../src/graph/copyPaste";
import { frameToCsvText, frameToJsonText, WriteFileNode } from "../../../src/graph/nodes/sink";
import type { FrameValue } from "../../../src/graph/frame";
import { solError } from "../../../src/graph/errorValue";

// The one standing rule for a sink node (see CLAUDE.md "Verifying UI changes" /
// subsystem-invariants): a write must NEVER fire during a normal recompute,
// only on an explicit command. That's the invariant these tests exist to pin
// down, alongside the serializers and the "enabled never persists" safety
// default (see nodes/sink.ts file header for why).

const { writeTextFileMock, renameMock } = vi.hoisted(() => ({
  writeTextFileMock: vi.fn(async (_path: string, _content: string) => {}),
  renameMock: vi.fn(async (_from: string, _to: string) => {}),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  readDir: vi.fn(),
  writeTextFile: writeTextFileMock,
  rename: renameMock,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ join: vi.fn(async (a: string, b: string) => `${a}/${b}`) }));

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  writeTextFileMock.mockClear();
  renameMock.mockClear();
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const sample: FrameValue = {
  __frame: true,
  columns: [
    { name: "Name", type: "string", values: ["Ada", "Bo", null] },
    { name: "Score", type: "number", values: [12, null, solError("#DIV/0!", "divide by zero")] },
    { name: "Pass", type: "logical", values: [true, false, null] },
  ],
};

describe("frameToCsvText / frameToJsonText", () => {
  it("renders a CSV header + rows, TRUE/FALSE, error codes, and empty missing cells", () => {
    const lines = frameToCsvText(sample).trim().split(/\r?\n/);
    expect(lines[0]).toBe("Name,Score,Pass");
    expect(lines[1]).toBe("Ada,12,TRUE");
    expect(lines[2]).toBe("Bo,,FALSE");
    expect(lines[3]).toBe(",#DIV/0!,");
  });

  it("renders JSON as an array of row records — null for missing, the code for an error cell", () => {
    const json = JSON.parse(frameToJsonText(sample));
    expect(json).toEqual([
      { Name: "Ada", Score: 12, Pass: true },
      { Name: "Bo", Score: null, Pass: false },
      { Name: null, Score: "#DIV/0!", Pass: null },
    ]);
  });
});

describe("WriteFileNode persistence", () => {
  it("persists path + format through extractInit, but NEVER persists enabled — a reload always starts disarmed", () => {
    const n = new WriteFileNode({ path: "C:/out/data.json", format: "json" });
    n.enabled = true;
    const init = extractInit(n);
    expect(init.path).toBe("C:/out/data.json");
    expect(init.format).toBe("json");
    expect(init.enabled).toBeUndefined();
    const reloaded = new WriteFileNode(init);
    expect(reloaded.path).toBe("C:/out/data.json");
    expect(reloaded.format).toBe("json");
    expect(reloaded.enabled).toBe(false);
  });

  it("defaults format to csv", () => {
    expect(new WriteFileNode().format).toBe("csv");
  });
});

describe("WriteFileNode.run() — the sink discipline (format defaults to csv)", () => {
  it("data() only caches the incoming frame for the preview — never touches disk", () => {
    const n = new WriteFileNode({ path: "C:/out/data.csv" });
    n.enabled = true;
    n.data({ in: [sample] });
    expect(n.cachedFrame).toBe(sample);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("refuses to write when disarmed", async () => {
    const n = new WriteFileNode({ path: "C:/out/data.csv" });
    n.data({ in: [sample] });
    await n.run();
    expect(n.status).toBe("error");
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("refuses to write with no path set", async () => {
    const n = new WriteFileNode();
    n.enabled = true;
    n.data({ in: [sample] });
    await n.run();
    expect(n.status).toBe("error");
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("refuses to write with nothing on the input cable", async () => {
    const n = new WriteFileNode({ path: "C:/out/data.csv" });
    n.enabled = true;
    await n.run();
    expect(n.status).toBe("error");
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("writes ONLY on an explicit, armed run() with a path and a connected frame", async () => {
    const n = new WriteFileNode({ path: "C:/out/data.csv" });
    n.enabled = true;
    n.data({ in: [sample] });
    await n.run();
    expect(n.status).toBe("ok");
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe("C:/out/data.csv.tmp"); // atomic write: temp then rename
    expect(content).toContain("Name,Score,Pass");
    expect(renameMock).toHaveBeenCalledWith("C:/out/data.csv.tmp", "C:/out/data.csv");
  });
});

describe("WriteFileNode.run() — format: json", () => {
  it("writes the JSON serialization only when armed", async () => {
    const n = new WriteFileNode({ path: "C:/out/data.json", format: "json" });
    n.enabled = true;
    n.data({ in: [sample] });
    await n.run();
    expect(n.status).toBe("ok");
    const [, content] = writeTextFileMock.mock.calls[0];
    expect(JSON.parse(content)[0]).toEqual({ Name: "Ada", Score: 12, Pass: true });
  });
});
