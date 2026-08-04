// Cube (recursive container) node components: Build Cube, Nest Join, Cube Columns,
// Cube Rollup.
import type { BuildCubeNode as BuildCubeNodeType, NestJoinNode as NestJoinNodeType, CubeColumnsNode as CubeColumnsNodeType, CubeRollupNode as CubeRollupNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { CubeDisplay } from "./CubeDisplay";
import { FrameDisplay } from "./FrameDisplay";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { AGG_OP_OPTIONS } from "./FrameNodes";

// ─── BUILD CUBE ────────────────────────────────────────────────────────────────
// A leading `name` (the column header) + extensible `any` cell rows. Each row is
// one cell of the single column: wire a frame/list/cube, or type a scalar into an
// unwired row.

export function BuildCubeComponent({ data, emit }: NodeProps<BuildCubeNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["name"]}
        valueKeys={data.valueInputKeys()}
      />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── NEST JOIN ───────────────────────────────────────────────────────────────────
// Parent + child frame + key column + nested-column name → a cube.

export function NestJoinComponent({ data, emit }: NodeProps<NestJoinNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── CUBE COLUMNS ──────────────────────────────────────────────────────────────
// A leading `names` CSV (column headers) + extensible `any` column rows. Each row is
// one column: wire a list/cube/frame, or type a scalar into an unwired row.

export function CubeColumnsComponent({ data, emit }: NodeProps<CubeColumnsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["names"]}
        valueKeys={data.valueInputKeys()}
      />
      <CubeDisplay cube={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

// ─── CUBE ROLLUP ───────────────────────────────────────────────────────────────
// Aggregate a column inside a cube's nested sub-frames back to a flat Frame — the
// BOM/nested-costing shape ("cost of an assembly = SUM of its nested parts").

export function CubeRollupComponent({ data, emit }: NodeProps<CubeRollupNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} options={AGG_OP_OPTIONS} onChange={setOp} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
