// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[D43]], [[D102]] graphOnCore
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import type { FormatAnnotation } from "./formatAnnotationStore";
import { annotationFacts } from "./annotationFacts";

type AnyEditor = GraphEditor<{
  Node: GraphNode;
  Connection: GraphConnection<GraphNode, GraphNode>;
}>;

type Walked = {
  out: Record<string, FormatAnnotation | null>;
  down: Record<string, FormatAnnotation | null>;
  in: Record<string, FormatAnnotation | null>;
  origin: Record<string, string>;
};

/** The annotation walk over the whole graph (`annotate.rs`), run once by the core from each node's facts. */
function walk(editor: AnyEditor): Walked {
  return JSON.parse(editor.core().annotate(JSON.stringify(annotationFacts(editor)))) as Walked;
}

export type AnnotationResolver = {
  outAnnotation: (nodeId: string, outKey: string) => FormatAnnotation | undefined;
  inAnnotation: (nodeId: string, inKey: string) => FormatAnnotation | undefined;
  downstreamAnnotation: (nodeId: string, outKey: string) => FormatAnnotation | undefined;
  /** Where a node's value really comes from: back through Format Controllers and passthroughs that forward one input. */
  valueOrigin: (nodeId: string) => string;
};

/** The graph's annotations as they stand now; the walk runs on the first lookup. */
export function makeAnnotationResolver(editor: AnyEditor): AnnotationResolver {
  let w: Walked | undefined;
  const at = (part: "out" | "down" | "in") => (nodeId: string, key: string) =>
    (w ??= walk(editor))[part][`${nodeId}.${key}`] ?? undefined;
  return {
    outAnnotation: at("out"),
    inAnnotation: at("in"),
    downstreamAnnotation: at("down"),
    valueOrigin: (nodeId) => (w ??= walk(editor)).origin[nodeId] ?? nodeId,
  };
}

// Lives one microtask: annotations change on any pass, so never cache this on the connection version.
let _sharedResolver: AnnotationResolver | null = null;
let _sharedResolverEditor: AnyEditor | null = null;

export function sharedAnnotationResolver(editor: AnyEditor): AnnotationResolver {
  if (_sharedResolver && _sharedResolverEditor === editor) return _sharedResolver;
  _sharedResolver = makeAnnotationResolver(editor);
  _sharedResolverEditor = editor;
  queueMicrotask(() => {
    _sharedResolver = null;
    _sharedResolverEditor = null;
  });
  return _sharedResolver;
}
