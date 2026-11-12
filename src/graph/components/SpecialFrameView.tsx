// [[table-popup#The Pivot view]]
// A frame drawn in the view its popup opens on, wherever a surface shows the frame itself (a Display on the canvas, a
// Dashboard box, a Report): a PIVOTBY output as its Pivot, Describe's profile as its Profile tiles. A plain frame has
// no such view, and the caller draws its grid. The popup's own pick is `TablePopup.tsx` (`setView`); a new default view
// joins here too.
import type { ReactNode } from "react";
import type { FrameValue } from "../frame";
import { pivotLayoutOf } from "../pivotLayout";
import { describeTilesOf } from "../describeProfile";
import { getProfileView } from "../tablePopupStore";
import { PivotFigure } from "./PivotFigure";

/** The frame's default popup view as a figure, or null for a frame whose popup opens on the grid. `sourceId` is the
 *  card the frame comes from, whose Pivot view options and folds the figure shares. */
export function specialFrameView(frame: FrameValue, sourceId?: string): ReactNode | null {
  const pivot = pivotLayoutOf(frame);
  if (pivot) return <PivotFigure frame={frame} layout={pivot} sourceId={sourceId} />;
  const tiles = describeTilesOf(frame);
  const Profile = tiles ? getProfileView() : null;
  if (tiles && Profile) return <Profile tiles={tiles} query="" />;
  return null;
}
