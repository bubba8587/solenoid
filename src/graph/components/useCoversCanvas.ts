// [[A1]] visualGraphCalculator, [[html-in-canvas#The GPU texture budget]]
import { useEffect } from "react";

/** A full-screen surface over the canvas (a Dashboard's board, an HTML Page) stops the canvas painting while it covers
 *  it: `html.sol-canvas-covered` hides it (`visibility`, so the cards still measure as they recompute). */
export function useCoversCanvas(covering: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sol-canvas-covered", covering);
    return () => root.classList.remove("sol-canvas-covered");
  }, [covering]);
}
