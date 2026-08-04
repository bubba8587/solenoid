import { ClassicPreset } from "rete";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra, SolenoidNode, SolenoidConnection } from "./schemes";
import { GroupNode, CompositeNode, CompositeInputNode, CompositeOutputNode } from "./rete-nodes";
import { installErrorGuards } from "./errorValue";
import { groupCollapseStore } from "./groupCollapse";
import { cableSelectionStore } from "./cableState";
import { beginGraphRebuild, endGraphRebuild, bulkSettle, getEditor } from "./process";
import { ctorRegistry } from "./nodeCtorRegistry";
import { measuredBox } from "./nodeSize";

// Composite make/unpack PHYSICALLY RELOCATE node instances between the outer editor and a
// composite's private internal one; every crossing cable becomes a declared boundary port.

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

function nodeBox(area: Area, id: string): { x: number; y: number; w: number; h: number } | null {
  return measuredBox(area, id, getEditor() ?? undefined);
}

/** Create a composite wrapping the current selection. Returns the new
 *  composite's id, or null if nothing selectable was picked. */
export async function createCompositeFromSelection(editor: Editor, area: Area): Promise<string | null> {
  // A lingering cable selection must not ride along into the relocation reflow.
  cableSelectionStore.set(null);
  // Absorbing a member hidden in a collapsed group would silently rip it out of that group.
  const sel = editor.getNodes().filter(
    (n) => n.selected && !(n instanceof GroupNode) && !(n instanceof CompositeNode) && !groupCollapseStore.isNodeHidden(n.id),
  );
  if (sel.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  for (const n of sel) {
    const b = nodeBox(area, n.id);
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

  beginGraphRebuild(); // these nodes are being RELOCATED, not deleted
  try {
    // rete requires a node's connections gone before the node itself is removed.
    for (const c of [...internalConns, ...incoming, ...outgoing]) {
      await editor.removeConnection(c.id);
    }
    for (const n of sel) {
      const b = nodeBox(area, n.id);
      await editor.removeNode(n.id);
      await composite.internalEditor.addNode(n as SolenoidNode);
      // Positions are stored BBOX-RELATIVE, so drill-in and unpack both restore the layout.
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

    // Incoming crossing cables → exposed INPUT ports, one marker node per crossing.
    for (const c of incoming) {
      const target = composite.internalEditor.getNode(c.target);
      const outerSource = editor.getNode(c.source);
      if (!target || !outerSource) continue;
      const targetInputDef = (target.inputs as Record<string, { label?: string } | undefined>)[c.targetInput];
      if (!targetInputDef) continue;
      const portLabel = `${target.label || target.constructor.name} · ${targetInputDef.label || c.targetInput}`;
      const marker = new CompositeInputNode({ label: portLabel });
      // AFTER addNode — guard outside coercion (see CompositeNode.hydrate).
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

    // Outgoing crossing cables → exposed OUTPUT ports, same approach.
    for (const c of outgoing) {
      const source = composite.internalEditor.getNode(c.source);
      const outerTarget = editor.getNode(c.target);
      if (!source || !outerTarget) continue;
      const sourceOutputDef = (source.outputs as Record<string, { label?: string } | undefined>)[c.sourceOutput];
      if (!sourceOutputDef) continue;
      const portLabel = `${source.label || source.constructor.name} · ${sourceOutputDef.label || c.sourceOutput}`;
      const marker = new CompositeOutputNode({ label: portLabel });
      // AFTER addNode — guard outside coercion (see CompositeNode.hydrate).
      await composite.internalEditor.addNode(marker as SolenoidNode);
      installErrorGuards(marker);
      await composite.internalEditor.addConnection(
        new ClassicPreset.Connection(source, c.sourceOutput, marker, "value") as SolenoidConnection,
      );
      const sPos = composite.internalPositions[c.source];
      const sBox = nodeBox(area, c.source); // node already relocated — box may be gone; width falls back
      if (sPos) composite.internalPositions[marker.id] = { x: sPos.x + (sBox?.w ?? 220) + 80, y: sPos.y };
      const portId = composite.addOutputPort({ label: portLabel, internalNodeId: marker.id, tier: "basic" });
      await editor.addConnection(
        new ClassicPreset.Connection(composite, portId, outerTarget, c.targetInput) as SolenoidConnection,
      );
    }

    // Must run AFTER the ports exist — the per-cable pipe settle above couldn't see them.
    composite.settleInternalTypes();
    await editor.addNode(composite as SolenoidNode);
    await area.translate(composite.id, { x: minX, y: minY });
  } finally {
    endGraphRebuild();
  }

  // beginGraphRebuild suppressed the per-cable settle, so run the equivalent once.
  await bulkSettle();
  return composite.id;
}

/** Returns true if the node was a composite and was unpacked. */
export async function unpackComposite(editor: Editor, area: Area, compositeId: string): Promise<boolean> {
  const composite = editor.getNode(compositeId);
  if (!(composite instanceof CompositeNode)) return false;
  // A loaded-but-never-computed composite still holds only its snapshot.
  await composite.hydrate(ctorRegistry());

  const box = nodeBox(area, compositeId);
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
  beginGraphRebuild();
  try {
    for (const c of outerConns) await editor.removeConnection(c.id);
    // Do NOT remove nodes from the internal editor: that fires `noderemoved` at a prior
    // drill-in's history plugin, which throws for nodes it never saw created. Moving the
    // shared INSTANCES out is enough — the internal editor is discarded whole.
    for (const n of internalNodes) {
      if (markerIds.has(n.id)) continue; // boundary markers dissolve with the card
      await editor.addNode(n as SolenoidNode);
      const rel = composite.internalPositions[n.id];
      await area.translate(n.id, { x: baseX + (rel?.x ?? 0), y: baseY + (rel?.y ?? 0) });
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

    // Input boundary collapses: outer source → marker → internal target becomes one cable.
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

    // Output boundary collapses the same way.
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
    endGraphRebuild();
  }
  await bulkSettle();
  return true;
}
