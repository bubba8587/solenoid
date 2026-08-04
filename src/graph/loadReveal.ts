// Cinematic load reveal — the staged "build then draw in" animation a graph plays
// when it's loaded on startup or via File → Open. Document switches reuse ONLY the
// building phase as a plain progress curtain (rebuildGraph's `curtain` path) —
// they snap to idle from loadGraph's finally, never entering "revealing".
// A module-level store holds the phase + per-connection reveal flags; the
// orchestration lives in persistence.ts's rebuildGraph. Nodes fade in via their
// area-view element's opacity (transform would clobber rete's position translate);
// cables read this store and both fade + draw on in input→output order.
//
//   idle      → nothing animating; components render normally.
//   building  → graph being constructed behind the progress overlay; cables hide.
//   revealing → overlay fading, nodes/cables animating in wave by wave.

import { createNotifier } from "./storeKit";
import { clamp } from "./nodes/mathUtils";

export type RevealPhase = "idle" | "building" | "revealing";

const { notify, subscribe } = createNotifier();
let _phase: RevealPhase = "idle";
let _progress = 0; // 0..1, accurate during `building`
const _revealedConns = new Set<string>();

export const loadRevealStore = {
  subscribe,
  /** True whenever a reveal is in progress (building OR revealing) — components
   *  hide not-yet-revealed elements while this holds. */
  isActive: (): boolean => _phase !== "idle",
  phase: (): RevealPhase => _phase,
  progress: (): number => _progress,
  isConnRevealed: (id: string): boolean => _revealedConns.has(id),

  /** Enter the build phase (progress bar shows, everything hidden). */
  begin(): void {
    _phase = "building";
    _progress = 0;
    _revealedConns.clear();
    notify();
  },
  setProgress(p: number): void {
    _progress = clamp(p, 0, 1);
    notify();
  },
  /** Build done — overlay fades, the staged reveal begins. */
  startReveal(): void {
    _phase = "revealing";
    _progress = 1;
    notify();
  },
  revealConn(id: string): void {
    if (_revealedConns.has(id)) return;
    _revealedConns.add(id);
    notify();
  },
  /** Back to idle (everything shown). Always runs in a finally so a failed load
   *  can never leave the canvas stuck hidden. */
  finish(): void {
    if (_phase === "idle" && _revealedConns.size === 0) return;
    _phase = "idle";
    _revealedConns.clear();
    notify();
  },
};

/**
 * Rough input→output layering for the reveal order (Kahn longest-path): a node
 * sits one level deeper than its deepest source, so sources reveal first and the
 * graph fills toward its sinks. Self-loops are ignored for layering; nodes that
 * never resolve a depth (a genuine cycle) are flushed into a final wave so
 * nothing is dropped. Pure + unit-tested.
 */
export function revealWaves(
  nodeIds: string[],
  edges: ReadonlyArray<{ source: string; target: string }>,
): string[][] {
  if (nodeIds.length === 0) return [];
  const ids = new Set(nodeIds);
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of nodeIds) { indeg.set(id, 0); out.set(id, []); }
  for (const e of edges) {
    if (e.source === e.target) continue;                 // self-loop
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    out.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const id of nodeIds) if ((indeg.get(id) ?? 0) === 0) { depth.set(id, 0); queue.push(id); }
  while (queue.length) {
    const v = queue.shift()!;
    const dv = depth.get(v) ?? 0;
    for (const w of out.get(v) ?? []) {
      depth.set(w, Math.max(depth.get(w) ?? 0, dv + 1));
      const d = (indeg.get(w) ?? 0) - 1;
      indeg.set(w, d);
      if (d === 0) queue.push(w);
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const cycleDepth = maxDepth + 1;                       // unresolved (cyclic) → back
  let hadCycle = false;
  for (const id of nodeIds) if (!depth.has(id)) { depth.set(id, cycleDepth); hadCycle = true; }
  const waveCount = (hadCycle ? cycleDepth : maxDepth) + 1;
  const waves: string[][] = Array.from({ length: waveCount }, () => []);
  for (const id of nodeIds) waves[depth.get(id)!].push(id);
  return waves.filter((w) => w.length > 0);
}
