// [[C68]] knapIsTheDocumentSyntax, [[reports-and-notes#The view of a Frame embed]]
import { describe, it, expect } from "vitest";
import { ReportNode } from "../../src/graph/nodes/report";
import { extractInit } from "../../src/graph/nodeInit";

describe("a Report keeps each Frame embed's view", () => {
  it("saves the view per input and loads it back", () => {
    const r = new ReportNode({ body: "{{ people }} {{ total }}" });
    r.setRefView("people", true);
    expect(r.refViews).toEqual({ people: "cards" });
    const back = new ReportNode(extractInit(r) as ConstructorParameters<typeof ReportNode>[0]);
    expect(back.refViews).toEqual({ people: "cards" });
    back.setRefView("people", false);
    expect(back.refViews).toEqual({});
  });

  it("drops a view when its input leaves the card, and keeps one on Records", () => {
    const r = new ReportNode({ body: "{{ people }} {{ records }}", refViews: { people: "cards", records: "cards" } });
    r.body = "{{ records }}";
    r.syncRefs();
    expect(r.refViews).toEqual({ records: "cards" });
  });
});
