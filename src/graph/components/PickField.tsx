// [[components#One design system governs every look, layout and word in the app]]: the one field a card picks a file or folder with. It shows the pick and opens `chooseFile`
// (the operating system's dialog on desktop, the app's FilePicker elsewhere) on click.
import "./PickField.css";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function PickField({ value, placeholder, example = false, missing = false, title, disabled = false, onPick }: {
  value: string;
  placeholder: string;
  /** The placeholder is an Example, a prompt the card computes nothing from, set in italics ([[D96]] emptySlotShowsItsValue). */
  example?: boolean;
  /** The pick no longer lists: it still shows, marked, so the selection isn't silently lost. */
  missing?: boolean;
  title?: string;
  disabled?: boolean;
  /** Hands over the field, whose card lends the picker its accent. */
  onPick: (el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={`sol-pick${value ? "" : " sol-pick--empty"}${example ? " sol-pick--example" : ""}`}
      title={title ?? value}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onPick(e.currentTarget); }}
      onPointerDown={stop}
      onMouseDown={stop}
    >
      {/* Lucide "folder-open" (ISC). */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      </svg>
      <span className="sol-pick__text">{value || placeholder}</span>
      {missing && <span className="sol-pick__missing">missing</span>}
    </button>
  );
}
