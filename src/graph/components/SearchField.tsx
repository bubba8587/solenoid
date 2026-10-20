// [[B14]] oneDesignSystem
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SearchIcon } from "./Icons";
import "./SearchField.css";

const NARROW = "(max-width: 560px)";
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
  const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
  const [opened, setOpened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (opened) inputRef.current?.focus(); }, [opened]);
  if (collapsible && narrow && !opened && value === "") {
    return (
      <button type="button" className="sol-search-btn" aria-label={label} title={label} onClick={() => setOpened(true)}>
        <SearchIcon size={14} />
      </button>
    );
  }
  return (
    <label className={`sol-search${className ? ` ${className}` : ""}`}>
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
