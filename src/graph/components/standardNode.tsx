import type { ReactNode } from "react";
import { NodeShell, type NodeProps, type ShellNode } from "./nodeKit";
import { InlineInputs, type InlineNode } from "./inlineInput";
import { ExtensibleInputs, type ExtensibleNode } from "./ExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { RecalcButton } from "./RecalcButton";

// Factories for the input-rows-then-one-result-box shape; a node needing more writes its
// component against NodeShell directly.
type Displayable = unknown;

/** `recalc` adds a volatile-node Recalculate button with the given tooltip. */
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
