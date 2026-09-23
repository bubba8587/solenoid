// [[C43]] oneFlowSurface (tree/specs/documents/graph-load-teardown-performance.md)
// Inert unless `window.__solenoidPerf = true`; `window.__solenoidStats()` dumps the tables.

export function perfEnabled(): boolean {
  return Boolean((globalThis as { __solenoidPerf?: boolean }).__solenoidPerf);
}

interface NodeStat { type: string; calls: number; totalMs: number; maxMs: number }
interface IpcStat { calls: number; totalMs: number; maxMs: number; bytes: number }

const nodeStats = new Map<string, NodeStat>();
const ipcStats = new Map<string, IpcStat>();

let ipcCalls = 0;
let ipcMs = 0;

let passBuffer: Array<{ id: string; type: string; ms: number }> = [];

export function recordNode(id: string, type: string, ms: number): void {
  passBuffer.push({ id, type, ms });
  const s = nodeStats.get(id);
  if (s) { s.calls++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms; }
  else nodeStats.set(id, { type, calls: 1, totalMs: ms, maxMs: ms });
}

export function recordIpc(command: string, ms: number, bytes: number): void {
  ipcCalls++; ipcMs += ms;
  const s = ipcStats.get(command);
  if (s) { s.calls++; s.totalMs += ms; s.bytes += bytes; if (ms > s.maxMs) s.maxMs = ms; }
  else ipcStats.set(command, { calls: 1, totalMs: ms, maxMs: ms, bytes });
}

export function ipcSnapshot(): { calls: number; ms: number } {
  return { calls: ipcCalls, ms: ipcMs };
}

export function beginPass(): void {
  passBuffer = [];
}

export function passTopNodes(n: number): Array<{ id: string; type: string; ms: number }> {
  return [...passBuffer].sort((a, b) => b.ms - a.ms).slice(0, n);
}

function dumpStats(): void {
  const nodes = [...nodeStats.entries()]
    .map(([id, s]) => ({ id, type: s.type, calls: s.calls, totalMs: +s.totalMs.toFixed(1), avgMs: +(s.totalMs / s.calls).toFixed(2), maxMs: +s.maxMs.toFixed(1) }))
    .sort((a, b) => b.totalMs - a.totalMs);
  const ipc = [...ipcStats.entries()]
    .map(([command, s]) => ({ command, calls: s.calls, totalMs: +s.totalMs.toFixed(1), avgMs: +(s.totalMs / s.calls).toFixed(2), maxMs: +s.maxMs.toFixed(1), KB: +(s.bytes / 1024).toFixed(1) }))
    .sort((a, b) => b.totalMs - a.totalMs);
  /* eslint-disable no-console */
  console.log(`[perf] node data() — cumulative (${nodes.length} nodes)`);
  console.table(nodes);
  console.log(`[perf] engine IPC — cumulative (${ipcCalls} calls, ${ipcMs.toFixed(0)}ms total)`);
  console.table(ipc);
  /* eslint-enable no-console */
}

function resetStats(): void {
  nodeStats.clear();
  ipcStats.clear();
  ipcCalls = 0; ipcMs = 0;
  passBuffer = [];
}

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__solenoidStats = dumpStats;
  (globalThis as Record<string, unknown>).__solenoidStatsReset = resetStats;
}
