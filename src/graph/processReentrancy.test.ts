import type { Area } from "./area";
import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "./schemes";
import { processGraph, setEditorRefs } from "./process";
import { calcModeStore } from "./calcModeStore";

// Single-flight invariant (the fix for the flushSync-mount crash): a processGraph call made
// WHILE a pass is running must coalesce into one trailing full pass, never nest a pass inside
// a pass. A nested pass resets/reads the shared engine + memo + loop state mid-flight and
// corrupts it (the live symptom was rete-engine's "node is not initialized"). This drives the
// real singleton processGraph with a stub area whose render step re-enters — exactly what a
// node's mount/render effect (the Conduit) does under a synchronous render.

class Src extends ClassicPreset.Node {
  constructor(label: string) {
    super(label);
    this.addOutput("out", new ClassicPreset.Output(new ClassicPreset.Socket("s")));
  }
  data() { return { out: 1 }; }
}

describe("processGraph is single-flight (a mid-pass recompute coalesces, never nests)", () => {
  it("a recompute fired during the render phase runs no nested pass, and settles as one rerun", async () => {
    const editor = new NodeEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    await editor.addNode(new Src("a") as unknown as Schemes["Node"]);
    await editor.addNode(new Src("b") as unknown as Schemes["Node"]);

    // Each FULL pass calls engine.reset() exactly once (process.ts) — so reset count == pass count.
    let resetCount = 0;
    const origReset = engine.reset.bind(engine);
    (engine as unknown as { reset: (id?: string) => void }).reset = (id?: string) => { resetCount++; return origReset(id); };

    // The stub area's render step re-enters processGraph ONCE, mimicking the Conduit's
    // `useEffect(processGraph, [realLanes])` firing while a node mounts mid-render.
    let reentered = false;
    let resetSeenByReentrantCall: number | null = null;
    const area = {
      rerenderNode: async (_id: string) => {
        if (reentered) return;
        reentered = true;
        const before = resetCount;
        await processGraph();               // the re-entrant recompute
        resetSeenByReentrantCall = resetCount - before;
      },
    } as unknown as Area;

    setEditorRefs(editor, engine, area);
    await expect(processGraph()).resolves.toBeUndefined(); // no throw, no unhandled rejection

    // The re-entrant call itself ran NO pass (it coalesced): no reset happened during it.
    expect(resetSeenByReentrantCall).toBe(0);
    // Exactly two passes total: the initial one + one coalesced trailing rerun (not a storm).
    expect(resetCount).toBe(2);
  });

  it("a coalesced FORCED call (F9 during a pass) stays forced — manual mode's gate must not swallow the rerun", async () => {
    const editor = new NodeEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    await editor.addNode(new Src("a") as unknown as Schemes["Node"]);
    let resetCount = 0;
    const origReset = engine.reset.bind(engine);
    (engine as unknown as { reset: (id?: string) => void }).reset = (id?: string) => { resetCount++; return origReset(id); };
    let reentered = false;
    const area = {
      rerenderNode: async () => {
        if (reentered) return;
        reentered = true;
        await processGraph(undefined, undefined, { force: true }); // a second F9 mid-pass
      },
    } as unknown as Area;
    setEditorRefs(editor, engine, area);
    calcModeStore.setMode("manual");
    try {
      await processGraph(undefined, undefined, { force: true });
      // Without the carried flag the rerun would be an unforced call → markDirty + return: one pass.
      expect(resetCount).toBe(2);
      expect(calcModeStore.dirty()).toBe(false);
    } finally {
      calcModeStore.setMode("auto");
    }
  });
});
