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

/** A node's input socket type, or null when the key/socket is absent. */
function inType(node: AdoptNode, key: string): SocketDataType | null {
  const s = node.inputs?.[key]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : null;
}

function reconcileOnce(editor: AdoptEditor, shapes: FrameShapeResolver): Set<string> {
  const conns = editor.getConnections();
  const changed = new Set<string>();
  /** What a `project` may consult beyond the socket type; built lazily, since only an
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
      // Unwired reverts to the port's declared base, which may be narrower than `trueany`.
      let want: SocketDataType = sock.base;
      if (feed) {
        const out = editor.getNode(feed.source)?.outputs?.[feed.sourceOutput]?.socket;
        // A rank-bearing base KEEPS its rank; only `trueany` adopts verbatim.
        if (out instanceof SolenoidSocket) want = adoptTypeForBase(sock.base, out.dataType);
      }
      if (sock.dataType !== want) {
        sock.setType(want);
        changed.add(node.id);
      }
    }
    // 2) OUTPUT policy comes from the node's passthrough() declaration, the ONE source
    //    both this and unitFlow read.
    // Branch votes: unwired and error-only sources ABSTAIN (null); a `trueany` vote means
    // statically unknowable and VETOES the agreement.
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
      // A rank-crossing reshape adopts the element FAMILY at its OWN declared rank rather
      // than parroting the input's.
      const want = outSock instanceof AdoptiveSocket ? projectTypeToBase(outSock.base, resolved) : resolved;
      if (outSock.dataType !== want) {
        outSock.setType(want);
        changed.add(node.id);
      }
    }
  }
  return changed;
}

/** Run the adoption pass to a fixpoint, returning every node whose socket type changed;
 *  never touches connections. */
export function reconcileTrueAnyTypes(editor: AdoptEditor): Set<string> {
  const all = new Set<string>();
  // ONE shape walk for the whole fixpoint — frame shape depends only on topology + literal
  // config, which no adoption pass mutates, so the memo stays valid across passes.
  const shapes = makeFrameShapeResolver(editor as never);
  // A chain of N passthroughs settles in ≤ N passes; the cap guards a #CIRC! loop.
  for (let pass = 0; pass < 32; pass++) {
    const changed = reconcileOnce(editor, shapes);
    if (changed.size === 0) break;
    changed.forEach((id) => all.add(id));
  }
  return all;
}

/** THE entry point for "wiring changed, re-derive every socket type": alternates Conduit
 *  lanes and trueany adoption to a JOINT fixpoint, since each can feed the other. */
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
