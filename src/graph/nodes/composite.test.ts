import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import { ctorRegistry } from "../nodeCtorRegistry";
import { extractInit } from "../copyPaste";
import { isSolError } from "../errorValue";
import { loopMembers } from "../process";
import { CompositeNode, CompositeInputNode, CompositeOutputNode, stopConditionMet, byRowValues, BY_ROW_MAX_ROWS } from "./composite";
import { frameFromCells, isFrameValue, frameRowCount, type FrameValue } from "../frame";
import { NumberInputNode } from "./input";
import { ArithmeticNode, MathFnNode } from "./scalar";
import { ComparisonNode } from "./logic";

function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

describe("CompositeNode shell", () => {
  it("starts with no ports and no sockets", () => {
    const c = new CompositeNode();
    expect(c.inputPorts).toEqual([]);
    expect(c.outputPorts).toEqual([]);
    expect(Object.keys(c.inputs)).toEqual([]);
    expect(Object.keys(c.outputs)).toEqual([]);
    expect(c.isHydrated).toBe(true); // nothing pending — a freshly-built shell
  });

  it("addInputPort/addOutputPort add real sockets keyed by the returned port id", () => {
    const c = new CompositeNode();
    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: "marker-1" });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: "marker-2" });
    expect(c.inputs[inId]).toBeDefined();
    expect(c.outputs[outId]).toBeDefined();
    expect(c.inputPorts).toHaveLength(1);
    expect(c.outputPorts).toHaveLength(1);
  });

  it("a hidden input port gets NO outer socket, only a baked default", () => {
    const c = new CompositeNode();
    const inId = c.addInputPort({ label: "K", exposure: "hidden", tier: "advanced", internalNodeId: "marker-1", default: 42 });
    expect(c.inputs[inId]).toBeUndefined();
    expect(c.inputPorts[0].default).toBe(42);
  });

  it("computes through its internal subgraph: exposed input → internal add → output", async () => {
    const c = new CompositeNode();
    // Build the internal graph BY HAND (mirrors what createCompositeFromSelection
    // does programmatically): one real ArithmeticNode plus the two boundary markers.
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 10 }; // "a" is the exposed input; "b" is baked into the node itself
    const inMarker = new CompositeInputNode({ label: "A" });
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", add, "a");
    await connect(c.internalEditor, add, "result", outMarker, "value");

    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    const out = await c.data({ [inId]: [5] });
    expect(out[outId]).toBe(15); // 5 (exposed input) + 10 (baked into the internal node)
    expect(c.cachedOutputs[outId]).toBe(15);

    // A second call with a different injected value recomputes fresh (no stale cache).
    const out2 = await c.data({ [inId]: [100] });
    expect(out2[outId]).toBe(110);
  });

  it("an unwired exposed input falls back to its declared default", async () => {
    const c = new CompositeNode();
    const passthrough = new CompositeOutputNode({ label: "Result" });
    const inMarker = new CompositeInputNode({ label: "A" });
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(passthrough as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", passthrough, "value");
    c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id, default: 7 });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: passthrough.id });

    const out = await c.data({}); // nothing wired into the exposed input
    expect(out[outId]).toBe(7);
  });

  it("a hidden input port always uses its baked default, ignoring any injected value", async () => {
    const c = new CompositeNode();
    const passthrough = new CompositeOutputNode({ label: "Result" });
    const inMarker = new CompositeInputNode({ label: "K" });
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(passthrough as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", passthrough, "value");
    const inId = c.addInputPort({ label: "K", exposure: "hidden", tier: "advanced", internalNodeId: inMarker.id, default: 3 });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: passthrough.id });

    // No outer socket exists for a hidden port, so nothing could be wired to
    // it anyway — data() must still resolve to the baked default.
    const out = await c.data({ [inId]: [999] });
    expect(out[outId]).toBe(3);
  });

  it("snapshotInternal() + hydrate() round-trips the internal graph losslessly", async () => {
    const c = new CompositeNode();
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 2, b: 3 };
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    const snapshot = c.snapshotInternal();
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.connections).toHaveLength(1);

    // Rebuild a FRESH composite purely from the snapshot + ports, the same shape
    // persistence.ts's rebuildGraph constructs on load.
    const reloaded = new CompositeNode({
      label: c.label,
      outputPorts: c.outputPorts,
      internal: snapshot,
    });
    expect(reloaded.isHydrated).toBe(false);
    await reloaded.hydrate(ctorRegistry());
    expect(reloaded.isHydrated).toBe(true);
    expect(reloaded.internalEditor.getNodes()).toHaveLength(2);

    const out = await reloaded.data({});
    expect(out[outId]).toBe(5); // 2 + 3, recomputed from the rebuilt internal graph
  });

  it("NumberInputNode survives a snapshot/hydrate round-trip with its literal intact", async () => {
    const c = new CompositeNode();
    const num = new NumberInputNode({ value: 99 });
    const outMarker = new CompositeOutputNode({ label: "Value" });
    await c.internalEditor.addNode(num as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, num, "value", outMarker, "value");
    const outId = c.addOutputPort({ label: "Value", tier: "basic", internalNodeId: outMarker.id });

    const reloaded = new CompositeNode({ outputPorts: c.outputPorts, internal: c.snapshotInternal() });
    await reloaded.hydrate(ctorRegistry());
    const out = await reloaded.data({});
    expect(out[outId]).toBe(99);
  });

  it("hydrate() is a no-op the second time (already hydrated)", async () => {
    const c = new CompositeNode();
    await c.hydrate(ctorRegistry()); // freshly-built shell — nothing pending
    expect(c.isHydrated).toBe(true);
    expect(c.internalEditor.getNodes()).toHaveLength(0);
  });

  it("round-trips through extractInit — the EXACT path persistence.ts and paste use", async () => {
    const c = new CompositeNode({ label: "Adder" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 4, b: 6 };
    const inMarker = new CompositeInputNode({ label: "A" });
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", add, "a");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    // persistence.ts's serializeGraph calls extractInit(n) for a SavedNode's
    // `init`; on load it does `new Ctor({ ...sn.init })` then (for a Composite)
    // `node.hydrate(reg)`. Reproduce exactly that, with no composite-specific
    // code on either side beyond what's already in copyPaste.ts.
    const init = extractInit(c as unknown as ClassicPreset.Node);
    expect(init.label).toBe("Adder");
    expect(Array.isArray(init.inputPorts)).toBe(true);
    expect(Array.isArray(init.outputPorts)).toBe(true);
    expect(init.internal).toBeDefined();

    const reloaded = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(reloaded.label).toBe("Adder");
    expect(reloaded.inputs[inId]).toBeDefined();
    expect(reloaded.outputs[outId]).toBeDefined();
    await reloaded.hydrate(ctorRegistry());

    const out = await reloaded.data({ [inId]: [1] });
    expect(out[outId]).toBe(7); // 1 (exposed input) + 6 (add's baked "b")
  });
});

describe("CompositeNode boundary output-type adoption (D17)", () => {
  it("an output port adopts the concrete type feeding its internal marker", async () => {
    const c = new CompositeNode();
    const num = new NumberInputNode({ value: 7 }); // number-typed "value" output
    const outMarker = new CompositeOutputNode({ label: "N" });
    await c.internalEditor.addNode(num as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, num, "value", outMarker, "value");
    const outId = c.addOutputPort({ label: "N", tier: "basic", internalNodeId: outMarker.id });

    // Before settle the outer socket is the neutral placeholder.
    expect((c.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("trueany");
    c.settleInternalTypes();
    expect((c.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("number");
  });

  it("a live rewire reverts the port to trueany when the marker is unwired", async () => {
    const c = new CompositeNode();
    const num = new NumberInputNode({ value: 1 });
    const outMarker = new CompositeOutputNode({ label: "N" });
    await c.internalEditor.addNode(num as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    const outId = c.addOutputPort({ label: "N", tier: "basic", internalNodeId: outMarker.id });
    // Wiring AFTER the port exists → the internal pipe settles automatically.
    await connect(c.internalEditor, num, "value", outMarker, "value");
    expect((c.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("number");
    // Removing the feed reverts to the placeholder (the pipe settles again).
    const conn = c.internalEditor.getConnections()[0]!;
    await c.internalEditor.removeConnection(conn.id);
    expect((c.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("trueany");
  });

  it("adoption survives a snapshot/hydrate round-trip (load path settles once)", async () => {
    const c = new CompositeNode();
    const num = new NumberInputNode({ value: 3 });
    const outMarker = new CompositeOutputNode({ label: "N" });
    await c.internalEditor.addNode(num as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, num, "value", outMarker, "value");
    const outId = c.addOutputPort({ label: "N", tier: "basic", internalNodeId: outMarker.id });

    const reloaded = new CompositeNode({ outputPorts: c.outputPorts, internal: c.snapshotInternal() });
    // Before hydrate the reconstructed socket is the placeholder.
    expect((reloaded.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("trueany");
    await reloaded.hydrate(ctorRegistry());
    expect((reloaded.outputs[outId]!.socket as unknown as { dataType: string }).dataType).toBe("number");
  });
});

describe("CompositeNode Auto-trig reads the internal unit plane", () => {
  it("an Auto SIN inside the subgraph computes in degrees off a deg-tagged feed", async () => {
    const c = new CompositeNode();
    // A number source that publishes the `deg` angle unit on its output (the
    // unitFlow annotation the trig resolver reads) — mirrors trigMode.test.ts.
    const angle = new NumberInputNode({ value: 90 });
    (angle as unknown as { annotationFor: (k: string) => unknown }).annotationFor =
      (k: string) => (k === "value" ? { format: "auto", unit: "deg" } : undefined);
    const sin = new MathFnNode({ op: "sin" }); // auto angle mode
    const outMarker = new CompositeOutputNode({ label: "S" });
    for (const n of [angle, sin, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, angle, "value", sin, "in");
    await connect(c.internalEditor, sin, "result", outMarker, "value");
    const outId = c.addOutputPort({ label: "S", tier: "basic", internalNodeId: outMarker.id });

    // data() resolves the internal trig mode from the deg unit → SIN(90°) = 1,
    // not SIN(90 rad) ≈ 0.894.
    const out = await c.data({});
    expect(out[outId] as number).toBeCloseTo(1, 9);
  });
});

describe("CompositeNode Scenarios run mode", () => {
  async function makeAdder() {
    const c = new CompositeNode({ runMode: "scenarios" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 0 };
    const inA = new CompositeInputNode({ label: "A" });
    const inB = new CompositeInputNode({ label: "B" });
    const outMarker = new CompositeOutputNode({ label: "Sum" });
    for (const n of [add, inA, inB, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inA, "value", add, "a");
    await connect(c.internalEditor, inB, "value", add, "b");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inAId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const inBId = c.addInputPort({ label: "B", exposure: "exposed", tier: "basic", internalNodeId: inB.id });
    const outId = c.addOutputPort({ label: "Sum", tier: "basic", internalNodeId: outMarker.id });
    return { c, inAId, inBId, outId };
  }

  it("with no scenarios, behaves exactly like a single run", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    const out = await c.data({ [inAId]: [2], [inBId]: [3] });
    expect(out[outId]).toBe(5); // a scalar, not a 1-element array
  });

  it("runs the container once per named scenario and collects outputs side by side", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    const id1 = c.addScenario();
    const id2 = c.addScenario();
    c.setScenarioOverride(id1, inAId, 10);
    c.setScenarioOverride(id1, inBId, 1);
    c.setScenarioOverride(id2, inAId, 100);
    c.setScenarioOverride(id2, inBId, 2);

    // Outer wiring still feeds A=2,B=3 — irrelevant to a scenario that overrides
    // both, but proves the "no override → fall back to the wired value" path
    // isn't exercised here (both ports are overridden in every scenario).
    const out = await c.data({ [inAId]: [2], [inBId]: [3] });
    expect(out[outId]).toEqual([11, 102]); // 10+1, 100+2 — in scenario order
  });

  it("a scenario that only overrides ONE port falls back to the wired value for the other", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    const id1 = c.addScenario();
    c.setScenarioOverride(id1, inAId, 1000); // B is left alone → uses the wired 3

    const out = await c.data({ [inAId]: [2], [inBId]: [3] });
    expect(out[outId]).toEqual([1003]);
  });

  it("renaming and removing scenarios works", async () => {
    const { c } = await makeAdder();
    const id1 = c.addScenario();
    c.addScenario();
    c.renameScenario(id1, "Best case");
    expect(c.scenarios.find((s) => s.id === id1)?.name).toBe("Best case");
    c.removeScenario(id1);
    expect(c.scenarios).toHaveLength(1);
    expect(c.scenarios[0].name).not.toBe("Best case");
  });

  it("scenarios round-trip through extractInit (deep-copied, not aliased)", async () => {
    const { c, inAId } = await makeAdder();
    const id1 = c.addScenario();
    c.setScenarioOverride(id1, inAId, 42);

    const init = extractInit(c as unknown as ClassicPreset.Node);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.scenarios).toHaveLength(1);
    expect(clone.scenarios[0].overrides[inAId]).toBe(42);

    // Mutating the clone must not touch the original (deep copy, not a shared ref).
    clone.setScenarioOverride(clone.scenarios[0].id, inAId, 999);
    expect(c.scenarios[0].overrides[inAId]).toBe(42);
  });
});

describe("CompositeNode Data Table run mode", () => {
  async function makeAdder() {
    const c = new CompositeNode({ runMode: "data-table" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 0 };
    const inA = new CompositeInputNode({ label: "A" });
    const inB = new CompositeInputNode({ label: "B" });
    const outMarker = new CompositeOutputNode({ label: "Sum" });
    for (const n of [add, inA, inB, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inA, "value", add, "a");
    await connect(c.internalEditor, inB, "value", add, "b");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inAId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const inBId = c.addInputPort({ label: "B", exposure: "exposed", tier: "basic", internalNodeId: inB.id });
    const outId = c.addOutputPort({ label: "Sum", tier: "basic", internalNodeId: outMarker.id });
    return { c, inAId, inBId, outId };
  }

  it("with no axes, behaves exactly like a single run", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    const out = await c.data({ [inAId]: [2], [inBId]: [3] });
    expect(out[outId]).toBe(5);
  });

  it("one varying port sweeps a simple list (Excel's one-variable Data Table)", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setDataTableValues(inAId, [1, 2, 3]);
    const out = await c.data({ [inAId]: [999], [inBId]: [10] }); // B stays wired at 10
    expect(out[outId]).toEqual([11, 12, 13]);
  });

  it("two varying ports form the full-factorial Cartesian grid, row-major", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setDataTableValues(inAId, [1, 2]);
    c.setDataTableValues(inBId, [10, 20, 30]);
    const out = await c.data({});
    // 2 × 3 = 6 combinations, first axis slowest: (1,10)(1,20)(1,30)(2,10)(2,20)(2,30)
    expect(out[outId]).toEqual([11, 21, 31, 12, 22, 32]);
  });

  it("clearing a port's values (empty array) drops it back out of the grid", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setDataTableValues(inAId, [1, 2]);
    c.setDataTableValues(inAId, []); // clear
    const out = await c.data({ [inAId]: [5], [inBId]: [5] });
    expect(out[outId]).toBe(10); // back to a plain scalar single run
  });

  it("data table values round-trip through extractInit (deep-copied, not aliased)", async () => {
    const { c, inAId } = await makeAdder();
    c.setDataTableValues(inAId, [7, 8, 9]);

    const init = extractInit(c as unknown as ClassicPreset.Node);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.dataTableValues[inAId]).toEqual([7, 8, 9]);

    clone.setDataTableValues(inAId, [0]);
    expect(c.dataTableValues[inAId]).toEqual([7, 8, 9]); // original untouched
  });
});

describe("CompositeNode Simulation run mode", () => {
  // The plan's own concrete test: a two-node population model. `pop` holds
  // the running population (cyclic input "a" fed back from `grow`, its own
  // "starting population" literal used the first time nothing has fed it
  // yet); `grow` multiplies the current population by a fixed rate. pop and
  // grow feed each other — a REAL cable cycle among two ordinary relocated
  // nodes (this is exactly the shape createCompositeFromSelection produces
  // when a user selects a feedback pair and presses Ctrl+Shift+G).
  async function makePopulationModel(steps: number) {
    const c = new CompositeNode({ runMode: "simulation", simulationSteps: steps });
    const pop = new ArithmeticNode({ op: "add" });   // pop = feedback + 0
    pop.literals = { a: 100, b: 0 };                  // starting population, when nothing has fed it yet
    const grow = new ArithmeticNode({ op: "mul" });   // grow = pop * rate
    grow.literals = { a: 0, b: 1.1 };                 // 10% growth per step
    await c.internalEditor.addNode(pop as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(grow as unknown as Schemes["Node"]);
    await connect(c.internalEditor, grow, "result", pop, "a");  // feedback: grow → pop
    await connect(c.internalEditor, pop, "result", grow, "a");  // pop → grow (the other half of the cycle)

    const popMarker = new CompositeOutputNode({ label: "Population" });
    await c.internalEditor.addNode(popMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, pop, "result", popMarker, "value");
    const popOutId = c.addOutputPort({ label: "Population", tier: "basic", internalNodeId: popMarker.id });
    return { c, pop, grow, popOutId };
  }

  it("loopMembers sees the cycle as fully internal (the outer #CIRC! bypass this container gets for free)", async () => {
    const { c } = await makePopulationModel(5);
    const loop = loopMembers(c.internalEditor);
    expect(loop.size).toBe(2); // pop ⇄ grow
  });

  it("runs a bounded number of steps and returns a growth time series, not a hang or #CIRC!", async () => {
    const { c, popOutId } = await makePopulationModel(5);
    const out = await c.data({});
    const series = out[popOutId] as number[];
    expect(series).toHaveLength(5);
    expect(series.every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
    // Growth compounds at the fixed 1.1x rate every step, regardless of which
    // of the two loop nodes the Gauss-Seidel sweep happens to visit first.
    for (let i = 1; i < series.length; i++) {
      expect(series[i] / series[i - 1]).toBeCloseTo(1.1, 5);
    }
    // `pop` is added to internalEditor before `grow`, so the Gauss-Seidel
    // sweep visits it first each round: step 1 sees no feedback yet (nothing
    // has fed `pop` this simulation) and falls back to its own starting
    // literal (100) exactly like any other unwired input.
    expect(series[0]).toBeCloseTo(100, 5);
  });

  it("a longer run compounds further — simulationSteps genuinely drives the loop", async () => {
    const { c, popOutId } = await makePopulationModel(10);
    const out = await c.data({});
    const series = out[popOutId] as number[];
    expect(series).toHaveLength(10);
    expect(series[9]).toBeGreaterThan(series[0]);
    expect(series[9]).toBeCloseTo(100 * Math.pow(1.1, 9), 5);
  });

  it("the output marker's cachedResult mirrors the collected series (the drill-in value box)", async () => {
    // The series is read straight off the loop snapshots — the marker's own
    // data() never runs — so runSimulation must mirror the result into
    // cachedResult itself, or the drill-in editor's value box shows "—".
    const { c, popOutId } = await makePopulationModel(5);
    const out = await c.data({});
    const port = c.outputPorts.find((p) => p.id === popOutId)!;
    const marker = c.internalEditor.getNode(port.internalNodeId) as CompositeOutputNode;
    expect(marker.cachedResult).toEqual(out[popOutId]);
    expect(marker.cachedResult).toHaveLength(5);
  });

  it("other run modes on the SAME cyclic composite get #CIRC!, not a hang", async () => {
    const { c, popOutId } = await makePopulationModel(5);
    c.runMode = "single";
    const out = await c.data({});
    const val = out[popOutId] as { code?: string } | null;
    expect(val).not.toBeNull();
    expect(val?.code).toBe("#CIRC!");
  });

  it("a composite with NO internal loop falls back to a plain single run", async () => {
    const c = new CompositeNode({ runMode: "simulation", simulationSteps: 5 });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 2, b: 3 };
    const outMarker = new CompositeOutputNode({ label: "Sum" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const outId = c.addOutputPort({ label: "Sum", tier: "basic", internalNodeId: outMarker.id });

    const out = await c.data({});
    expect(out[outId]).toBe(5); // a scalar, not a 5-element array
  });

  it("simulationSteps round-trips through extractInit", async () => {
    const { c } = await makePopulationModel(7);
    const init = extractInit(c as unknown as ClassicPreset.Node);
    expect(init.simulationSteps).toBe(7);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.simulationSteps).toBe(7);
  });

  // "Stop when [output] [op] [value]" halts the loop the round the condition
  // holds; simulationSteps becomes the cap. Two evaluation paths: the output is a
  // loop node (read from the snapshot) or a downstream observer (seed + fetch).

  it("stopConditionMet compares numerically and never stops on a non-finite value", () => {
    expect(stopConditionMet(133.1, "gt", 130)).toBe(true);
    expect(stopConditionMet(121, "gt", 130)).toBe(false);
    expect(stopConditionMet(5, "le", 5)).toBe(true);
    expect(stopConditionMet(true, "eq", 1)).toBe(true);   // logical → 1
    expect(stopConditionMet(false, "eq", 1)).toBe(false);
    expect(stopConditionMet(null, "ge", 0)).toBe(false);  // missing never stops
    expect(stopConditionMet(NaN, "ge", 0)).toBe(false);
  });

  it("halts the round the condition holds on a LOOP output (read from the snapshot)", async () => {
    // 100 → 110 → 121 → 133.1; Population > 130 first holds at index 3.
    const { c, popOutId } = await makePopulationModel(10);
    c.stopWhenPortId = popOutId; c.stopWhenOp = "gt"; c.stopWhenValue = 130;
    const series = (await c.data({}))[popOutId] as number[];
    expect(series).toHaveLength(4);            // stopped at round 3, not the 10 cap
    expect(series[2]).toBeCloseTo(121, 5);     // last round the condition was false
    expect(series[3]).toBeCloseTo(133.1, 5);   // the round it held — recorded
  });

  it("halts on a downstream OBSERVER output (seed + fetch path), logical read as 1", async () => {
    // A Comparison (pop > 130) is NOT on the cycle — it observes the loop.
    const { c, pop, popOutId } = await makePopulationModel(10);
    const cmp = new ComparisonNode({ op: "gt" });
    cmp.literals = { a: 0, b: 130 };
    await c.internalEditor.addNode(cmp as unknown as Schemes["Node"]);
    await connect(c.internalEditor, pop, "result", cmp, "a");
    const stopMarker = new CompositeOutputNode({ label: "Reached" });
    await c.internalEditor.addNode(stopMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, cmp, "result", stopMarker, "value");
    const stopId = c.addOutputPort({ label: "Reached", tier: "basic", internalNodeId: stopMarker.id });
    c.stopWhenPortId = stopId; c.stopWhenOp = "eq"; c.stopWhenValue = 1; // stop when TRUE

    const out = await c.data({});
    expect(out[popOutId] as number[]).toHaveLength(4);
    expect(out[stopId]).toBe(true); // the stop output reads true at the end
  });

  it("runs the full cap when the condition never holds", async () => {
    const { c, popOutId } = await makePopulationModel(3);
    c.stopWhenPortId = popOutId; c.stopWhenOp = "gt"; c.stopWhenValue = 1000;
    const series = (await c.data({}))[popOutId] as number[];
    expect(series).toHaveLength(3);
  });

  it("a cleared stop port runs the full step count (no early stop)", async () => {
    const { c, popOutId } = await makePopulationModel(5);
    c.stopWhenPortId = ""; c.stopWhenOp = "gt"; c.stopWhenValue = 1;
    const series = (await c.data({}))[popOutId] as number[];
    expect(series).toHaveLength(5);
  });

  it("the stop-when config round-trips through extractInit", async () => {
    const { c, popOutId } = await makePopulationModel(10);
    c.stopWhenPortId = popOutId; c.stopWhenOp = "ge"; c.stopWhenValue = 130;
    const init = extractInit(c as unknown as ClassicPreset.Node);
    expect(init.stopWhenPortId).toBe(popOutId);
    expect(init.stopWhenOp).toBe("ge");
    expect(init.stopWhenValue).toBe(130);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.stopWhenPortId).toBe(popOutId);
    expect(clone.stopWhenOp).toBe("ge");
    expect(clone.stopWhenValue).toBe(130);
  });
});

describe("byRowValues (By-Row row semantics)", () => {
  it("iterates a list's elements, a matrix's rows, a scalar once, nothing for null", () => {
    expect(byRowValues([1, 2, 3])).toEqual([1, 2, 3]);          // list → elements
    expect(byRowValues([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]); // matrix → rows
    expect(byRowValues(5)).toEqual([5]);                        // scalar → one row
    expect(byRowValues(null)).toEqual([]);
    expect(byRowValues(undefined)).toEqual([]);
  });

  it("turns a frame into one single-row frame per row", () => {
    const f = frameFromCells(["x", "y"], [[1, 2], [3, 4], [5, 6]]);
    const rows = byRowValues(f);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => isFrameValue(r))).toBe(true);
    expect(frameRowCount(rows[0] as FrameValue)).toBe(1);
    const r0 = rows[0] as FrameValue;
    expect(r0.columns.map((c) => c.name)).toEqual(["x", "y"]);
    expect(r0.columns.map((c) => c.values[0])).toEqual([1, 2]);
  });
});

describe("CompositeNode By-Row run mode", () => {
  // A · 2 → Out: iterating A per row doubles each element.
  async function makeDoubler() {
    const c = new CompositeNode({ runMode: "by-row" });
    const inA = new CompositeInputNode({ label: "A" });
    const mul = new ArithmeticNode({ op: "mul" });
    mul.literals = { a: 0, b: 2 };
    const outMarker = new CompositeOutputNode({ label: "Out" });
    for (const n of [inA, mul, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inA, "value", mul, "a");
    await connect(c.internalEditor, mul, "result", outMarker, "value");
    const aId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const outId = c.addOutputPort({ label: "Out", tier: "basic", internalNodeId: outMarker.id });
    c.byRowPortId = aId;
    return { c, aId, outId };
  }

  it("runs the subgraph once per row of the chosen port, collecting a per-output series", async () => {
    const { c, aId, outId } = await makeDoubler();
    const out = await c.data({ [aId]: [[1, 2, 3]] }); // the port's wired value is the list [1,2,3]
    expect(out[outId]).toEqual([2, 4, 6]);
  });

  it("with no port chosen, collapses to a single normal pass (scalar, not a series)", async () => {
    const { c, aId, outId } = await makeDoubler();
    c.byRowPortId = "";
    const out = await c.data({ [aId]: [5] }); // scalar 5 → single pass → 10, not [10]
    expect(out[outId]).toBe(10);
  });

  it("caps the number of rows at BY_ROW_MAX_ROWS", async () => {
    const { c, aId, outId } = await makeDoubler();
    const big = Array.from({ length: BY_ROW_MAX_ROWS + 100 }, (_, i) => i);
    const out = await c.data({ [aId]: [big] });
    expect((out[outId] as number[]).length).toBe(BY_ROW_MAX_ROWS);
  });

  it("byRowPortId round-trips through extractInit", async () => {
    const { c, aId } = await makeDoubler();
    const init = extractInit(c as unknown as ClassicPreset.Node);
    expect(init.byRowPortId).toBe(aId);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.byRowPortId).toBe(aId);
  });

  it("clears byRowPortId when its input port is removed", async () => {
    const { c, aId } = await makeDoubler();
    c.removeInputPort(aId);
    expect(c.byRowPortId).toBe("");
  });
});

describe("CompositeNode Goal Seek run mode", () => {
  // A + B → Sum: drive A so Sum hits a target with B wired.
  async function makeAdder() {
    const c = new CompositeNode({ runMode: "goal-seek" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 0 };
    const inA = new CompositeInputNode({ label: "A" });
    const inB = new CompositeInputNode({ label: "B" });
    const outMarker = new CompositeOutputNode({ label: "Sum" });
    for (const n of [add, inA, inB, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inA, "value", add, "a");
    await connect(c.internalEditor, inB, "value", add, "b");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inAId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const inBId = c.addInputPort({ label: "B", exposure: "exposed", tier: "basic", internalNodeId: inB.id });
    const outId = c.addOutputPort({ label: "Sum", tier: "basic", internalNodeId: outMarker.id });
    return { c, inAId, inBId, outId };
  }

  it("drives the input until the output reaches the target, and emits the solution", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    const out = await c.data({ [inBId]: [10] }); // Sum = A + 10, want 15 → A = 5
    // The composite's OUTPUT is its solution (the solved driver), not the achieved
    // output — so the Solution hero's socket wires the answer downstream.
    expect(c.goalSeekResult as number).toBeCloseTo(5, 4);
    expect(out[outId] as number).toBeCloseTo(5, 4);
  });

  it("solves a negative driver too, emitting the solution", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 4 });
    const out = await c.data({ [inBId]: [10] }); // want 4 → A = -6
    expect(c.goalSeekResult as number).toBeCloseTo(-6, 4);
    expect(out[outId] as number).toBeCloseTo(-6, 4);
  });

  // Out = B, ignoring the driven A: no value of A can move the output → #CONV!.
  it("returns #CONV! when the output can't reach the target", async () => {
    const c = new CompositeNode({ runMode: "goal-seek" });
    const inA = new CompositeInputNode({ label: "A" });
    const inB = new CompositeInputNode({ label: "B" });
    const outMarker = new CompositeOutputNode({ label: "Out" });
    for (const n of [inA, inB, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inB, "value", outMarker, "value"); // Out = B (A unused)
    const inAId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const inBId = c.addInputPort({ label: "B", exposure: "exposed", tier: "basic", internalNodeId: inB.id });
    const outId = c.addOutputPort({ label: "Out", tier: "basic", internalNodeId: outMarker.id });
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 99 });
    const out = await c.data({ [inBId]: [10] }); // Out is 10 for any A, target 99 unreachable
    expect(isSolError(out[outId])).toBe(true);
    expect((out[outId] as { code: string }).code).toBe("#CONV!");
  });

  it("arm-and-run: holds the solution and flags stale until Solve", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    const out1 = await c.data({ [inBId]: [10] }); // first call solves: A = 5
    expect(out1[outId] as number).toBeCloseTo(5, 4);
    expect(c.stale).toBe(false);
    // An input change does NOT re-solve — it holds the old solution and flags stale.
    const out2 = await c.data({ [inBId]: [20] }); // would be A = -5, but not solved
    expect(out2[outId] as number).toBeCloseTo(5, 4); // held
    expect(c.stale).toBe(true);
    // Solve re-runs against the new input.
    c.requestSolve();
    const out3 = await c.data({ [inBId]: [20] });
    expect(out3[outId] as number).toBeCloseTo(-5, 4);
    expect(c.stale).toBe(false);
  });

  it("arm-and-run: an INTERNAL edit flags the held solve stale (dot must not lie)", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    await c.data({ [inBId]: [10] }); // solves: A = 5
    expect(c.stale).toBe(false);
    // A drill-in edit to the SUBGRAPH (value edits arrive via process.ts's
    // markInternalEditChain; topology via the internal-editor pipe) must flag
    // stale — the inputs/config key alone can't see it.
    c.markInternalEdit();
    await c.data({ [inBId]: [10] }); // same inputs — still holds, but now stale
    expect(c.stale).toBe(true);
  });

  it("arm-and-run: an internal TOPOLOGY change (editor pipe) flags stale too", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    await c.data({ [inBId]: [10] });
    expect(c.stale).toBe(false);
    const anyConn = c.internalEditor.getConnections()[0]!;
    await c.internalEditor.removeConnection(anyConn.id); // fires connectionremoved
    await c.data({ [inBId]: [10] });
    expect(c.stale).toBe(true);
  });

  it("inside-only Solve runs on marker seeds (ignores wiring) and writes the solution back", async () => {
    const { c, inAId, inBId, outId } = await makeAdder();
    const inAMarker = c.internalEditor.getNode(c.inputPorts.find((p) => p.id === inAId)!.internalNodeId) as unknown as { defaultValue: number | null };
    const inBMarker = c.internalEditor.getNode(c.inputPorts.find((p) => p.id === inBId)!.internalNodeId) as unknown as { defaultValue: number | null };
    inBMarker.defaultValue = 3; // seed B = 3 from inside
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    // Inside solve ignores the wired B=99 and uses the seed 3 → Sum = A + 3 = 15 → A = 12.
    c.requestSolve(true);
    const out = await c.data({ [inBId]: [99] });
    expect(out[outId] as number).toBeCloseTo(12, 4); // used seed 3, not wired 99
    expect(inAMarker.defaultValue as number).toBeCloseTo(12, 4); // solution written back to the driver marker
  });

  it("syncPortLabels pulls each port's label from its renamed marker", async () => {
    const { c, inAId, outId } = await makeAdder();
    const inMarker = c.internalEditor.getNode(c.inputPorts.find((p) => p.id === inAId)!.internalNodeId)!;
    const outMarker = c.internalEditor.getNode(c.outputPorts.find((p) => p.id === outId)!.internalNodeId)!;
    (inMarker as unknown as { label: string }).label = "Renamed In";
    (outMarker as unknown as { label: string }).label = "Renamed Out";
    c.syncPortLabels();
    expect(c.inputPorts.find((p) => p.id === inAId)!.label).toBe("Renamed In");
    expect(c.inputs[inAId]!.label).toBe("Renamed In"); // the rete socket the card renders
    expect(c.outputPorts.find((p) => p.id === outId)!.label).toBe("Renamed Out");
    expect(c.outputs[outId]!.label).toBe("Renamed Out");
  });

  it("goalSeek round-trips through extractInit (deep-copied, not aliased)", async () => {
    const { c, inAId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 42 });
    const init = extractInit(c as unknown as ClassicPreset.Node);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.goalSeek).toEqual({ inputPortId: inAId, outputPortId: outId, target: 42 });
    clone.setGoalSeek({ target: 0 });
    expect(c.goalSeek!.target).toBe(42); // original untouched
  });

  it("removing the driven input clears the goal-seek config", async () => {
    const { c, inAId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 15 });
    c.removeInputPort(inAId);
    expect(c.goalSeek).toBeNull();
  });

  it("respects driver bounds — a root outside [lo, hi] is unreachable (#CONV!), reachable without them", async () => {
    // Sum = A + B, B = 10, want 5 → the true A = −5. Bounds [0, 100] exclude it, so
    // the constrained search finds no sign change and reports #CONV!.
    const { c, inAId, inBId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 5, boundsLo: 0, boundsHi: 100 });
    const bounded = await c.data({ [inBId]: [10] });
    expect(isSolError(bounded[outId])).toBe(true);
    expect((bounded[outId] as { code: string }).code).toBe("#CONV!");
    // Drop the bounds and re-solve: the same model now reaches −5.
    c.setGoalSeek({ boundsLo: undefined, boundsHi: undefined });
    c.requestSolve();
    const free = await c.data({ [inBId]: [10] });
    expect(free[outId] as number).toBeCloseTo(-5, 3);
  });

  it("goalSeek solver params round-trip through extractInit", async () => {
    const { c, inAId, outId } = await makeAdder();
    c.setGoalSeek({ inputPortId: inAId, outputPortId: outId, target: 1, maxIterations: 20, tolerance: 1e-3, boundsLo: -5, boundsHi: 5 });
    const init = extractInit(c as unknown as ClassicPreset.Node);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(clone.goalSeek).toMatchObject({ maxIterations: 20, tolerance: 1e-3, boundsLo: -5, boundsHi: 5 });
  });
});

describe("CompositeNode Monte Carlo run mode", () => {
  // Sum = A + B, both exposed; A carries an uncertainty spread declared on its
  // drill-in marker, B is a plain wired value.
  async function makeAdder(spread: number, dist: "normal" | "uniform" = "normal") {
    const c = new CompositeNode({ runMode: "montecarlo" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 0 };
    const inA = new CompositeInputNode({ label: "A", defaultValue: 100, uncertainty: spread, distribution: dist });
    const inB = new CompositeInputNode({ label: "B" });
    const outMarker = new CompositeOutputNode({ label: "Sum" });
    for (const n of [add, inA, inB, outMarker]) await c.internalEditor.addNode(n as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inA, "value", add, "a");
    await connect(c.internalEditor, inB, "value", add, "b");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inAId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inA.id });
    const inBId = c.addInputPort({ label: "B", exposure: "exposed", tier: "basic", internalNodeId: inB.id });
    const outId = c.addOutputPort({ label: "Sum", tier: "basic", internalNodeId: outMarker.id });
    return { c, inA, inAId, inBId, outId };
  }

  it("samples the uncertain input and surfaces the output as mean ± sd", async () => {
    const { c, inBId, outId } = await makeAdder(10);
    c.setMonteCarlo({ samples: 4000, seed: 1 });
    const out = await c.data({ [inBId]: [0] }); // Sum = A (mean 100, σ 10) + 0
    const u = out[outId] as { kind: string; value: number; error: number; samples?: number[] };
    expect(u.kind).toBe("uncertain");
    expect(u.value).toBeCloseTo(100, 0); // mean ≈ 100
    expect(u.error).toBeGreaterThan(7); // sd ≈ 10 (loose bound — sampling noise)
    expect(u.error).toBeLessThan(13);
    expect(u.samples).toHaveLength(4000);
  });

  it("is deterministic in the seed — same seed replays the identical summary", async () => {
    const runOnce = async () => {
      const { c, inBId, outId } = await makeAdder(10);
      c.setMonteCarlo({ samples: 500, seed: 7 });
      const out = await c.data({ [inBId]: [0] });
      return out[outId] as { value: number; error: number };
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.value).toBe(b.value);
    expect(a.error).toBe(b.error);
  });

  it("a different seed gives a different draw", async () => {
    const { c, inBId, outId } = await makeAdder(10);
    c.setMonteCarlo({ samples: 500, seed: 1 });
    const a = (await c.data({ [inBId]: [0] }))[outId] as { value: number };
    c.setMonteCarlo({ seed: 2 });
    c.requestSolve();
    const b = (await c.data({ [inBId]: [0] }))[outId] as { value: number };
    expect(a.value).not.toBe(b.value);
  });

  it("with no uncertain input, collapses to a single ordinary pass", async () => {
    const { c, inBId, outId } = await makeAdder(0); // spread 0 → not sampled
    expect(c.isHeavyMode()).toBe(false);
    const out = await c.data({ [inBId]: [5] });
    expect(out[outId]).toBe(105); // a plain scalar (100 seed + 5), not an uncertain
  });

  it("mirrors the summary into the output marker's cachedResult (drill-in box)", async () => {
    const { c, inBId, outId } = await makeAdder(10);
    c.setMonteCarlo({ samples: 300, seed: 5 });
    const out = await c.data({ [inBId]: [0] });
    const marker = c.internalEditor.getNode(c.outputPorts.find((p) => p.id === outId)!.internalNodeId) as CompositeOutputNode;
    expect(marker.cachedResult).toBe(out[outId]);
  });

  it("arm-and-run: holds and flags stale when a marker's spread changes", async () => {
    const { c, inA, inBId, outId } = await makeAdder(10);
    c.setMonteCarlo({ samples: 300, seed: 1 });
    const first = (await c.data({ [inBId]: [0] }))[outId] as { error: number };
    expect(c.stale).toBe(false);
    inA.uncertainty = 20; // widen the error bar inside the drill-in
    const held = (await c.data({ [inBId]: [0] }))[outId] as { error: number };
    expect(held.error).toBe(first.error); // held (not re-sampled)
    expect(c.stale).toBe(true);
  });

  it("monteCarlo config round-trips through extractInit; marker uncertainty rides the internal snapshot", async () => {
    const { c } = await makeAdder(15, "uniform");
    c.setMonteCarlo({ samples: 250, seed: 3 });
    const init = extractInit(c as unknown as ClassicPreset.Node);
    const clone = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    await clone.hydrate(ctorRegistry());
    expect(clone.monteCarlo).toEqual({ samples: 250, seed: 3 });
    const marker = clone.internalEditor.getNodes().find((n) => n instanceof CompositeInputNode && (n as CompositeInputNode).uncertainty === 15) as CompositeInputNode;
    expect(marker).toBeDefined();
    expect(marker.distribution).toBe("uniform");
  });
});
