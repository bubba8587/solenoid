// [[C66]]
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A stand-in worker that runs one call at a time: src "wait:N" answers N ms after it starts, "throw" raises an uncaught error.
class FakeWorker {
  static made = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  private queue: { id: number; src: string }[] = [];
  private busy = false;
  private dead = false;
  constructor() { FakeWorker.made++; }
  postMessage(req: { id: number; src: string }) { this.queue.push(req); this.pump(); }
  terminate() { this.dead = true; }
  private pump() {
    if (this.busy || this.dead) return;
    const req = this.queue.shift();
    if (!req) return;
    this.busy = true;
    if (req.src === "throw") {
      setTimeout(() => { if (!this.dead) { this.busy = false; this.onerror?.({ message: "boom" }); this.pump(); } }, 10);
      return;
    }
    const ms = Number(req.src.slice(5));
    setTimeout(() => {
      if (this.dead) return;
      this.busy = false;
      this.onmessage?.({ data: { id: req.id, outcome: { ok: true, value: ms } } });
      this.pump();
    }, ms);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.made = 0;
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("executeScript — each call's time limit counts only its own run", () => {
  it("two 600 ms scripts sent together both finish", async () => {
    const { executeScript } = await import("../../src/graph/scriptExecutor");
    const a = executeScript("wait:600", []);
    const b = executeScript("wait:600", []);
    await vi.advanceTimersByTimeAsync(1300);
    expect(await a).toEqual({ ok: true, value: 600 });
    expect(await b).toEqual({ ok: true, value: 600 });
    expect(FakeWorker.made).toBe(1);
  });
  it("a call past the limit times out alone; the next call runs on a fresh worker", async () => {
    const { executeScript } = await import("../../src/graph/scriptExecutor");
    const slow = executeScript("wait:5000", []);
    const next = executeScript("wait:100", []);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await slow).toMatchObject({ ok: false, code: "#VALUE!" });
    expect(await next).toEqual({ ok: true, value: 100 });
  });
  it("an uncaught worker error fails the running call only", async () => {
    const { executeScript } = await import("../../src/graph/scriptExecutor");
    const bad = executeScript("throw", []);
    const good = executeScript("wait:50", []);
    await vi.advanceTimersByTimeAsync(200);
    expect(await bad).toMatchObject({ ok: false, message: "boom" });
    expect(await good).toEqual({ ok: true, value: 50 });
  });
});
