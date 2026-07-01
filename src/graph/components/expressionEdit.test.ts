import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes, SolenoidConnection } from "../schemes";
import { setEditorRefs } from "../process";
import { SliderInputNode, LambdaNode } from "../rete-nodes";
import { applyLambdaChange } from "./expressionEdit";

// Renaming a captured variable in a LAMBDA's expression must drop the cable
// wired to the old socket and leave the new socket unwired (the wired marker
// then disappears — it names the upstream node, not the variable).

describe("lambda captured-variable rename", () => {
  it("drops the cable on the removed socket", async () => {
    const editor = new NodeEditor<Schemes>();
    // No engine/area: processGraph early-returns, applyLambdaChange's area
    // branch is skipped. Only topology is under test.
    setEditorRefs(editor, null as never, null as never);

    const slider = new SliderInputNode({ label: "Rate", value: 3 });
    const lam = new LambdaNode({ label: "× rate", params: "x", expr: "x * rate" });
    await editor.addNode(slider);
    await editor.addNode(lam);

    expect(Object.keys(lam.inputs)).toContain("rate");
    await editor.addConnection(
      new ClassicPreset.Connection(slider, "value", lam, "rate") as SolenoidConnection,
    );
    expect(editor.getConnections()).toHaveLength(1);

    await applyLambdaChange(lam, { expr: "x * bazinga" });

    expect(Object.keys(lam.inputs)).not.toContain("rate");
    expect(Object.keys(lam.inputs)).toContain("bazinga");
    expect(editor.getConnections()).toHaveLength(0);
  });
});
