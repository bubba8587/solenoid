import { describe, it, expect } from "vitest";
import { isDocumentValue, makeDocument } from "./documentValue";
import { describeValueKind } from "./valueKindLabel";

describe("DocumentValue", () => {
  it("makeDocument stamps the brand; isDocumentValue detects it", () => {
    const d = makeDocument("# Hi `=x`", { x: 5 }, { title: "T" });
    expect(isDocumentValue(d)).toBe(true);
    expect(d.body).toBe("# Hi `=x`");
    expect(d.refs).toEqual({ x: 5 });
    expect(d.frontmatter).toEqual({ title: "T" });
    // no frontmatter arg → the key is absent (a Report has no frontmatter)
    expect("frontmatter" in makeDocument("body")).toBe(false);
  });
  it("rejects non-documents", () => {
    expect(isDocumentValue({ __chart: true })).toBe(false);
    expect(isDocumentValue(null)).toBe(false);
    expect(isDocumentValue("string")).toBe(false);
  });
  it("describeValueKind labels it — the [object Object] safety net every value box runs", () => {
    expect(describeValueKind(makeDocument("# Hi"))).toBe("Document");
  });
  it("carries its producing node id when given (the Document chip's open-source hook)", () => {
    expect(makeDocument("b", {}, undefined, "n1").sourceId).toBe("n1");
    expect("sourceId" in makeDocument("b")).toBe(false);
  });
});

// The `document` socket's identity-only lattice rules ride socketConnect.test.ts's
// OBJECT_TYPES sweep ("object types are identity-only: self + trueany, never a
// regular lattice type"), which covers every direction this file once re-asserted.
