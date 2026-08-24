import { useEffect, useState, type ReactNode } from "react";
import { NodeShell, type NodeProps, type ShellNode } from "./nodeKit";
import { InlineInputs, type InlineNode } from "./inlineInput";
import { ExtensibleInputs, type ExtensibleNode } from "./ExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { TableDisplay } from "./TableDisplay";
import { RecalcButton } from "./RecalcButton";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

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

export type ToggleOptions<V extends string> = ReadonlyArray<{ value: V; label: string; title?: string }>;

/** Standard node with ONE segmented toggle above the input rows (DIFF's Δ/%/∇, Normalize's
 *  0–1/z, …): `read` the current pick off the node, `write` the new one back — the node's
 *  own setter when a mode relabels a socket — and the graph recomputes. `table` renders
 *  the result as a grid instead of the value box. */
export function makeToggleNodeComponent<N extends ShellNode & InlineNode, V extends string>(
  toggle: { read: (node: N) => V; write: (node: N, next: V) => void; options: ToggleOptions<V> },
  value: (node: N) => Displayable,
  opts: { table?: boolean } = {},
): (props: NodeProps<N>) => ReactNode {
  return function StandardToggleNode({ data, emit }: NodeProps<N>) {
    const live = toggle.read(data);
    const [cur, setCur] = useState(live);
    useEffect(() => { setCur(live); }, [live]);
    return (
      <NodeShell node={data} emit={emit}>
        <SegToggle arg
          value={cur}
          options={toggle.options}
          onChange={(next) => { setCur(next); toggle.write(data, next); void processGraph(data.id); }}
        />
        <InlineInputs node={data} emit={emit} />
        {opts.table
          ? <TableDisplay table={value(data) as Parameters<typeof TableDisplay>[0]["table"]} label={data.label} elem={nodeOutputElemFamily(data.id)} />
          : <ResultDisplay value={value(data)} label={data.label} />}
      </NodeShell>
    );
  };
}
