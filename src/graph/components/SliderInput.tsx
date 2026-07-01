import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import "./sliderInput.css";

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  // Width of the numeric input. The slider flexes to fill the row.
  inputWidth?: number;
};

/**
 * Range slider + typeable number box on a single row. stopPropagation
 * on pointer events so the canvas can't grab the drag as a node move.
 * The numeric box keeps a local draft so typing two-digit values
 * doesn't clamp mid-keystroke.
 */
export function SliderInput({ value, min, max, step = 1, onChange, inputWidth = 44 }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const swallow = useCallback((e: MouseEvent | PointerEvent) => e.stopPropagation(), []);

  const onSlider = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  }, [onChange]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const clamped = Math.max(min, Math.min(max, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  }, [draft, min, max, value, onChange]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      setDraft(String(value));
      setEditing(false);
      e.currentTarget.blur();
    }
  }, [value]);

  return (
    <div className="solenoid-slider" onMouseDown={swallow} onPointerDown={swallow}>
      <input
        type="range"
        className="solenoid-slider__range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onSlider}
      />
      <input
        type="text"
        inputMode="numeric"
        className="solenoid-slider__input"
        value={draft}
        onChange={(e) => { setEditing(true); setDraft(e.target.value); }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{ width: inputWidth }}
      />
    </div>
  );
}
