import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fieldScore } from "./fuzzy";
import { commandRecents } from "./commandRecents";
import { settingsStore, SETTINGS_SCHEMA } from "./settingsStore";
import { alignSelection, distributeSelection, collapseSelection } from "./selectionOps";
import { buildMenus, type MenuItem } from "./menuModel";
import "./CommandPalette.css";

// Reuses the exact "dispatch a synthetic keydown" trick the menu model uses to run
// graph-domain shortcuts (group/isolate/tidy/…) without a second copy of Canvas's
// keydown logic.
function fireCanvasKey(code: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true,
    }),
  );
}

type PaletteItem = {
  id: string;
  kind: "command" | "setting";
  label: string;
  sub?: string;
  shortcut?: string;
  run: () => void;
};

function buildCommands(): PaletteItem[] {
  // EVERY menubar action (single-sourced in menuModel) is a command — so the palette
  // stays in sync with the menu bar. The individual node types are deliberately NOT
  // here: "Add node…" opens the Add menu (auto-focused search, the `A` hotkey), which
  // is the one place to browse the catalog.
  const fromMenus = buildMenus()
    .flatMap((m) => m.items)
    .filter((it): it is Extract<MenuItem, { label: string }> => !("sep" in it) && !it.disabled && !!it.onClick)
    .map((it) => ({ label: it.label, shortcut: it.shortcut, run: it.onClick! }));
  // Canvas / selection ops that don't live in the menu bar.
  const extra: { label: string; shortcut?: string; run: () => void }[] = [
    { label: "Isolate selection", shortcut: "I", run: () => fireCanvasKey("KeyI") },
    { label: "Expand/collapse groups", shortcut: "E", run: () => fireCanvasKey("KeyE") },
    { label: "Align left", run: () => void alignSelection("left") },
    { label: "Align right", run: () => void alignSelection("right") },
    { label: "Align top", run: () => void alignSelection("top") },
    { label: "Align bottom", run: () => void alignSelection("bottom") },
    // Labels name the END EFFECT, not the axis being centered: center-h aligns the
    // horizontal centres, which stacks the nodes VERTICALLY (and vice versa).
    { label: "Align center (vertical)", run: () => void alignSelection("center-h") },
    { label: "Align center (horizontal)", run: () => void alignSelection("center-v") },
    { label: "Distribute horizontally", run: () => void distributeSelection("h") },
    { label: "Distribute vertically", run: () => void distributeSelection("v") },
    { label: "Collapse selection", run: () => collapseSelection(true) },
    { label: "Expand selection", run: () => collapseSelection(false) },
  ];
  return [...fromMenus, ...extra].map((c, i) => ({ id: `cmd:${i}:${c.label}`, kind: "command" as const, ...c }));
}

function buildSettingToggles(): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const section of SETTINGS_SCHEMA) {
    for (const f of section.fields) {
      if (f.type === "folder" || f.type === "segment") continue;
      out.push({
        id: `setting:${f.key}`,
        kind: "setting",
        label: `Toggle ${f.label}`,
        sub: settingsStore.get(f.key) ? "on" : "off",
        run: () => settingsStore.toggle(f.key as Parameters<typeof settingsStore.toggle>[0]),
      });
    }
  }
  return out;
}

export function CommandPalette({ onClose, persistent = false }: { onClose: () => void; persistent?: boolean }) {
  const [query, setQuery] = useState("");
  // -1 = nothing selected. The palette opens with NO active row — a blind
  // Enter must never fire an action the user didn't pick (the browse list is
  // a menu, not a ranked answer). Typing a query DOES auto-select the top
  // result (that ranking is the answer to the query, so type→Enter works);
  // arrows and real mouse movement select explicitly.
  const [activeIndex, setActiveIndex] = useState(-1);
  // Docked mode is a bare bar until focused; focusing it surfaces the same no-query
  // suggestion list the modal shows on open.
  const [focused, setFocused] = useState(false);
  const recentsVersion = useSyncExternalStore(commandRecents.subscribe, commandRecents.version);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(buildCommands, []);
  const toggles = useMemo(buildSettingToggles, []);

  // Persistent (docked) mode must NOT steal focus from the canvas on mount; the
  // modal opens for immediate typing, so it focuses.
  useEffect(() => { if (!persistent) inputRef.current?.focus(); }, [persistent]);
  useEffect(() => setActiveIndex(query.trim() ? 0 : -1), [query]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    // No query → 8 command previews, LED by the 3 most-recently-run commands (from
    // the palette or the menu bar), then the default order filling the rest. The
    // docked bar shows this only while focused (a bare bar otherwise); the modal always.
    if (!q) {
      if (persistent && !focused) return [];
      const byLabel = new Map(commands.map((c) => [c.label, c]));
      const recent: PaletteItem[] = [];
      for (const label of commandRecents.list()) {
        const item = byLabel.get(label);
        if (item) recent.push({ ...item, id: `recent:${item.id}`, sub: "recent" });
        if (recent.length >= 3) break;
      }
      const seen = new Set(recent.map((r) => r.label));
      const rest = commands.filter((c) => !seen.has(c.label));
      return [...recent, ...rest].slice(0, 8);
    }
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const c of [...commands, ...toggles]) {
      const s = fieldScore(q, c.label);
      if (s !== null) scored.push({ item: c, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map((s) => s.item);
  }, [query, commands, toggles, persistent, focused, recentsVersion]);

  function run(item: PaletteItem) {
    // Record repeatable actions (not a one-off jump to a specific node) so they can
    // lead the suggestions next time. A recent-preview item carries a `recent:` id
    // prefix, so strip that to record the real label.
    if (item.kind === "command" || item.kind === "setting") commandRecents.record(item.label);
    item.run();
    // Docked: stay open, ready for the next command; modal: dismiss.
    if (persistent) { setQuery(""); setActiveIndex(-1); inputRef.current?.focus(); }
    else onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    // activeIndex -1 (nothing selected) makes Enter a no-op — see its comment.
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0 && results[activeIndex]) run(results[activeIndex]); }
    // Docked: Escape clears the query + hands focus back to the canvas but keeps
    // the bar; modal: Escape dismisses.
    else if (e.key === "Escape") { e.preventDefault(); if (persistent) { setQuery(""); inputRef.current?.blur(); } else onClose(); }
  }

  return (
    <div
      className={`solenoid-cmdpalette-scrim${persistent ? " solenoid-cmdpalette-scrim--persistent" : ""}`}
      onMouseDown={persistent ? undefined : onClose}
    >
      <div className={`solenoid-cmdpalette${persistent ? " solenoid-cmdpalette--persistent" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        {results.length > 0 && (
          // preventDefault on mousedown so clicking a row doesn't blur the input —
          // in docked mode a blur would hide the suggestion list before the click fires.
          <div className="solenoid-cmdpalette__results" onMouseDown={(e) => e.preventDefault()}>
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`solenoid-cmdpalette__item${i === activeIndex ? " solenoid-cmdpalette__item--active" : ""}`}
                // onMouseMove, NOT onMouseEnter: the palette mounts under
                // wherever the pointer happens to sit, and the browser fires a
                // synthetic mouseenter on the row beneath it — which stole the
                // highlight from the keyboard's row 0, so Enter-Enter ran a
                // pointer-position-dependent action. mousemove only fires on
                // real movement, so the mouse must be USED to take over.
                onMouseMove={() => setActiveIndex(i)}
                onClick={() => run(r)}
              >
                <span className="solenoid-cmdpalette__label">{r.label}</span>
                {r.sub && <span className="solenoid-cmdpalette__sub">{r.sub}</span>}
                {r.shortcut && <span className="solenoid-cmdpalette__shortcut">{r.shortcut}</span>}
              </div>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          className="solenoid-cmdpalette__input"
          value={query}
          type="text"
          // Suppress Android/iOS autofill (password / card / address prompts) — this
          // is a search box, not a credential field. name="search" + inputMode search
          // + the off flags tell the OS it's plain text, same as our other fields.
          name="search"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          placeholder="Run a command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
    </div>
  );
}
