// [[B3]] sameNodeEverywhere, [[C100]] chartIsAValue
import type { ReactNode } from "react";
import { NodeFormatContext } from "./nodeContext";
import { peekKindFor } from "../valuePeekKind";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { TableDisplay } from "./TableDisplay";
import { ValueDisplay } from "./nodeKit";
import { ChartFigure } from "./chartView";
import { MermaidView } from "./MermaidView";
import { SvgFigure } from "./SvgFigure";
import { LambdaValueView } from "./LambdaView";
import { nodeOutputElemFamily, type DisplayValue } from "./valueDisplayFormat";
import type { FrameValue, CubeValue } from "../frame";
import type { ChartValue } from "../chartValue";
import type { MermaidValue } from "../mermaidValue";
import type { SvgValue } from "../svgValue";
import type { LambdaValue } from "../nodes/lambda";

/** Rendered by the Display's own value views ([[B3]] sameNodeEverywhere) in the producing node's format context; read-only, with Frames and tables as a head-5 preview and no chip. */
export function SocketValuePeek({ value, nodeId }: { value: unknown; nodeId: string }) {
  const kind = peekKindFor(value);
  let body: ReactNode;
  switch (kind) {
    case "frame":
      body = <FrameDisplay frame={value as FrameValue} full={false} previewRows={5} peek />;
      break;
    case "cube":
      body = <CubeDisplay cube={value as CubeValue} full={false} peek />;
      break;
    case "chart":
      body = <ChartFigure value={value as ChartValue} width={200} height={120} />;
      break;
    case "mermaid":
      body = <MermaidView source={(value as MermaidValue).source} />;
      break;
    case "svg":
      body = <SvgFigure value={value as SvgValue} height={120} />;
      break;
    case "lambda":
      body = <LambdaValueView value={value as LambdaValue} view={undefined} />;
      break;
    case "table":
      body = <TableDisplay table={value as number[][]} full={false} peek elem={nodeOutputElemFamily(nodeId)} />;
      break;
    case "list":
    case "scalar":
    case "empty":
    case "error":
      // `full` renders a list inline, with no chip.
      body = <ValueDisplay value={value as DisplayValue} full />;
      break;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      body = null;
    }
  }
  return (
    <NodeFormatContext.Provider value={nodeId}>
      {body}
    </NodeFormatContext.Provider>
  );
}
