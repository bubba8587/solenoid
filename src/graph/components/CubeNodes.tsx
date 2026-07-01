// Cube (recursive container) node components: Build Cube, Nest Join, Cube Columns.
import type { BuildCubeNode as BuildCubeNodeType, NestJoinNode as NestJoinNodeType, CubeColumnsNode as CubeColumnsNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { CubeDisplay } from "./CubeDisplay";
import { NodeShell, type NodeProps } from "./nodeKit";

// ─── BUILD CUBE ────────────────────────────────────────────────────────────────
// A leading `name` (the column header) + extensible `any` cell rows. Each row is
// one cell of the single column: wire a frame/list/cube, or type a scalar into an
// unwired row. The direct answer to "how does a non-frame get into a cube cell".

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
// Parent + child frame + key column + nested-column name → a cube. All four inputs
// render as the standard inline rows (the two text fields commit on Enter/blur).

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
