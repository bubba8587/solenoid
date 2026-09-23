// [[D15]] wildcardsKeepRank, [[E7]] trueanyNeedsPassthrough, [[E8]] waitForTypeSettle
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

function inType(node: AdoptNode, key: string): SocketDataType | null {
  const s = node.inputs?.[key]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : null;
}

function reconcileOnce(editor: AdoptEditor, shapes: FrameShapeResolver): Set<string> {
  const conns = editor.getConnections();
  const changed = new Set<string>();
  const contextFor = (node: AdoptNode): ProjectContext => ({
    shapeOf: (key) => {
      const feed = conns.find((c) => c.target === node.id && c.targetInput === key);
      return feed ? shapes.outShape(feed.source, feed.sourceOutput) : null;
    },
    wired: (key) => conns.some((c) => c.target === node.id && c.targetInput === key),
  });
  for (const node of editor.getNodes()) {
    for (const [key, inp] of Object.entries(node.inputs ?? {})) {
      const sock = inp?.socket;
      if (!(sock instanceof AdoptiveSocket)) continue;
      const feed = conns.find((c) => c.target === node.id && c.targetInput === key);
      let want: SocketDataType = sock.base;
      if (feed) {
        const out = editor.getNode(feed.source)?.outputs?.[feed.sourceOutput]?.socket;
        if (out instanceof SolenoidSocket) want = adoptTypeForBase(sock.base, out.dataType);
      }
      if (sock.dataType !== want) {
        sock.setType(want);
        changed.add(node.id);
      }
    }
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
      const want = outSock instanceof AdoptiveSocket ? projectTypeToBase(outSock.base, resolved) : resolved;
      if (outSock.dataType !== want) {
        outSock.setType(want);
        changed.add(node.id);
      }
    }
  }
  return changed;
}

export function reconcileTrueAnyTypes(editor: AdoptEditor): Set<string> {
  const all = new Set<string>();
  const shapes = makeFrameShapeResolver(editor as never);
  for (let pass = 0; pass < 32; pass++) {
    const changed = reconcileOnce(editor, shapes);
    if (changed.size === 0) break;
    changed.forEach((id) => all.add(id));
  }
  return all;
}

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
