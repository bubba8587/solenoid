// The ONE result box, so components don't each re-do the isFrame/isCube branch.
import type { ReactNode } from "react";
import { isFrameValue, isCubeValue } from "../frame";
import { ValueDisplay } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import type { DisplayValue } from "./valueDisplayFormat";

export function ResultDisplay({ value, label, full }: {
  value: unknown;
  label?: string;
  full?: boolean;
}): ReactNode {
  if (isCubeValue(value)) return <CubeDisplay cube={value} label={label} full={full} />;
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} full={full} />;
  return <ValueDisplay value={value as DisplayValue} full={full} />;
}
