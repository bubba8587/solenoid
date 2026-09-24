import { describe, it, expect, beforeEach } from "vitest";
import { commentStore } from "../../src/graph/commentStore";

describe("commentStore.update", () => {
  beforeEach(() => commentStore.clear());

  it("edits text and resolved, never the author", () => {
    const c = commentStore.add("n1", "Ada", "first");
    commentStore.update(c.id, { text: "edited", resolved: true, author: "Mallory" } as Parameters<typeof commentStore.update>[1]);
    expect(commentStore.list()[0]).toMatchObject({ author: "Ada", text: "edited", resolved: true });
  });
});
