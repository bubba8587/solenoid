// [[C77]] compositeIsSubgraph
import type { View } from "./view";
import { ClassicPreset } from "rete";
import type { NodeEditor } from "rete";
import type { Schemes, SolenoidNode, SolenoidConnection } from "./schemes";
import { GroupNode, CompositeNode, CompositeInputNode, CompositeOutputNode } from "./rete-nodes";
import { installErrorGuards } from "./errorValue";
import { groupCollapseStore } from "./groupCollapse";
import { cableSelectionStore } from "./cableState";
import { dockedNodeStore } from "./dockedNodeStore";
import { ctorRegistry } from "./nodeCtorRegistry";
import { measuredBox } from "./nodeSize";
import { getOwningEditor, editScopeFor } from "./activeGraph";

type Editor = NodeEditor<Schemes>;

function nodeBox(view: View, id: string): { x: number; y: number; w: number; h: number } | null {
  return measuredBox(view, id, getOwningEditor(id) ?? undefined);
}

export async function createCompositeFromSelection(editor: Editor, view: View): Promise<string | null> {
  // A lingering cable selection must not ride into the relocation reflow.
  cableSelectionStore.set(null);
  const ids = new Set(editor.getNodes().filter(
    (n) => n.selected && !(n instanceof GroupNode) && !(n instanceof CompositeNode) && !groupCollapseStore.isNodeHidden(n.id),
  ).map((n) => n.id));
  // A docked FC is part of its host's entity, so it moves in with the host.
  for (const id of ids) for (const d of dockedNodeStore.getDockedTo(id)) ids.add(d.id);
  const sel = editor.getNodes().filter((n) => ids.has(n.id));
  if (sel.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  for (const n of sel) {
    const b = nodeBox(view, n.id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  if (!Number.isFinite(minX)) return null;

  const selIds = new Set(sel.map((n) => n.id));
  const allConns = editor.getConnections();
  const internalConns = allConns.filter((c) => selIds.has(c.source) && selIds.has(c.target));
  const incoming = allConns.filter((c) => !selIds.has(c.source) && selIds.has(c.target));
  const outgoing = allConns.filter((c) => selIds.has(c.source) && !selIds.has(c.target));

  const composite = new CompositeNode({ label: "Composite" });

  const scope = editScopeFor(editor);
  scope.begin(); // relocated, not deleted
  try {
    // rete requires a node's connections removed before the node.
    for (const c of [...internalConns, ...incoming, ...outgoing]) {
      await editor.removeConnection(c.id);
    }
    for (const n of sel) {
      const b = nodeBox(view, n.id);
      await editor.removeNode(n.id);
      await composite.internalEditor.addNode(n as SolenoidNode);
      if (b) composite.internalPositions[n.id] = { x: b.x - minX, y: b.y - minY };
    }
    for (const c of internalConns) {
      const s = composite.internalEditor.getNode(c.source);
      const t = composite.internalEditor.getNode(c.target);
      if (!s || !t) continue;
      await composite.internalEditor.addConnection(
        new ClassicPreset.Connection(s, c.sourceOutput, t, c.targetInput) as SolenoidConnection,
      );
    }

    for (const c of incoming) {
      const target = composite.internalEditor.getNode(c.target);
      const outerSource = editor.getNode(c.source);
      if (!target || !outerSource) continue;
      const targetInputDef = (target.inputs as Record<string, { label?: string } | undefined>)[c.targetInput];
      if (!targetInputDef) continue;
      const portLabel = `${target.label || target.constructor.name} · ${targetInputDef.label || c.targetInput}`;
      const marker = new CompositeInputNode({ label: portLabel });
      // After addNode, so the guard wraps outside coercion.
      await composite.internalEditor.addNode(marker as SolenoidNode);
      installErrorGuards(marker);
      await composite.internalEditor.addConnection(
        new ClassicPreset.Connection(marker, "value", target, c.targetInput) as SolenoidConnection,
      );
      const tPos = composite.internalPositions[c.target];
      if (tPos) composite.internalPositions[marker.id] = { x: tPos.x - 220, y: tPos.y };
      const portId = composite.addInputPort({
        label: portLabel, internalNodeId: marker.id, exposure: "exposed", tier: "basic",
      });
      await editor.addConnection(
        new ClassicPreset.Connection(outerSource, c.sourceOutput, composite, portId) as SolenoidConnection,
      );
    }

    for (const c of outgoing) {
      const source = composite.internalEditor.getNode(c.source);
      const outerTarget = editor.getNode(c.target);
      if (!source || !outerTarget) continue;
      const sourceOutputDef = (source.outputs as Record<string, { label?: string } | undefined>)[c.sourceOutput];
      if (!sourceOutputDef) continue;
      const portLabel = `${source.label || source.constructor.name} · ${sourceOutputDef.label || c.sourceOutput}`;
      const marker = new CompositeOutputNode({ label: portLabel });
      // After addNode, so the guard wraps outside coercion.
      await composite.internalEditor.addNode(marker as SolenoidNode);
      installErrorGuards(marker);
      await composite.internalEditor.addConnection(
        new ClassicPreset.Connection(source, c.sourceOutput, marker, "value") as SolenoidConnection,
      );
      const sPos = composite.internalPositions[c.source];
      const sBox = nodeBox(view, c.source); // the relocated node's box may be gone, so width falls back
      if (sPos) composite.internalPositions[marker.id] = { x: sPos.x + (sBox?.w ?? 220) + 80, y: sPos.y };
      const portId = composite.addOutputPort({ label: portLabel, internalNodeId: marker.id, tier: "basic" });
      await editor.addConnection(
        new ClassicPreset.Connection(composite, portId, outerTarget, c.targetInput) as SolenoidConnection,
      );
    }

    // Runs after the ports exist, which the per-cable pipe settle could not see.
    composite.settleInternalTypes();
    await editor.addNode(composite as SolenoidNode);
    await view.moveNode(composite.id, { x: minX, y: minY });
  } finally {
    scope.end();
  }

  // beginGraphRebuild suppressed the per-cable settle, so run it once here.
  await scope.settle();
  return composite.id;
}

export async function unpackComposite(editor: Editor, view: View, compositeId: string): Promise<boolean> {
  const composite = editor.getNode(compositeId);
  if (!(composite instanceof CompositeNode)) return false;
  await composite.hydrate(ctorRegistry());

  const box = nodeBox(view, compositeId);
  const baseX = box?.x ?? 0;
  const baseY = box?.y ?? 0;

  const internalNodes = composite.internalEditor.getNodes();
  const internalConns = composite.internalEditor.getConnections();
  const markerIds = new Set([
    ...composite.inputPorts.map((p) => p.internalNodeId),
    ...composite.outputPorts.map((p) => p.internalNodeId),
  ]);
  const outerConns = editor.getConnections().filter(
    (c) => c.source === compositeId || c.target === compositeId,
  );

  cableSelectionStore.set(null);
  const scope = editScopeFor(editor);
  scope.begin();
  try {
    for (const c of outerConns) await editor.removeConnection(c.id);
    // Never remove nodes from the internal editor: that fires noderemoved at a drill-in history that never saw them created, which throws.
    for (const n of internalNodes) {
      if (markerIds.has(n.id)) continue;
      await editor.addNode(n as SolenoidNode);
      const rel = composite.internalPositions[n.id];
      await view.moveNode(n.id, { x: baseX + (rel?.x ?? 0), y: baseY + (rel?.y ?? 0) });
    }

    for (const c of internalConns) {
      if (markerIds.has(c.source) || markerIds.has(c.target)) continue;
      const s = editor.getNode(c.source);
      const t = editor.getNode(c.target);
      if (!s || !t) continue;
      try {
        await editor.addConnection(
          new ClassicPreset.Connection(s, c.sourceOutput, t, c.targetInput) as SolenoidConnection,
        );
      } catch { /* incompatible after an internal edit — dropped */ }
    }

    for (const p of composite.inputPorts) {
      const feeds = internalConns.filter((c) => c.source === p.internalNodeId);
      const outers = outerConns.filter((c) => c.target === compositeId && c.targetInput === p.id);
      for (const o of outers) {
        for (const f of feeds) {
          const s = editor.getNode(o.source);
          const t = editor.getNode(f.target);
          if (!s || !t) continue;
          try {
            await editor.addConnection(
              new ClassicPreset.Connection(s, o.sourceOutput, t, f.targetInput) as SolenoidConnection,
            );
          } catch { /* dropped */ }
        }
      }
    }

    for (const p of composite.outputPorts) {
      const feed = internalConns.find((c) => c.target === p.internalNodeId);
      if (!feed) continue;
      const outers = outerConns.filter((c) => c.source === compositeId && c.sourceOutput === p.id);
      for (const o of outers) {
        const s = editor.getNode(feed.source);
        const t = editor.getNode(o.target);
        if (!s || !t) continue;
        try {
          await editor.addConnection(
            new ClassicPreset.Connection(s, feed.sourceOutput, t, o.targetInput) as SolenoidConnection,
          );
        } catch { /* dropped */ }
      }
    }

    await editor.removeNode(compositeId);
  } finally {
    scope.end();
  }
  await scope.settle();
  return true;
}

/** Drops every port whose marker was deleted inside, with the parent's cables on it; run for each level a breadcrumb jump leaves. */
export async function reconcileLeftPorts(
  comp: CompositeNode,
  parentEditor: Editor,
): Promise<{ cables: number; ports: number }> {
  let cables = 0;
  let ports = 0;
  for (const p of [...comp.inputPorts]) {
    if (comp.internalEditor.getNode(p.internalNodeId)) continue;
    const doomed = parentEditor.getConnections().filter((c) => c.target === comp.id && c.targetInput === p.id);
    for (const c of doomed) await parentEditor.removeConnection(c.id);
    if (doomed.length > 0) { cables += doomed.length; ports++; }
    comp.removeInputPort(p.id);
  }
  for (const p of [...comp.outputPorts]) {
    if (comp.internalEditor.getNode(p.internalNodeId)) continue;
    const doomed = parentEditor.getConnections().filter((c) => c.source === comp.id && c.sourceOutput === p.id);
    for (const c of doomed) await parentEditor.removeConnection(c.id);
    if (doomed.length > 0) { cables += doomed.length; ports++; }
    comp.removeOutputPort(p.id);
  }
  comp.syncPortLabels();
  return { cables, ports };
}
