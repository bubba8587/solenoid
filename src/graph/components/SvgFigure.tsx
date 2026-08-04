import { useLayoutEffect, useRef } from "react";
import type { SvgValue } from "../svgValue";
import { elementName } from "../svgLayer";

// Read-only: the pick happens only on the source node. The markup is TRUSTED
// (the author's own file / URL), the same model as the Image node's src.

export function SvgFigure({ value, height, className }: { value: SvgValue; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const h = height ?? value.height ?? 160;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = value.source || "";
    const svg = el.querySelector("svg");
    if (!svg) return;
    // Strip any hard-coded width/height that would fight the container.
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    if (value.selected && value.hoverColor) {
      for (const node of Array.from(svg.querySelectorAll<SVGElement>("*"))) {
        if (elementName(node) === value.selected) {
          node.style.filter = `drop-shadow(0 0 2px ${value.hoverColor}) drop-shadow(0 0 1px ${value.hoverColor})`;
          break;
        }
      }
    }
  }, [value.source, value.selected, value.hoverColor]);

  return (
    <div
      ref={ref}
      className={className ?? "solenoid-svg-figure"}
      style={{ height: h, width: "100%", display: "block" }}
    />
  );
}
