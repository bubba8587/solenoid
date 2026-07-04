import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards, isSolError, solError, type SolError } from "./errorValue";
import { loopMembers } from "./process";
import seed from "./seedGraphs/error-codes.json";

// Loads the error-codes showcase seed and runs it through a real editor +
// DataflowEngine with the SAME wrappers + cycle handling Canvas/processGraph use,
// then checks that every ISERROR cluster lights up with the code its row promises.
// A wrong socket key or a producer that quietly returns null shows up here as a
// blank (null seenError) instead of in the running app.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type AnyNode = ClassicPreset.Node & {
  outputs: Record<string, unknown>;
  seenError?: SolError | null;
  cachedValue?: unknown;
};

const EXPECTED: Record<string, string> = {
  c_div: "#DIV/0!", c_dom: "#DOMAIN!", c_rng: "#OVERFLOW!", c_syn: "#SYNTAX!",
  c_val: "#VALUE!", c_na: "#N/A", c_conv: "#CONV!", c_ref: "#REF!",
  c_shp: "#SHAPE!", c_nam: "#NAME?", c_circ: "#CIRC!",
};

describe("error-codes seed", () => {
  it("every ISERROR cluster reports the code its row demonstrates", async () => {
    const editor = new NodeEditor<Schemes>();
    installInputCoercion(editor);
    editor.addPipe((ctx) => {
      if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
      return ctx;
    });
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);

    const byId = new Map<string, AnyNode>();
    for (const sn of (seed.nodes as SavedNode[])) {
      const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => AnyNode>)[sn.type];
      expect(Ctor, `unknown type ${sn.type}`).toBeTypeOf("function");
      const node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.literals) anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
      byId.set(sn.id, node);
      await editor.addNode(node as unknown as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      const src = byId.get(c.source)!, tgt = byId.get(c.target)!;
      await editor.addConnection(
        new ClassicPreset.Connection(src, c.sourceOutput, tgt, c.targetInput) as Schemes["Connection"],
      );
    }

    // processGraph's cycle handling: seed the loop members' cache with #CIRC! so the
    // downstream Display/ISERROR compute against it instead of deadlocking.
    const circ = solError("#CIRC!", "loop");
    for (const id of loopMembers(editor)) {
      const node = editor.getNode(id) as unknown as AnyNode;
      const outs: Record<string, unknown> = {};
      for (const k of Object.keys(node.outputs)) outs[k] = circ;
      engine.cache.add(id, Object.assign(Promise.resolve(outs), { cancel() {} }));
    }

    // Fetch every node (runs each ISERROR's data() so it records seenError).
    for (const node of editor.getNodes()) {
      await engine.fetch(node.id);
    }

    for (const [id, code] of Object.entries(EXPECTED)) {
      const check = byId.get(id)!;
      expect(check.seenError, `${id} saw no error`).not.toBeNull();
      expect(check.seenError?.code, `${id} expected ${code}`).toBe(code);
    }

    // And each Display in front of a check is showing the badge, not a blank.
    for (const dispId of ["d_div", "d_conv", "d_shp", "d_nam", "d_circ"]) {
      expect(isSolError(byId.get(dispId)!.cachedValue), `${dispId} blank`).toBe(true);
    }
  });
});
