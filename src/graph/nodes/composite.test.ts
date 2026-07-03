import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import { ctorRegistry } from "../nodeCtorRegistry";
import { extractInit } from "../copyPaste";
import { loopMembers } from "../process";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "./composite";
import { NumberInputNode } from "./input";
import { ArithmeticNode } from "./scalar";

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
});
