// [[per-doc-autosave-persistence#One capture per edit]]
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SavedGraph } from "../../src/graph/persistence";

const h = vi.hoisted(() => ({ id: "doc-1" as string | null, captures: [] as Array<{ keepDrafts?: boolean; graph?: unknown }> }));

vi.mock("../../src/graph/documentStore", () => ({
  documentStore: {
    currentId: () => h.id,
    captureCurrent: (opts?: { keepDrafts?: boolean; graph?: unknown }) => { h.captures.push({ ...opts }); return true; },
  },
}));

import { offerCapture, scheduleAutosave } from "../../src/graph/persistence";

const g = { v: 2, nodes: [], connections: [] } as unknown as SavedGraph;

beforeEach(() => { vi.useFakeTimers(); h.id = "doc-1"; h.captures = []; });
afterEach(() => { vi.useRealTimers(); });

describe("the autosave writes the history's capture when nothing changed since", () => {
  it("reuses a capture taken after the last edit", async () => {
    scheduleAutosave();
    offerCapture(g);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.captures).toEqual([{ keepDrafts: true, graph: g }]);
  });

  it("serializes again when an edit came after the capture", async () => {
    scheduleAutosave();
    offerCapture(g);
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.captures).toEqual([{ keepDrafts: true, graph: undefined }]);
  });

  it("serializes again when another document is on screen, and uses a capture once", async () => {
    scheduleAutosave();
    offerCapture(g);
    h.id = "doc-2";
    await vi.advanceTimersByTimeAsync(1000);
    h.id = "doc-1";
    expect(h.captures).toEqual([{ keepDrafts: true, graph: undefined }]);
    scheduleAutosave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.captures[1]).toEqual({ keepDrafts: true, graph: undefined });
  });
});
