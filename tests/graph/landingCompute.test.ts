// [[B3]] sameNodeEverywhere, [[C23]]
import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import type { View } from "../../src/graph/view";
import type { SurfaceStack } from "../../src/graph/flow/FlowSurface";
import { computeStack } from "../../src/graph/landing/landingCompute";
import { calcModeStore } from "../../src/graph/calcModeStore";

class Src extends ClassicPreset.Node {
  runs = 0;
  constructor() {
    super("src");
    this.addOutput("out", new ClassicPreset.Output(new ClassicPreset.Socket("s")));
  }
  data() { this.runs++; return { out: 1 }; }
}

describe("computeStack", () => {
  it("computes a landing stack even when the visitor's calc mode is Manual", async () => {
    const editor = new NodeEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    const src = new Src();
    await editor.addNode(src as unknown as Schemes["Node"]);
    const view = { rerenderNode: async () => {} } as unknown as View;
    const before = calcModeStore.mode();
    calcModeStore.setMode("manual");
    try {
      await computeStack({ editor, engine, view } as unknown as SurfaceStack, true);
      expect(src.runs).toBeGreaterThan(0);
    } finally {
      calcModeStore.setMode(before);
    }
  });
});
