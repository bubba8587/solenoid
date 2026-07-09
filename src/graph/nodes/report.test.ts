import { describe, it, expect } from "vitest";
import { ReportNode } from "./report";
import { installErrorGuards } from "../errorValue";

describe("ReportNode", () => {
  it("starts blank: no refs, no embeds, no outputs", () => {
    const n = new ReportNode();
    expect(n.body).toBe("");
    expect(n.refKeys()).toEqual([]);
    expect(n.embeds).toEqual([]);
    expect(Object.keys(n.outputs)).toEqual([]);
    expect(n.data()).toEqual({});
  });

  it("mints an `any` INPUT socket per distinct `=name` span, source order", () => {
    const n = new ReportNode({ body: "Revenue was `=revenue`, up from `=lastRevenue`." });
    expect(n.refKeys()).toEqual(["revenue", "lastRevenue"]);
    expect(n.inputs.revenue?.socket.name).toBe("trueany");
    expect(n.inputs.lastRevenue?.socket.name).toBe("trueany");
  });

  it("syncRefs reports a vanished ref as removedInputs", () => {
    const n = new ReportNode({ body: "`=a` and `=b`." });
    n.body = "just `=a` now.";
    const { removedInputs } = n.syncRefs();
    expect(removedInputs).toEqual(["b"]);
    expect(n.refKeys()).toEqual(["a"]);
    expect(n.inputs.b).toBeUndefined();
  });

  it("data(inputs) caches the resolved ref value", () => {
    const n = new ReportNode({ body: "Total: `=total`." });
    n.data({ total: [42] });
    expect(n.refValue("total")).toBe(42);
  });

  it("addEmbed/removeEmbed manage the embedded-Note id list", () => {
    const n = new ReportNode();
    n.addEmbed("note-1");
    n.addEmbed("note-1"); // no duplicate
    n.addEmbed("note-2");
    expect(n.embeds).toEqual(["note-1", "note-2"]);
    n.removeEmbed("note-1");
    expect(n.embeds).toEqual(["note-2"]);
  });

  it("a persisted embeds array round-trips independently per instance (not aliased)", () => {
    const src = new ReportNode({ embeds: ["a", "b"] });
    const clone = new ReportNode({ embeds: src.embeds });
    clone.addEmbed("c");
    expect(src.embeds).toEqual(["a", "b"]);
    expect(clone.embeds).toEqual(["a", "b", "c"]);
  });

  it("is safe to call the installErrorGuards-wrapped data() with no inputs (independent ref lanes)", () => {
    const n = new ReportNode({ body: "`=x`" });
    installErrorGuards(n);
    expect(() => (n.data as () => unknown)()).not.toThrow();
  });
});
