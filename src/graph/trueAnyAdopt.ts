import type { ClassicPreset } from "rete";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, adoptTypeForBase, type SocketDataType } from "./sockets";
import { getPassthrough, resolvePassthroughType } from "./nodes/passthrough";
import { reconcileConduitTypes } from "./conduitTrace";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";

// ─── trueany type adoption ─────────────────────────────────────────────────────
// A `trueany` port drawn as the hollow ring is a PLACEHOLDER: it accepts anything,
// and once a cable lands it ADOPTS the cable's type (reverting on disconnect) —
// author decision on D17. That keeps the hollow ring meaning "unknown until it
// flows" while `any`/`anylist`/`anytable` stay the deliberately NEUTRAL rungs.
//
// Two rules, applied to a fixpoint (chains of passthroughs settle over passes):
//  • INPUTS adopt universally. Any `AdoptiveSocket` input takes the wired output's
//    current dataType. Purely informative — the cable is already accepted and an
//    input holds one cable — but it colours the dot/cable and lets downstream
//    resolution stop at a concrete type.
//  • OUTPUTS adopt only where honest. Pure passthroughs (Display, Expect, Input
//    Switch in One mode) adopt their input's resolved type — the same move the
//    Conduit lanes make in conduitTrace. Selector results (IF / IFERROR / CHOOSE /
//    SWITCH / IFS) adopt when every WIRED branch agrees, else stay `trueany`
//    (the result type genuinely depends on runtime). Value-dependent outputs
//    (INDEX, XLOOKUP — a cube cell's type varies per row) use a STATIC trueany
//    socket and never appear here.
//
// Like the Conduit reconcile, adoption NEVER drops existing cables — it is derived
// state; the mismatch scan flags a cable that adoption reveals as ill-typed.
// (Explicit user retypes — a Cast target, a List Input SegToggle — still go
// through retypeOutputCables and drop dead cables.) Adopted types are NOT
// persisted: the pass re-runs after load/paste, from the wiring.

interface AdoptNode {
  id: string;
  inputs?: Record<string, { socket?: ClassicPreset.Socket } | undefined>;
  outputs?: Record<string, { socket?: ClassicPreset.Socket } | undefined>;
}
export interface AdoptEditor {
  getNodes(): AdoptNode[];
  getNode(id: string): AdoptNode | undefined;
  getConnections(): ReadonlyArray<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
}

/** A node's input socket type, or null when the key/socket is absent. `trueany`
 *  on an adoptive input means "unwired" (its reverted state). */
function inType(node: AdoptNode, key: string): SocketDataType | null {
  const s = node.inputs?.[key]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : null;
}

/** The selector-result rule: every WIRED branch (adopted type ≠ trueany) must
 *  agree; no wired branches or a disagreement keeps the placeholder. */
function agree(types: Array<SocketDataType | null>): SocketDataType {
  const wired = types.filter((t): t is SocketDataType => t !== null && t !== "trueany");
  if (wired.length === 0) return "trueany";
  return wired.every((t) => t === wired[0]) ? wired[0] : "trueany";
}

function reconcileOnce(editor: AdoptEditor): Set<string> {
  const conns = editor.getConnections();
  const changed = new Set<string>();
  for (const node of editor.getNodes()) {
    // 1) Every adoptive INPUT takes the wired output's current type.
    for (const [key, inp] of Object.entries(node.inputs ?? {})) {
      const sock = inp?.socket;
      if (!(sock instanceof AdoptiveSocket)) continue;
      const feed = conns.find((c) => c.target === node.id && c.targetInput === key);
      // Unwired → revert to this port's declared base (usually `trueany`; a narrower
      // `anytable`/`anylist` base keeps a Build-Frame-style port restricted).
      let want: SocketDataType = sock.base;
      if (feed) {
        const out = editor.getNode(feed.source)?.outputs?.[feed.sourceOutput]?.socket;
        // Keep a rank-bearing wildcard base's rank (a scalar widening into an anylist
        // input stays a LIST square, not a scalar circle); trueany adopts verbatim.
        if (out instanceof SolenoidSocket) want = adoptTypeForBase(sock.base, out.dataType);
      }
      if (sock.dataType !== want) {
        sock.setType(want);
        changed.add(node.id);
      }
    }
    // 2) Per-node OUTPUT policy — driven by the node's passthrough() declaration
    //    (passthrough.ts), the ONE source both this and unitFlow read. A pure
    //    passthrough / element-agnostic op adopts its single input; a selector adopts
    //    the agreed branch type; Cable Switch (One) adopts the active branch. A
    //    generative output (INDEX/XLOOKUP, MAP, sources) declares nothing → static.
    for (const spec of getPassthrough(node)) {
      const want = resolvePassthroughType(spec, (k) => inType(node, k), agree);
      const outSock = node.outputs?.[spec.output]?.socket;
      if (outSock instanceof MutableSocket && outSock.dataType !== want) {
        outSock.setType(want);
        changed.add(node.id);
      }
    }
  }
  return changed;
}

/** Run the adoption pass to a fixpoint. Returns every node whose socket type
 *  changed (the caller re-renders those cards + their cables). Pure w.r.t. the
 *  store; never touches connections. */
export function reconcileTrueAnyTypes(editor: AdoptEditor): Set<string> {
  const all = new Set<string>();
  // A chain of N passthroughs settles in ≤ N passes; the cap guards a #CIRC!
  // loop of passthroughs (which converges to trueany or a stable type anyway).
  for (let pass = 0; pass < 32; pass++) {
    const changed = reconcileOnce(editor);
    if (changed.size === 0) break;
    changed.forEach((id) => all.add(id));
  }
  return all;
}

/** Settle BOTH derived-socket-type systems — Conduit lanes and trueany adoption —
 *  by alternating them to a joint fixpoint (a Display feeding a Conduit feeding a
 *  Display needs each to see the other's adopted type). The one entry point for
 *  "wiring changed, re-derive every socket type": the connection pipe
 *  (reconcileFcTypes) and the load path both call this. */
export function settleWildcardTypes(editor: NodeEditor<Schemes>): { conduitChanged: boolean; adopted: Set<string> } {
  let conduitChanged = false;
  const adopted = new Set<string>();
  for (let round = 0; round < 8; round++) {
    const c = reconcileConduitTypes(editor);
    const a = reconcileTrueAnyTypes(editor as unknown as AdoptEditor);
    conduitChanged ||= c;
    a.forEach((id) => adopted.add(id));
    if (!c && a.size === 0) break;
  }
  return { conduitChanged, adopted };
}
