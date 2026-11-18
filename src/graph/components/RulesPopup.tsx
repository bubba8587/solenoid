// [[B19]] spreadsheetHabits: the rules popups' kit (tree/specs/canvas/config-popups.md). A card
// whose settings outgrow its face keeps its wired inputs and outputs there and asks the rest here, a section per
// question, in PopupShell's chrome with the card's accent.
import type { ReactNode } from "react";
import { PopupShell, popupCardVars } from "./PopupShell";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { CloseIcon } from "./CloseIcon";
import "./RulesPopup.css";

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export function RulesPopup({ title, accent, onClose, note, children }: {
  title: string;
  accent?: string;
  onClose: () => void;
  /** A muted line in the footer, left of Done. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PopupShell title={title} onClose={onClose} cardClassName="sol-rules" resizable={{ min: { w: 380, h: 220 } }} cardStyle={popupCardVars({ accent })}>
      <div className="sol-rules__body">{children}</div>
      <div className="sol-rules__footer">
        {note && <span className="sol-rules__note">{note}</span>}
        <button type="button" className="sol-rules__done" onClick={onClose}>Done</button>
      </div>
    </PopupShell>
  );
}

export function RulesSection({ title, action, children }: { title: string; action?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="sol-rules__section">
      <div className="sol-rules__head">
        <span className="sol-rules__title">{title}</span>
        {action && <button type="button" className="sol-rules__action" onClick={action.onClick}>{action.label}</button>}
      </div>
      {children}
    </section>
  );
}

/** A setting: its label and help on the left, its control on the right. `idle`: the other rules leave it without effect. */
export function RulesRow({ label, help, idle, children }: { label: string; help?: ReactNode; idle?: boolean; children: ReactNode }) {
  return (
    <div className={`sol-rules__row${help ? " sol-rules__row--top" : ""}${idle ? " sol-rules__row--idle" : ""}`}>
      <span className="sol-rules__text">
        <span className="sol-rules__label">{label}</span>
        {help && <span className="sol-rules__help">{help}</span>}
      </span>
      <span className="sol-rules__control">{children}</span>
    </div>
  );
}

export function RulesSeg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="sol-rules__seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={`sol-rules__segbtn${o.value === value ? " sol-rules__segbtn--on" : ""}`}
          onClick={() => onChange(o.value)} onPointerDown={stop}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A column of the input, or the `blank` choice. A saved name the input lacks stays listed, so another never shows in its place. */
export function RulesColumn({ value, columns, blank, prefix = "", onChange, label }: {
  value: string;
  columns: string[];
  blank: string;
  prefix?: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const names = value && !columns.includes(value) ? [...columns, value] : columns;
  return (
    <select className="sol-rules__select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop}>
      <option value="">{blank}</option>
      {names.map((c) => <option key={c} value={c}>{prefix}{c}</option>)}
    </select>
  );
}

export function RulesChoice<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select className="sol-rules__select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} onPointerDown={stop}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A number, committed on Enter or blur, commas allowed; blank commits none. `percent`: a fraction typed and shown as a percent. */
export function RulesNumber({ value, onChange, percent = false, placeholder, label }: {
  value: number | null;
  onChange: (n: number | null) => void;
  percent?: boolean;
  placeholder?: string;
  label: string;
}) {
  const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;
  const field = useDraftCommit<number | null>(
    value,
    (v) => (v == null ? "" : percent ? pct(v) : String(v)),
    (t) => {
      const s = t.replace(/,/g, "").trim();
      if (s === "") return null;
      const n = Number(s.replace(/%$/, ""));
      if (!Number.isFinite(n)) return INVALID_DRAFT;
      return percent ? n / 100 : n;
    },
    onChange,
  );
  return (
    <input className="sol-rules__input sol-rules__input--num" aria-label={label} value={field.draft} inputMode="decimal"
      placeholder={placeholder ?? (percent ? "percent" : "number")}
      onChange={(e) => field.setDraft(e.target.value)} onBlur={field.onBlur} onKeyDown={field.onKeyDown} onPointerDown={stop} />
  );
}

export function RulesText({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const field = useDraftCommit(value, (t) => t, (t) => t, onChange);
  return (
    <input className="sol-rules__input" aria-label={label} value={field.draft} placeholder={placeholder}
      onChange={(e) => field.setDraft(e.target.value)} onBlur={field.onBlur} onKeyDown={field.onKeyDown} onPointerDown={stop} />
  );
}

/** One numbered item of a list (a limit): its lines of fields, a remove button, and links that open more lines. */
export function RulesItem({ index, onRemove, removeLabel, more, children }: {
  index: number;
  onRemove: () => void;
  removeLabel: string;
  more?: { label: string; onClick: () => void }[];
  children: ReactNode;
}) {
  return (
    <div className="sol-rules__item">
      <span className="sol-rules__num">{index}</span>
      {children}
      <button type="button" className="sol-rules__remove" style={{ gridRow: 1 }} onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
        <CloseIcon size={10} />
      </button>
      {more && more.length > 0 && (
        <div className="sol-rules__more">
          {more.map((m) => <button key={m.label} type="button" className="sol-rules__link" onClick={m.onClick}>{m.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** A line of an item: words and fields in a sentence; `onRemove` gives the line its own remove (an optional clause). */
export function RulesLine({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <>
      <div className="sol-rules__line">{children}</div>
      {onRemove && (
        <button type="button" className="sol-rules__remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <CloseIcon size={10} />
        </button>
      )}
    </>
  );
}

export function RulesWord({ children }: { children: ReactNode }) {
  return <span className="sol-rules__word">{children}</span>;
}
