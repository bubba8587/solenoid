import { describe, it, expect, beforeEach } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import * as Nodes from "./rete-nodes";
import { FormatControllerNode } from "./rete-nodes";
import { formatAnnotationStore } from "./formatAnnotationStore";
import seed from "./seedGraphs/personal-finance.json";

// Faithfully replay the personal-finance seed's load order — build every node,
// then add each connection in file order and, after each, run the FC derive that
// Canvas's connectioncreated pipe runs (adaptType + refreshAnnotation for every
// FC), then dockSelf + a final refresh — and assert each money FC's `format`
// AND the annotation it writes both end at "currency_usd" (no silent reset to
// "auto", which is the reported "Auto dropdown but currency value" desync).
type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
type SavedNode = { id: string; type: string; init?: Record<string, unknown> };
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };

describe("personal-finance FC formats survive the full load order", () => {
  beforeEach(() => {
    for (const [k] of formatAnnotationStore.snapshot()) {
      const [n, s] = k.split("::");
      formatAnnotationStore.delete(n, s);
    }
  });

  it("every money FC keeps currency_usd (node + annotation)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const byId = new Map<string, ClassicPreset.Node>();
    for (const sn of seed.nodes as SavedNode[]) {
      const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
      const node = new Ctor({ ...sn.init });
      byId.set(sn.id, node);
      await editor.addNode(node as never);
    }
    // Remap each FC's hostNodeId from the seed's string id to the real (random)
    // node id, exactly as rebuildGraph does — otherwise the dock resolves nothing.
    for (const sn of seed.nodes as SavedNode[]) {
      if (sn.type !== "FormatControllerNode") continue;
      const fc = byId.get(sn.id) as unknown as { hostNodeId: string };
      const realHost = byId.get(sn.init?.hostNodeId as string);
      if (realHost) fc.hostNodeId = realHost.id;
    }
    const refreshAllFcs = () => {
      for (const n of editor.getNodes()) {
        if (n instanceof FormatControllerNode) { n.adaptTypeFromConnections(editor as never); n.refreshAnnotation(editor as never); }
      }
    };
    for (const sc of seed.connections as SavedConn[]) {
      const s = byId.get(sc.source), t = byId.get(sc.target);
      if (!s || !t) continue;
      await editor.addConnection(new ClassicPreset.Connection(s as never, sc.sourceOutput, t as never, sc.targetInput) as never);
      refreshAllFcs(); // mimic Canvas connectioncreated pipe
    }
    for (const n of editor.getNodes()) if (n instanceof FormatControllerNode) n.dockSelf(editor as never);
    refreshAllFcs();

    // Money FCs show $ via the `usd` UNIT + a `decimal` number format — NEVER a
    // "currency" format (currency isn't a valid format in this app; the format
    // dropdown can't display it, which is the "Auto dropdown / $ value" desync).
    const moneyFcs = (seed.nodes as SavedNode[]).filter(
      (n) => n.type === "FormatControllerNode" && n.init?.unit === "usd",
    );
    expect(moneyFcs.length).toBeGreaterThan(5);
    const VALID_FORMATS = new Set(["auto", "decimal", "integer", "fraction", "fraction_adv", "scientific", "percent", "custom"]);
    for (const sn of (seed.nodes as SavedNode[]).filter((n) => n.type === "FormatControllerNode")) {
      // No FC may carry a currency-as-format value.
      expect(String(sn.init?.format)).not.toMatch(/^currency_/);
      expect(VALID_FORMATS.has(String(sn.init?.format)), `${sn.id} format ${sn.init?.format}`).toBe(true);
    }
    for (const sn of moneyFcs) {
      const fc = byId.get(sn.id) as FormatControllerNode;
      const realHostId = byId.get(sn.init?.hostNodeId as string)!.id;
      const ann = formatAnnotationStore.get(realHostId, "out");
      expect(fc.format, `${sn.id} node.format`).toBe("decimal");
      expect(ann?.format, `${sn.id} annotation format`).toBe("decimal");
      expect(ann?.unit, `${sn.id} unit`).toBe("usd");
    }
  });
});
