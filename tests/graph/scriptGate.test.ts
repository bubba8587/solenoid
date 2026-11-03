// [[B18]] safeToShare: a foreign document's Script cards wait until the user lets its scripts run.
import { describe, it, expect, afterEach } from "vitest";
import { ScriptNode } from "../../src/graph/nodes/script";
import { throughBoundary } from "./boundaryKit";
import { docMetaStore } from "../../src/graph/docMetaStore";
import { scriptGate, scriptsAllowed, allowScripts } from "../../src/graph/scriptGate";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";

async function run(node: ScriptNode) {
  return (await (node.data({}) as Promise<{ result: unknown }>)).result;
}

afterEach(() => { docMetaStore.setDocMeta(null); forgetAllNodes(); });

describe("scriptGate", () => {
  it("the user's own document runs its scripts", async () => {
    const node = new ScriptNode({ expr: "() => 7" });
    throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
    expect(scriptsAllowed()).toBe(true);
    expect(await run(node)).toBe(7);
    expect(scriptGate.waiting(node.id)).toBe(false);
  });

  it("a foreign document's script waits, then runs once allowed, and the grant saves with the document", async () => {
    docMetaStore.setDocMeta({ foreign: true });
    const node = new ScriptNode({ expr: "() => 7" });
    throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
    expect(await run(node)).toBe(null);
    expect(scriptGate.waiting(node.id)).toBe(true);
    await allowScripts();
    expect(scriptGate.waiting(node.id)).toBe(false);
    expect(await run(node)).toBe(7);
    expect(docMetaStore.docMeta()).toMatchObject({ foreign: true, scriptsAllowed: true });
  });

  it("a rewrite keeps the document's own trust, never the rewrite's", () => {
    docMetaStore.setDocMeta({ foreign: true });
    expect(docMetaStore.keepTrust({ author: "x", scriptsAllowed: true })).toEqual({ author: "x", foreign: true });
  });
});
