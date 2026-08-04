import type { ClassicPreset } from "rete";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, adoptTypeForBase, projectTypeToBase, type SocketDataType } from "./sockets";
import { getPassthrough, resolvePassthroughType, agreeTypes, type ProjectContext } from "./nodes/passthrough";
import { makeFrameShapeResolver, type FrameShapeResolver } from "./frameShapeResolver";
import { reconcileConduitTypes } from "./conduitTrace";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";

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

function reconcileOnce(editor: AdoptEditor, shapes: FrameShapeResolver): Set<string> {
  const conns = editor.getConnections();
  const changed = new Set<string>();
  /** What a `project` may consult beyond the socket type — the static frame shape on
   *  an input, and whether that input is wired. Built per node, lazily: only an
   *  extraction out of a FRAME ever asks. */
  const contextFor = (node: AdoptNode): ProjectContext => ({
    shapeOf: (key) => {
      const feed = conns.find((c) => c.target === node.id && c.targetInput === key);
      return feed ? shapes.outShape(feed.source, feed.sourceOutput) : null;
    },
    wired: (key) => conns.some((c) => c.target === node.id && c.targetInput === key),
  });
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
    //    the agreed branch type; Cable Switch (One) adopts the active branch; an
    //    EXTRACTION (INDEX) projects its container's family onto its own rank. A
    //    generative output (XLOOKUP, MAP, sources) declares nothing → static.
    // The vote a branch input casts in `agree` (see agreeTypes): UNWIRED → null
    // (no value flows, no vote); wired to an ERROR-ONLY source (NA()) → null too —
    // its value is always a tagged error, which formats as an error under any
    // branch type, so it deliberately abstains; wired to anything else → the
    // input's resolved type, where `trueany` means statically UNKNOWABLE
    // (XLOOKUP, Get Cell) and VETOES the agreement.
    const voteOf = (k: string): SocketDataType | null => {
      const feed = conns.find((c) => c.target === node.id && c.targetInput === k);
      if (!feed) return null;
      const src = editor.getNode(feed.source) as (AdoptNode & { errorOnlyOutput?: boolean }) | undefined;
      if (src?.errorOnlyOutput) return null;
      return inType(node, k) ?? "trueany";
    };
    for (const spec of getPassthrough(node)) {
      const resolved = resolvePassthroughType(spec, voteOf, agreeTypes, contextFor(node));
      const outSock = node.outputs?.[spec.output]?.socket;
      if (!(outSock instanceof MutableSocket)) continue;
      // Project onto the output's declared wildcard RANK (AdoptiveSocket base):
      // a rank-crossing reshape (WRAPROWS list→table, flatten table→list) adopts
      // the element FAMILY at its own rank rather than parroting the input's.
      const want = outSock instanceof AdoptiveSocket ? projectTypeToBase(outSock.base, resolved) : resolved;
      if (outSock.dataType !== want) {
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
  // ONE shape walk for the whole fixpoint: a static frame shape is a function of
  // topology + literal config only — nothing the adoption passes mutate — so its memo
  // stays valid across passes (and a fresh resolver per pass would re-walk the frame
  // graph up to 32 times).
  const shapes = makeFrameShapeResolver(editor as never);
  // A chain of N passthroughs settles in ≤ N passes; the cap guards a #CIRC!
  // loop of passthroughs (which converges to trueany or a stable type anyway).
  for (let pass = 0; pass < 32; pass++) {
    const changed = reconcileOnce(editor, shapes);
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
