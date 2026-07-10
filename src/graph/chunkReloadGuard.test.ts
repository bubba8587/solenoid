import { describe, it, expect } from "vitest";
import { shouldReloadForChunkError, type ReloadStore } from "./chunkReloadGuard";

// A store backed by a plain object, standing in for sessionStorage.
const memStore = (initial: string | null = null): ReloadStore & { value: string | null } => {
  const s = { value: initial } as { value: string | null };
  return { value: s.value, get: () => s.value, set: (v) => { s.value = v; } };
};

// A store that throws — private-browsing sessionStorage.
const throwingStore = (mode: "read" | "write"): ReloadStore => ({
  get: () => { if (mode === "read") throw new Error("SecurityError"); return null; },
  set: () => { throw new Error("SecurityError"); },
});

describe("shouldReloadForChunkError", () => {
  it("reloads once when nothing is stored, recording the timestamp", () => {
    const store = memStore(null);
    expect(shouldReloadForChunkError(1000, store)).toBe(true);
    expect(store.get()).toBe("1000"); // persisted, so the next call is guarded
  });

  it("does NOT reload again within the window (loop guard)", () => {
    const store = memStore("1000");
    expect(shouldReloadForChunkError(5000, store)).toBe(false); // 4s < 10s
  });

  it("reloads again after the window elapses (a later, unrelated stale deploy)", () => {
    const store = memStore("1000");
    expect(shouldReloadForChunkError(12_000, store)).toBe(true); // 11s > 10s
  });

  it("FAILS SAFE when the store can't be READ (private mode) — never reloads", () => {
    expect(shouldReloadForChunkError(1000, throwingStore("read"))).toBe(false);
  });

  it("FAILS SAFE when the store can't be WRITTEN (private mode) — never reloads", () => {
    // get() returns null (readable) but set() throws — still refuse, or it loops.
    expect(shouldReloadForChunkError(1000, throwingStore("write"))).toBe(false);
  });
});
