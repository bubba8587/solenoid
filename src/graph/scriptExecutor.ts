// [[C66]]
// Main-thread client of the Script sandbox: one shared worker. A call past SCRIPT_TIMEOUT_MS is answered here and the
// worker terminated; the other in-flight calls re-run on the replacement. Without Workers the evaluator runs inline.
import { invokeScript, SCRIPT_TIMEOUT_MS, type ScriptOutcome } from "./nodes/scriptRun";

type Req = { id: number; src: string; args: unknown[] };
type Pending = { req: Req; resolve: (o: ScriptOutcome) => void; timer: ReturnType<typeof setTimeout> | null };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function settle(p: Pending, outcome: ScriptOutcome): void {
  if (p.timer !== null) clearTimeout(p.timer);
  pending.delete(p.req.id);
  p.resolve(outcome);
}

function spawn(): Worker {
  const w = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; outcome: ScriptOutcome }>) => {
    const p = pending.get(e.data.id);
    if (p) settle(p, e.data.outcome);
  };
  // The sandbox itself failed: every in-flight call gets the reason, and the next call tries a fresh worker.
  w.onerror = (e) => {
    const message = e.message || "The script sandbox failed to start";
    for (const p of [...pending.values()]) settle(p, { ok: false, code: "#VALUE!", message });
    w.terminate();
    if (worker === w) worker = null;
  };
  return w;
}

function dispatch(w: Worker, p: Pending): void {
  p.timer = setTimeout(() => onTimeout(p), SCRIPT_TIMEOUT_MS);
  try {
    w.postMessage(p.req);
  } catch (e) {
    settle(p, { ok: false, code: "#VALUE!", message: e instanceof Error ? e.message : String(e) });
  }
}

function onTimeout(p: Pending): void {
  if (!pending.has(p.req.id)) return;
  settle(p, { ok: false, code: "#VALUE!", message: `Timed out after ${SCRIPT_TIMEOUT_MS / 1000} s` });
  worker?.terminate();
  worker = spawn();
  for (const q of pending.values()) {
    if (q.timer !== null) clearTimeout(q.timer);
    dispatch(worker, q);
  }
}

export function executeScript(src: string, args: unknown[]): Promise<ScriptOutcome> {
  // Clone as postMessage would, so a script mutating its argument never edits an upstream cached value.
  if (typeof Worker === "undefined") return invokeScript(src, structuredClone(args));
  return new Promise((resolve) => {
    worker ??= spawn();
    const p: Pending = { req: { id: ++seq, src, args }, resolve, timer: null };
    pending.set(p.req.id, p);
    dispatch(worker, p);
  });
}
