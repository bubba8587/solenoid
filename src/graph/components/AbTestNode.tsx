// tree/specs/computation/probability-pack.md § A/B Test
import type { AbTestNode as Node } from "../nodes/probability";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { ACCENT, WASH, MUTED, MUTED_WASH, PeakTag, Strip, areaPath, linePath, pairs, px, py, scaleOf } from "./probabilityPlot";

type Out = "chance" | "lift" | "low" | "high";

function peak(pts: ReadonlyArray<[number, number]>): [number, number] | null {
  return pts.reduce<[number, number] | null>((best, p) => (!best || p[1] > best[1] ? p : best), null);
}

export function AbTestComponent({ data, emit }: NodeProps<Node>) {
  const a = pairs(data.plotX, data.plotA);
  const b = pairs(data.plotX, data.plotB);
  const s = scaleOf([a, b]);
  const shown: Record<Out, typeof data.cachedChance> = {
    chance: data.cachedChance, lift: data.cachedLift, low: data.cachedLow, high: data.cachedHigh,
  };
  const tag = (pts: ReadonlyArray<[number, number]>, name: string, color: string) => {
    const top = s && peak(pts);
    if (!s || !top) return null;
    return <PeakTag x={px(s, top[0])} y={py(s, top[1])} color={color}>{name}</PeakTag>;
  };

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <Strip overlay={<>{tag(a, "A", MUTED)}{tag(b, "B", ACCENT)}</>}>
        {s && <>
          <path d={areaPath(s, a)} fill={MUTED_WASH} />
          <path d={linePath(s, a)} fill="none" stroke={MUTED} strokeWidth={1.5} />
          <path d={areaPath(s, b)} fill={WASH} />
          <path d={linePath(s, b)} fill="none" stroke={ACCENT} strokeWidth={1.75} />
        </>}
      </Strip>
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={(["chance", "lift", "low", "high"] as Out[]).map((key) => ({ key, label: data.outputs[key]?.label ?? "", value: shown[key] }))}
      />
    </NodeShell>
  );
}
