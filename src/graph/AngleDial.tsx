import { useCallback, useRef, useState, type PointerEvent } from "react";

import "./AngleDial.css";

type AngleDialProps = {
  value: number;
  step?: number;
  onChange: (degrees: number) => void;
  size?: number;
};

function normalise(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

function snap(deg: number, step: number): number {
  return normalise(Math.round(deg / step) * step);
}

/**
 * Small rotary dial for setting an angle. Click anywhere on the face
 * to point the needle there; drag to spin. Snaps to `step` degrees
 * (default 15). stopPropagation on pointer events so the canvas
 * (rete-area-plugin) can't grab them as a node drag.
 *
 * Angles use screen-space convention: 0° = right, 90° = down,
 * 180° = left, 270° = up.
 */
export function AngleDial({
  value,
  step = 15,
  onChange,
  size = 30,
}: AngleDialProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      if (dx === 0 && dy === 0) return;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const next = snap(deg, step);
      if (next !== normalise(value)) onChange(next);
    },
    [value, step, onChange],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      updateFromPointer(e.clientX, e.clientY);
    },
    [updateFromPointer],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (!dragging) return;
      e.stopPropagation();
      updateFromPointer(e.clientX, e.clientY);
    },
    [dragging, updateFromPointer],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      e.stopPropagation();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
    },
    [],
  );

  const r = size / 2;
  const innerR = r - 3;
  const needleR = innerR - 2;
  const rad = (value * Math.PI) / 180;
  const needleX = r + needleR * Math.cos(rad);
  const needleY = r + needleR * Math.sin(rad);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      className={
        dragging ? "solenoid-dial solenoid-dial--dragging" : "solenoid-dial"
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <circle
        cx={r}
        cy={r}
        r={innerR}
        className="solenoid-dial__face"
      />
      {[0, 90, 180, 270].map((tick) => {
        const tr = (tick * Math.PI) / 180;
        const x1 = r + (innerR - 2) * Math.cos(tr);
        const y1 = r + (innerR - 2) * Math.sin(tr);
        const x2 = r + innerR * Math.cos(tr);
        const y2 = r + innerR * Math.sin(tr);
        return (
          <line
            key={tick}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className="solenoid-dial__tick"
          />
        );
      })}
      <line
        x1={r}
        y1={r}
        x2={needleX}
        y2={needleY}
        className="solenoid-dial__needle"
      />
      <circle cx={r} cy={r} r={1.8} className="solenoid-dial__hub" />
    </svg>
  );
}
