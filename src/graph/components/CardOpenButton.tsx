// [[B14]] oneDesignSystem (DESIGN.md § Buttons, the input card's Open)
import type { MouseEvent } from "react";
import { stopDragStart } from "../coarse";
import { TableIcon } from "./Icons";
import "./nodeCard.css";

/** The input card's front door: opens the same editor its chip does, from the top of the card. */
export function CardOpenButton({ onOpen, title }: { onOpen: (el: HTMLElement) => void; title: string }) {
  return (
    <button
      type="button"
      className="solenoid-node__open-btn"
      title={title}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); onOpen(e.currentTarget); }}
    >
      <TableIcon size={12} strokeWidth={2} />
      Open
    </button>
  );
}
