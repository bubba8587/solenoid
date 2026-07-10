import {
  SolarPositionNode as SolarPositionNodeType,
  SunriseSunsetNode as SunriseSunsetNodeType,
  MoonPhaseNode as MoonPhaseNodeType,
} from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

export function SolarPositionComponent({ data, emit }: NodeProps<SolarPositionNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "elevation",   label: "ELEVATION °",   value: data.cachedElevation },
          { key: "azimuth",     label: "AZIMUTH °",     value: data.cachedAzimuth },
          { key: "declination", label: "DECLINATION °", value: data.cachedDeclination },
        ]}
      />
    </NodeShell>
  );
}

export function SunriseSunsetComponent({ data, emit }: NodeProps<SunriseSunsetNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "sunrise",   label: "SUNRISE",  value: data.cachedSunrise },
          { key: "sunset",    label: "SUNSET",   value: data.cachedSunset },
          { key: "daylength", label: "DAY (H)",  value: data.cachedDayLength },
        ]}
      />
    </NodeShell>
  );
}

export function MoonPhaseComponent({ data, emit }: NodeProps<MoonPhaseNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "phase",        label: "PHASE 0–1",   value: data.cachedPhase },
          { key: "age",          label: "AGE DAYS",    value: data.cachedAge },
          { key: "illumination", label: "ILLUMINATED", value: data.cachedIllumination },
        ]}
      />
    </NodeShell>
  );
}
