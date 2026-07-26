import { describe, it, expect } from "vitest";
import { FLAT_CATALOG } from "./catalogUtils";
import { getPassthrough } from "./nodes/passthrough";
import { MutableSocket, SolenoidSocket, isWildcardType } from "./sockets";

// ─── The precondition for "adoption is the only type resolver" ────────────────
// `reconcileTrueAnyTypes` writes a passthrough's resolved type onto its output
// socket, but ONLY when that socket is a MutableSocket:
//
//     const outSock = node.outputs?.[spec.output]?.socket;
//     if (!(outSock instanceof MutableSocket)) continue;
//
// So a node that DECLARES a passthrough while carrying a shared, immutable output
// singleton is silently skipped: adoption computes its type and throws it away, and
// anything downstream that reads the socket sees a stale placeholder forever. That
// is invisible — nothing errors, the dot just never colours.
//
// This sweeps the whole catalog so the invariant can't rot. It is also what lets
// `displayedType` stop re-deriving types with its own graph walk (2026-07-25): every
// passthrough's answer is already ON the socket by the time anything renders.
describe("a passthrough's WILDCARD output socket is mutable, so adoption can write it", () => {
  it("holds across the entire node catalog", () => {
    const offenders: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let n: unknown;
      try { n = entry.create(); } catch { continue; } // constructability is another test's job
      const node = n as { outputs?: Record<string, { socket?: unknown } | undefined> };
      for (const spec of getPassthrough(n)) {
        const sock = node.outputs?.[spec.output]?.socket;
        if (sock === undefined) { offenders.push(`${type}: no output "${spec.output}"`); continue; }
        if (!(sock instanceof SolenoidSocket)) continue;
        // A CONCRETE output has nothing to resolve — the declaration is carrying units
        // only. Fill/Coalesce is the standing example: `listIn`/`listOut`, numeric
        // throughout, declaring `passthrough()` purely so units ride across it
        // (the 2026-07-16 unit audit). Legitimate; skip it.
        if (!isUnresolved(sock.dataType)) continue;
        if (!(sock instanceof MutableSocket)) {
          offenders.push(`${type}.${spec.output} is a STATIC ${sock.dataType}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** A wildcard rung — nothing has flowed into it yet. The rank-bearing ones
 *  (`anylist`/`anytable`/`anycombo`) keep their rank and adopt only the element
 *  family, so they are unresolved too. */
function isUnresolved(dt: string): boolean {
  return isWildcardType(dt as never) || dt === "anylist" || dt === "anytable" || dt === "anycombo";
}
