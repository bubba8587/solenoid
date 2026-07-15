import { describe, it, expect } from "vitest";
import { isDocumentValue, makeDocument } from "./documentValue";
import { canConnect } from "./sockets";

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
});

describe("the `document` socket — identity-only object socket (like chart/lambda)", () => {
  it("connects document → document and to/from the trueany wildcard", () => {
    expect(canConnect("document", "document")).toBe(true);
    expect(canConnect("document", "trueany")).toBe(true);
    expect(canConnect("trueany", "document")).toBe(true);
  });
  it("does NOT flow into a scalar `any` or any data container", () => {
    expect(canConnect("document", "any")).toBe(false);
    expect(canConnect("document", "frame")).toBe(false);
    expect(canConnect("document", "string")).toBe(false);
    expect(canConnect("chart", "document")).toBe(false); // a chart is not a document
  });
});
