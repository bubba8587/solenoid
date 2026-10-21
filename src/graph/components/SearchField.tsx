// [[B14]] oneDesignSystem
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SearchIcon } from "./Icons";
import "./SearchField.css";

const NARROW_PX = 560;
const NARROW = `(max-width: ${NARROW_PX}px)`;
const narrowNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
const subscribeNarrow = (l: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
};

/**
 * The one search field: a magnifier, the input, and `count` (`2 of 9`) trailing while it filters. Escape with text clears it first.
 * `collapsible` (a popup header): on a narrow screen it waits as its magnifier until tapped, so it costs the header no second line.
 */
export function SearchField({ value, onChange, placeholder, label, count, className, collapsible = false }: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  count?: string;
  className?: string;
  collapsible?: boolean;
}) {
  const narrowScreen = useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
  const [opened, setOpened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A popup resized narrow on a wide screen collapses the field as a phone does.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [narrowCard, setNarrowCard] = useState(false);
  useLayoutEffect(() => {
    const card = collapsible ? el?.closest<HTMLElement>(".sol-popup") : null;
    if (!card) return;
    const ro = new ResizeObserver(() => setNarrowCard(card.clientWidth <= NARROW_PX));
    ro.observe(card);
    return () => ro.disconnect();
  }, [el, collapsible]);
  const narrow = narrowScreen || narrowCard;
  useEffect(() => { if (opened) inputRef.current?.focus(); }, [opened]);
  if (collapsible && narrow && !opened && value === "") {
    return (
      <button ref={setEl} type="button" className="sol-search-btn" aria-label={label} title={label} onClick={() => setOpened(true)}>
        <SearchIcon size={14} />
      </button>
    );
  }
  return (
    <label ref={setEl} className={`sol-search${className ? ` ${className}` : ""}`}>
      <SearchIcon size={12} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setOpened(false)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
      />
      {count && <span className="sol-search__count">{count}</span>}
    </label>
  );
}
