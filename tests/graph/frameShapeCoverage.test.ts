import { describe, it, expect } from "vitest";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { frameShapeOf } from "../../src/graph/nodes/frameShapeHook";
import { passthroughForOutput } from "../../src/graph/nodes/passthrough";
import { ConduitNode } from "../../src/graph/nodes/conduit";

// declareOnce for frame SHAPE: a frame producer states its own output columns
// (`frameShape()`), forwards them (`passthrough()`), or is named below as genuinely
// data-dependent. Without this sweep a new frame node ships silently unknown — every
// downstream column picker, INDEX projection and conduit trace goes `trueany`, and
// nothing errors.

/** Producers whose column set cannot be known without running the graph. */
const DATA_DEPENDENT_FRAME_PRODUCERS: Record<string, string> = {
  BuildFrameNode: "the column COUNT is the wired matrix's width",
  KMeansNode: "one center column per NUMBER column of the fitted frame",
  PcaNode: "one component column per NUMBER column of the fitted frame",
  LogisticNode: "one coefficient row per feature of the fitted frame",
  ImportHtmlNode: "the columns come from the fetched page's table",
  WebSourceNode: "the columns come from the scraped page",
  DataFeedNode: "the columns come from the fetched feed",
  LocalFileNode: "the columns come from the opened file",
  CubeRollupNode: "the carried-over columns are re-inferred from the cube's cells",
  OutliersNode: "the Value column's type is inferred from the input list's cells",
  GroupByNode: "the Key column's type is inferred from the grouped values",
  TallyNode: "the Value column's type is inferred from the tallied values",
};

describe("every frame producer declares its shape (declareOnce)", () => {
  it("no catalog node emits a frame with no shape rule", () => {
    const offenders: string[] = [];
    const sanctionedSeen = new Set<string>();
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: object;
      try { inst = entry.create() as object; } catch { continue; }
      if (inst instanceof ConduitNode) continue; // lanes forward through conduitTrace
      const cls = inst.constructor.name;
      const outputs = (inst as { outputs?: Record<string, { socket?: { dataType?: string } }> }).outputs ?? {};
      for (const [key, port] of Object.entries(outputs)) {
        if (port?.socket?.dataType !== "frame") continue;
        if (cls in DATA_DEPENDENT_FRAME_PRODUCERS) { sanctionedSeen.add(cls); continue; }
        if (frameShapeOf(inst)) continue;
        if (passthroughForOutput(inst, key)) continue;
        offenders.push(`${type} (${cls}).${key}`);
      }
    }
    expect(
      offenders,
      `frame outputs with no static shape (declareOnce) — every downstream column picker and ` +
      `type projection reads them as unknown. Declare frameShape(), or add the class to ` +
      `DATA_DEPENDENT_FRAME_PRODUCERS with the reason:\n  ` + offenders.join("\n  "),
    ).toEqual([]);
    const stale = Object.keys(DATA_DEPENDENT_FRAME_PRODUCERS).filter((c) => !sanctionedSeen.has(c));
    expect(stale, `sanctioned classes that no longer emit an undeclared frame — drop:\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});
