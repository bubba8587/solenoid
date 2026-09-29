// [[C66]]
// Main-thread client of the Script sandbox (tree/specs/computation/script-sandbox.md): one worker, one call in it at a
// time, the rest queued here. Without Workers the evaluator runs inline.
import { invokeScript, SCRIPT_TIMEOUT_MS, type ScriptOutcome } from "./nodes/scriptRun";

type Req = { id: number; src: string; args: unknown[] };
type Pending = { req: Req; resolve: (o: ScriptOutcome) => void };

let worker: Worker | null = null;
let seq = 0;
let running: { p: Pending; timer: ReturnType<typeof setTimeout> } | null = null;
const queue: Pending[] = [];

function finish(outcome: ScriptOutcome): void {
  if (!running) return;
  clearTimeout(running.timer);
  const { p } = running;
  running = null;
  p.resolve(outcome);
  next();
}

function retire(w: Worker): void {
  w.terminate();
  if (worker === w) worker = null;
}

function spawn(): Worker {
  const w = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<{ id: number; outcome: ScriptOutcome }>) => {
    if (running?.p.req.id === e.data.id) finish(e.data.outcome);
  };
  w.onerror = (e) => {
    retire(w);
    finish({ ok: false, code: "#VALUE!", message: e.message || "The script sandbox failed to start" });
  };
  return w;
}

function next(): void {
  if (running) return;
  const p = queue.shift();
  if (!p) return;
  const w = (worker ??= spawn());
  running = {
    p,
    timer: setTimeout(() => {
      retire(w);
      finish({ ok: false, code: "#VALUE!", message: `Timed out after ${SCRIPT_TIMEOUT_MS / 1000} s` });
    }, SCRIPT_TIMEOUT_MS),
  };
  try {
    w.postMessage(p.req);
  } catch (e) {
    finish({ ok: false, code: "#VALUE!", message: e instanceof Error ? e.message : String(e) });
  }
}

export function executeScript(src: string, args: unknown[]): Promise<ScriptOutcome> {
  // Clone as postMessage would, so a script mutating its argument never edits an upstream cached value.
  if (typeof Worker === "undefined") return invokeScript(src, structuredClone(args));
  return new Promise((resolve) => {
    queue.push({ req: { id: ++seq, src, args }, resolve });
    next();
  });
}
