import type { ReactNode } from "react";
import { NodeShell, type NodeProps, type ShellNode } from "./nodeKit";
import { InlineInputs, type InlineNode } from "./inlineInput";
import { ExtensibleInputs, type ExtensibleNode } from "./ExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { RecalcButton } from "./RecalcButton";

// ─── Standard node-component factories ──────────────────────────────────────────
// The vast majority of nodes render the same shape: input rows, then one result
// box; these factories collapse that to a one-liner. Nodes that need more (an op
// <select>, a custom value render, local state) hand-write their component
// against NodeShell directly.

// A converted producer can read its cachedResult straight into the value box.
// ResultDisplay routes a Frame → FrameDisplay and a Cube → CubeDisplay; everything
// else (scalar / list / string / SolError / null — the array-semantics value
// model) falls through to ValueDisplay (red #CODE! badge, per-cell error/blank).
// `unknown` so a node whose output can be a frame/cube (the upgraded INDEX) fits.
type Displayable = unknown;

/** Options shared by the factories. `recalc` adds a volatile-node Recalculate
 *  button (the global F9 / requestRecalc trigger) with the given tooltip. */
type StandardOpts = { recalc?: string };

/** Standard node: inline input rows + a value box reading `value(node)`. */
export function makeNodeComponent<N extends ShellNode & InlineNode>(
  value: (node: N) => Displayable,
  opts: StandardOpts = {},
): (props: NodeProps<N>) => ReactNode {
  return function StandardNode({ data, emit }: NodeProps<N>) {
    return (
      <NodeShell node={data} emit={emit}>
        <InlineInputs node={data} emit={emit} />
        <ResultDisplay value={value(data)} label={data.label} />
        {opts.recalc != null && <RecalcButton title={opts.recalc} />}
      </NodeShell>
    );
  };
}

/** Standard node with add/remove input rows (CONCAT, list literal, …). */
export function makeExtensibleNodeComponent<N extends ShellNode & ExtensibleNode>(
  value: (node: N) => Displayable,
): (props: NodeProps<N>) => ReactNode {
  return function StandardExtensibleNode({ data, emit }: NodeProps<N>) {
    return (
      <NodeShell node={data} emit={emit}>
        <ExtensibleInputs node={data} emit={emit} />
        <ResultDisplay value={value(data)} label={data.label} />
      </NodeShell>
    );
  };
}
