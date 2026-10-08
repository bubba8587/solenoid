// [[B14]] oneDesignSystem (DESIGN.md § Buttons, the input card's edit button)
import type { MouseEvent } from "react";
import { stopDragStart } from "../coarse";
import "./nodeCard.css";

/** The input card's front door: opens the same editor its chip does, from the top of the card. */
export function CardOpenButton({ label, onOpen }: { label: string; onOpen: (el: HTMLElement) => void }) {
  return (
    <button
      type="button"
      className="solenoid-node__open-btn"
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onOpen(e.currentTarget); }}
    >
      {label}
    </button>
  );
}
