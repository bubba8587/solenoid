// [[save-format#A save loses nothing quietly]], [[per-doc-autosave-persistence#One capture per edit]]
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SavedGraph } from "../../src/graph/persistence";

const h = vi.hoisted(() => ({ id: "doc-1" as string | null, fresh: 0, captures: [] as Array<{ keepDrafts?: boolean; graph?: unknown }> }));

vi.mock("../../src/graph/documentStore", () => ({
  documentStore: {
    currentId: () => h.id,
    freshCaptures: () => h.fresh,
    captureCurrent: (opts?: { keepDrafts?: boolean; graph?: unknown }) => { h.captures.push({ ...opts }); return true; },
  },
}));

import { offerCapture, scheduleAutosave } from "../../src/graph/persistence";
import { commentStore } from "../../src/graph/commentStore";
import { pinStore } from "../../src/graph/pinStore";

const g = { v: 2, nodes: [], connections: [] } as unknown as SavedGraph;

beforeEach(() => { vi.useFakeTimers(); h.id = "doc-1"; h.fresh = 0; h.captures = []; });
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

  it("serializes again when a save wrote the canvas after the capture", async () => {
    scheduleAutosave();
    offerCapture(g);
    h.fresh++;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.captures).toEqual([{ keepDrafts: true, graph: undefined }]);
  });

  it("a comment or a pin made after the capture asks, so the stale capture isn't written", async () => {
    for (const edit of [() => commentStore.add("n1", "me", "hi"), () => pinStore.toggle("n1", "out")]) {
      h.captures = [];
      scheduleAutosave();
      offerCapture(g);
      edit();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.captures).toEqual([{ keepDrafts: true, graph: undefined }]);
    }
  });
});
