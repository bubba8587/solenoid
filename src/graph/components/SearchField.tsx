// [[B14]] oneDesignSystem
import { SearchIcon } from "./Icons";
import "./SearchField.css";

/** The one search field: a magnifier, the input, and `count` (`2 of 9`) trailing while it filters. Escape with text clears it first. */
export function SearchField({ value, onChange, placeholder, label, count, className }: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  count?: string;
  className?: string;
}) {
  return (
    <label className={`sol-search${className ? ` ${className}` : ""}`}>
      <SearchIcon size={12} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
      />
      {count && <span className="sol-search__count">{count}</span>}
    </label>
  );
}
