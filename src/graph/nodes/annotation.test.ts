import { describe, it, expect } from "vitest";
import { NoteNode } from "./annotation";
import { SolenoidSocket } from "../sockets";
import { parseDateToSerial } from "./date";
import { installErrorGuards } from "../errorValue";

const typeOf = (n: NoteNode, key: string) => {
  const s = n.outputs[key]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : undefined;
};

describe("NoteNode frontmatter outputs", () => {
  it("a plain note has no outputs and empty data", () => {
    const n = new NoteNode({ body: "just a sticky note" });
    expect(n.fieldKeys()).toEqual([]);
    expect(Object.keys(n.outputs)).toEqual([]);
    expect(n.data()).toEqual({});
    expect(n.renderBody).toBe("just a sticky note");
  });

  it("builds typed outputs from frontmatter and emits values via data()", () => {
    const n = new NoteNode({
      body: ["---", "title: Budget", "count: 42", "active: true", "due: 2026-03-01", "tags: [a, b]", "---", "# Body"].join("\n"),
    });
    expect(n.fieldKeys()).toEqual(["title", "count", "active", "due", "tags"]);
    expect(typeOf(n, "title")).toBe("string");
    expect(typeOf(n, "count")).toBe("number");
    expect(typeOf(n, "active")).toBe("logical");
    expect(typeOf(n, "due")).toBe("date");
    expect(typeOf(n, "tags")).toBe("strlist");
    expect(n.data()).toEqual({
      title: "Budget",
      count: 42,
      active: true,
      due: Math.round(parseDateToSerial("2026-03-01")),
      tags: ["a", "b"],
    });
    expect(n.renderBody).toBe("# Body");
  });

  it("syncFields adds, removes, and reports dropped keys when the body changes", () => {
    const n = new NoteNode({ body: "---\na: 1\nb: 2\n---" });
    expect(n.fieldKeys()).toEqual(["a", "b"]);
    n.body = "---\na: 1\nc: 3\n---";
    const { removed } = n.syncFields();
    expect(removed).toEqual(["b"]);
    expect(n.fieldKeys()).toEqual(["a", "c"]);
    expect(n.outputs.b).toBeUndefined();
    expect(typeOf(n, "c")).toBe("number");
  });

  it("retyping a key (value family change) reports it as retyped, not removed", () => {
    const n = new NoteNode({ body: "---\nx: 1\n---" });
    expect(typeOf(n, "x")).toBe("number");
    n.body = "---\nx: hello\n---";
    const { removed, retyped } = n.syncFields();
    expect(removed).toEqual([]); // the key + its output survive
    expect(retyped).toEqual([{ key: "x", type: "string" }]);
    expect(n.outputs.x).toBeDefined(); // output still present (caller decides on cables)
    expect(typeOf(n, "x")).toBe("string");
    expect(n.fieldValues()).toEqual({ x: "hello" });
  });

  it("a removed key reports removed (output gone); an unchanged key reports neither", () => {
    const n = new NoteNode({ body: "---\na: 1\nb: 2\n---" });
    n.body = "---\na: 9\n---"; // b gone, a same type (value-only change)
    const { removed, retyped } = n.syncFields();
    expect(removed).toEqual(["b"]);
    expect(retyped).toEqual([]);
    expect(n.fieldValues()).toEqual({ a: 9 });
  });

  it("a persisted per-key override pins the type and coerces the value", () => {
    const n = new NoteNode({ body: "---\nid: 42\n---", fieldTypes: { id: "string" } });
    expect(typeOf(n, "id")).toBe("string");
    expect(n.data()).toEqual({ id: "42" });
  });

  it("prunes overrides for keys no longer in the body", () => {
    const n = new NoteNode({ body: "---\nid: 42\n---", fieldTypes: { id: "string", gone: "number" } });
    expect(n.fieldTypes).toEqual({ id: "string" });
  });

  it("fieldValues() stays safe after installErrorGuards wraps data() (UI read path)", () => {
    const n = new NoteNode({ body: "---\nx: 1\n---" });
    installErrorGuards(n); // same wrap the engine applies on node creation
    // NoteNode is in errorValue.ts's SEES_ERRORS (its inline-ref inputs are
    // independent lanes, like Conduit/CableSwitch — one bad ref mustn't blank every
    // other ref in the same note), so the wrapper skips firstInputError and calls
    // NoteNode's own data() directly, which tolerates a bare call (inputs optional).
    // fieldValues() is still the UI's accessor of choice — it needs no inputs object
    // and matches every other node's cached-value read path.
    expect(() => (n.data as () => unknown)()).not.toThrow();
    expect(n.fieldValues()).toEqual({ x: 1 });
  });
});

describe("NoteNode inline-ref inputs", () => {
  it("a plain note has no inputs", () => {
    const n = new NoteNode({ body: "just a sticky note" });
    expect(n.refKeys()).toEqual([]);
    expect(Object.keys(n.inputs)).toEqual([]);
  });

  it("mints an `any` INPUT socket per distinct `=name` span, source order", () => {
    const n = new NoteNode({ body: "Revenue was `=revenue` and cost was `=cost`." });
    expect(n.refKeys()).toEqual(["revenue", "cost"]);
    expect(typeOf(n, "revenue")).toBeUndefined(); // typeOf checks OUTPUTS
    expect(n.inputs.revenue?.socket.name).toBe("any");
    expect(n.inputs.cost?.socket.name).toBe("any");
  });

  it("de-duplicates a repeated ref and ignores frontmatter block content", () => {
    const n = new NoteNode({ body: "---\nrevenue: 1\n---\n`=revenue` again `=revenue` again." });
    // `revenue` is both a frontmatter OUTPUT key and an inline-ref name — separate
    // namespaces (inputs vs outputs), so both are minted with no collision.
    expect(n.fieldKeys()).toEqual(["revenue"]);
    expect(n.refKeys()).toEqual(["revenue"]);
  });

  it("syncFields reports a vanished ref as removedInputs", () => {
    const n = new NoteNode({ body: "`=a` and `=b`." });
    expect(n.refKeys()).toEqual(["a", "b"]);
    n.body = "just `=a` now.";
    const { removedInputs } = n.syncFields();
    expect(removedInputs).toEqual(["b"]);
    expect(n.refKeys()).toEqual(["a"]);
    expect(n.inputs.b).toBeUndefined();
  });

  it("data(inputs) caches the resolved ref value for the component to read", () => {
    const n = new NoteNode({ body: "Total: `=total`." });
    n.data({ total: [42] });
    expect(n.refValue("total")).toBe(42);
  });
});
