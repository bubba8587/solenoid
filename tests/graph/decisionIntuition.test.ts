// [[C122]] choiceLadder, [[C123]] decisionBlanks, [[C124]] dealBreakers, [[C125]] flipPoints, [[C126]] chainedDecisions
// Realistic scenarios, each with the answer a careful person would expect, written apart from the engine. A scenario the
// engine answers differently is either a fix or a recorded reason (`ruling`) why the math is right to differ.
import { describe, it, expect } from "vitest";
import { type DecisionNormalize } from "../../src/graph/frameOps";
import { decisionMatrix, decisionCube, flipPoints, resolveDecisionWeights, decisionCriteria, relateFramesToCube, relateCubeToFrame } from "./coreVerbs";
import type { FrameValue, CubeValue } from "../../src/graph/frame";
import { ChoiceLadderNode } from "../../src/graph/nodes/frame";
import { isSolError } from "../../src/graph/errorValue";
import scenarios from "../fixtures/decision-scenarios.json";

type Cols = { columns: { name: string; type: string; values: unknown[] }[] };
interface Expect {
  winner?: string; top?: string[]; notWinner?: string[]; ruledOut?: string[]; bestInside?: Record<string, string>;
  planIncludes?: string[]; planExcludes?: string[]; planFirst?: string; planExactly?: string[];
  fragile?: string; robust?: string; error?: boolean;
}
interface Scenario {
  id: string; title: string; kind: "dm" | "chain" | "flips" | "ladder"; options: Cols; child?: Cols; key?: string; nested?: string;
  grandchild?: Cols; grandKey?: string; grandNested?: string;
  weights?: Cols; limits?: Cols; normalize?: DecisionNormalize; close?: number; expect: Expect; why: string; ruling?: Record<string, string>;
}
const frame = (c?: Cols): FrameValue | null => (c ? ({ __frame: true, columns: c.columns } as unknown as FrameValue) : null);

/** What the engine answers, in the terms the expectations use. */
export function answer(s: Scenario): { error: boolean; ranked: string[]; ruledOut: string[]; bestInside: Record<string, string>; plan: string[]; flips: Record<string, { w: number; below: number | null; above: number | null }> } {
  const out = { error: false, ranked: [] as string[], ruledOut: [] as string[], bestInside: {} as Record<string, string>, plan: [] as string[], flips: {} as Record<string, { w: number; below: number | null; above: number | null }> };
  const norm = s.normalize ?? "max";
  const opts = frame(s.options)!, weights = frame(s.weights);
  const readRanking = (labels: unknown[], ranks: unknown[], ruled: unknown[] | undefined) => {
    labels.forEach((l, i) => {
      if (ranks[i] != null) out.ranked.push(String(l));
      else if (ruled?.[i] != null) out.ruledOut.push(String(l));
    });
  };
  try {
    if (s.kind === "ladder") {
      const n = new ChoiceLadderNode({ normalize: norm });
      if (s.close != null) n.literals.close = s.close;
      const r = n.data({ frame: [opts], weights: [weights], limits: [frame(s.limits)] }) as { frame: unknown };
      if (isSolError(r.frame)) { out.error = true; return out; }
      const plan = r.frame as FrameValue;
      out.plan = plan.columns[1].values.map(String);
      const p = (n.cachedChart as { payload?: { ruledOut?: string[] } } | null)?.payload;
      out.ruledOut = p?.ruledOut ?? [];
      return out;
    }
    if (s.kind === "chain") {
      let cube = relateFramesToCube(opts, frame(s.child)!, s.key!, s.nested!) as CubeValue;
      if (s.grandchild) cube = relateCubeToFrame(cube, frame(s.grandchild)!, s.grandKey!, s.grandNested!);
      const r = decisionCube(cube, weights, norm);
      const col = (name: string) => r.columns.find((c) => c.name === name)?.cells ?? [];
      readRanking(r.columns[0].cells, col("Rank"), col("Ruled out by"));
      r.columns[0].cells.forEach((l, i) => { const b = col(`Best in ${s.nested}`)[i]; if (b != null) out.bestInside[String(l)] = String(b); });
      return out;
    }
    const w = resolveDecisionWeights(weights, decisionCriteria(opts));
    const r = decisionMatrix(opts, w.weights, norm, false, w.normOverrides, w.bounds);
    const col = (name: string) => r.columns.find((c) => c.name === name)?.values ?? [];
    readRanking(r.columns[0].values, col("Rank"), col("Ruled out by"));
    if (s.kind === "flips") {
      const f = flipPoints(opts, weights, norm);
      f.columns[0].values.forEach((c, j) => {
        out.flips[String(c)] = { w: f.columns[1].values[j] as number, below: f.columns[2].values[j] as number | null, above: f.columns[4].values[j] as number | null };
      });
    }
  } catch (e) {
    if (isSolError(e)) { out.error = true; return out; }
    throw e;
  }
  return out;
}

/** Every expectation the engine misses, as a sentence. */
export function misses(s: Scenario): string[] {
  const a = answer(s), e = s.expect, m: string[] = [];
  if (e.error) { if (!a.error) m.push("expected an error"); return m; }
  if (a.error) return ["engine gave an error"];
  if (e.winner && a.ranked[0] !== e.winner) m.push(`winner ${a.ranked[0]} (expected ${e.winner}); ranked ${a.ranked.join(" > ")}`);
  if (e.top && e.top.some((t, i) => a.ranked[i] !== t)) m.push(`top ${a.ranked.slice(0, e.top.length).join(" > ")} (expected ${e.top.join(" > ")})`);
  for (const x of e.notWinner ?? []) if (a.ranked[0] === x) m.push(`${x} won`);
  for (const x of e.ruledOut ?? []) if (!a.ruledOut.includes(x)) m.push(`${x} not ruled out`);
  for (const [p, c] of Object.entries(e.bestInside ?? {})) if (a.bestInside[p] !== c) m.push(`best in ${p}: ${a.bestInside[p] ?? "none"} (expected ${c})`);
  for (const x of e.planIncludes ?? []) if (!a.plan.includes(x)) m.push(`plan lacks ${x}; plan ${a.plan.join(", ")}`);
  for (const x of e.planExcludes ?? []) if (a.plan.includes(x)) m.push(`plan has ${x}; plan ${a.plan.join(", ")}`);
  if (e.planFirst && a.plan[0] !== e.planFirst) m.push(`plan starts ${a.plan[0]} (expected ${e.planFirst}); plan ${a.plan.join(", ")}`);
  if (e.planExactly && (a.plan.length !== e.planExactly.length || e.planExactly.some((x) => !a.plan.includes(x)))) m.push(`plan ${a.plan.join(", ")} (expected ${e.planExactly.join(", ")})`);
  const near = (c: string) => { const f = a.flips[c]; if (!f) return null; const d = [f.below, f.above].filter((t): t is number => t != null).map((t) => Math.abs(t - f.w)); return d.length ? Math.min(...d) / Math.max(1e-9, Math.abs(f.w)) : Infinity; };
  if (e.fragile) { const n = near(e.fragile); if (n == null || n > 0.3) m.push(`${e.fragile} not fragile (nearest flip ${n == null ? "?" : (n * 100).toFixed(0) + "%"} away)`); }
  if (e.robust) { const n = near(e.robust); if (n != null && n < 0.5) m.push(`${e.robust} not robust (flip ${(n * 100).toFixed(0)}% away)`); }
  return m;
}

describe("decision scenarios against intuition", () => {
  for (const s of scenarios as unknown as Scenario[]) {
    it(`${s.id}: ${s.title}`, () => {
      const m = misses(s).filter((x) => !Object.keys(s.ruling ?? {}).some((k) => x.startsWith(k)));
      expect(m, s.why).toEqual([]);
    });
  }
});
