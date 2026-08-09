import type { ReactElement } from "react";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveArea } from "../activeGraph";
import { isInverseOp } from "../nodes/shared";
import type { BroadcastResult } from "../nodes/shared";
import {
  NORM_DIST_OP_META, NORM_S_DIST_OP_META, T_DIST_OP_META, CHISQ_DIST_OP_META,
  type NormDistNode, type NormSDistNode, type TDistNode, type ChisqDistNode,
} from "../nodes/dist-normal";
import {
  F_DIST_OP_META, BETA_DIST_OP_META, GAMMA_DIST_OP_META, LOGNORM_DIST_OP_META,
  type FDistNode, type BetaDistNode, type GammaDistNode, type LognormDistNode,
} from "../nodes/dist-continuous";
import { BINOM_DIST_OP_META, type BinomDistNode } from "../nodes/dist-discrete";

// One card shape for every merged distribution: the op dropdown covers the
// forward curves AND the inverse (quantile); picking an op across the
// forward/inverse line swaps the first input between x and Probability, pruning
// the departing socket's cables first.

interface DistOpNode {
  id: string;
  op: string;
  readonly xKey: string;
  readonly paramKeys: readonly string[];
  cachedResult: BroadcastResult;
  setOp(next: never): void;
}

function distComponent<N extends DistOpNode>(
  meta: Record<string, { label: string }>,
): (props: NodeProps<N>) => ReactElement {
  const ops = Object.entries(meta).map(([value, m]) => ({ value, label: m.label }));
  return function DistComponent({ data, emit }: NodeProps<N>) {
    const [op, setOpField] = useNodeField(data as DistOpNode, "op");

    async function pickOp(next: string) {
      if (next === data.op) return;
      const nextInv = isInverseOp(next);
      if (nextInv !== isInverseOp(data.op)) {
        await dropInputCables(data.id, [nextInv ? data.xKey : "prob"]);
        data.setOp(next as never);
        await getActiveArea()?.update("node", data.id);
      }
      setOpField(next);
    }

    return (
      <NodeShell node={data as never} emit={emit as never}>
        <InlineInputs
          node={data as never}
          emit={emit as never}
          keys={[isInverseOp(op) ? "prob" : data.xKey, ...data.paramKeys]}
        />
        <OpSelect value={op} onChange={(o) => void pickOp(o)} options={ops} />
        <ValueDisplay value={data.cachedResult} />
      </NodeShell>
    );
  };
}

export const NormDistComponent    = distComponent<NormDistNode>(NORM_DIST_OP_META);
export const NormSDistComponent   = distComponent<NormSDistNode>(NORM_S_DIST_OP_META);
export const TDistComponent       = distComponent<TDistNode>(T_DIST_OP_META);
export const ChisqDistComponent   = distComponent<ChisqDistNode>(CHISQ_DIST_OP_META);
export const FDistComponent       = distComponent<FDistNode>(F_DIST_OP_META);
export const BetaDistComponent    = distComponent<BetaDistNode>(BETA_DIST_OP_META);
export const GammaDistComponent   = distComponent<GammaDistNode>(GAMMA_DIST_OP_META);
export const LognormDistComponent = distComponent<LognormDistNode>(LOGNORM_DIST_OP_META);
export const BinomDistComponent   = distComponent<BinomDistNode>(BINOM_DIST_OP_META);
