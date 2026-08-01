import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fieldScore } from "./fuzzy";
import { IS_MOBILE } from "./coarse";
import { apiKeyStore } from "./apiKeyStore";
import { aiConnected } from "./aiKey";
import { runAiPrompt, type AiOutcome } from "./aiService";
import { revealAddedNodes } from "./aiReveal";
import { diffLines, hasChanges, type DiffLine } from "./textDiff";
import { serializeGraph, loadGraph, type SavedGraph } from "./persistence";
import { writeTextForm, readTextForm } from "./textForm";
import { commandRecents } from "./commandRecents";
import { paletteStore } from "./paletteStore";
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

// Lucide "sparkle" (ISC) — the AI affordance. One four-point star, stroked like every
// other icon here; deliberately NOT the three-star cluster or a filled gradient mark,
// which is the AI-startup look DESIGN.md rejects. 16px in a 24px box: both even, so
// the glyph centers on whole pixels (CLAUDE.md's even-icon rule).
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
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

// The AI turn's lifecycle. One turn at a time: a prompt replaces the previous
// result, Escape steps back to idle, Apply/Cancel resolve an edit.
type AiState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "answer"; text: string }
  | { phase: "edit"; newText: string; diff: DiffLine[]; warnings: string[] }
  | { phase: "error"; message: string };

/** The open document as its text form — what the model reads and rewrites. */
function currentTextForm(): string {
  const g: SavedGraph = serializeGraph() ?? { v: 2, nodes: [], connections: [] };
  return writeTextForm(g);
}

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
    // horizontal centers, which stacks the nodes VERTICALLY (and vice versa).
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
      // A setting Settings grays out on this device must not be reachable as a
      // command either — otherwise the palette is a back door to flipping a value
      // whose feature isn't there, and the two surfaces disagree.
      if (IS_MOBILE && f.disabledOnMobile) continue;
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
  // AI mode: the palette stops being a command launcher and becomes a prompt box.
  // Local state, not a store — the mode is a property of THIS palette session, so a
  // modal that's dismissed and reopened comes back in command mode (the default a
  // blind Enter should land in).
  const [aiMode, setAiMode] = useState(false);
  // The sparkle appears only once an AI account is connected (a key stored in
  // Settings ▸ AI). Subscribed so storing or clearing the key shows/hides it live.
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  const aiAvailable = aiConnected();
  // Clearing the key while the palette sits in AI mode must not strand it in a mode
  // whose only exit control just disappeared.
  useEffect(() => { if (!aiAvailable) setAiMode(false); }, [aiAvailable]);
  const [aiState, setAiState] = useState<AiState>({ phase: "idle" });
  // A reply landing after the palette unmounted (modal dismissed mid-request)
  // must not set state on a dead component; the flag outlives the closure.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  // Leaving AI mode drops the turn — coming back starts fresh, matching the
  // mode itself being palette-session-local.
  useEffect(() => { if (!aiMode) setAiState({ phase: "idle" }); }, [aiMode]);

  async function submitAiPrompt() {
    const prompt = query.trim();
    if (!prompt || aiState.phase === "busy") return;
    setAiState({ phase: "busy" });
    const outcome: AiOutcome = await runAiPrompt(prompt, currentTextForm());
    if (!aliveRef.current) return;
    if (outcome.kind === "answer") {
      setAiState({ phase: "answer", text: outcome.text });
    } else if (outcome.kind === "edit") {
      const diff = diffLines(currentTextForm(), outcome.newText);
      if (!hasChanges(diff)) {
        setAiState({ phase: "answer", text: "The document already matches that request." });
      } else {
        setAiState({ phase: "edit", newText: outcome.newText, diff, warnings: outcome.warnings });
      }
    } else {
      setAiState({ phase: "error", message: outcome.message });
    }
  }

  async function applyAiEdit() {
    if (aiState.phase !== "edit") return;
    // The same governed path a file open takes: parse the validated text form,
    // rebuild the editor from it. The validator already passed this text.
    const before = new Set(readTextForm(currentTextForm()).nodes.map((n) => n.name ?? n.id));
    const graph = readTextForm(aiState.newText);
    const ok = await loadGraph(graph);
    if (!aliveRef.current) return;
    if (!ok) {
      setAiState({ phase: "error", message: "The rewrite failed to load. The document is unchanged." });
      return;
    }
    // Only what the edit ADDED animates in — kept nodes stay put.
    revealAddedNodes(graph.nodes.map((n) => n.name ?? n.id).filter((n) => !before.has(n)));
    setQuery("");
    setAiState({ phase: "idle" });
    if (!persistent) onClose();
  }
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
  // Docked mode is always rendered off the always-on setting, so paletteStore's
  // open toggle can't mount/unmount it — instead it's the "enter the palette"
  // signal: the bare Enter hotkey calls paletteStore.open(), and here we FOCUS
  // the docked bar in response (revealing the suggestion list, ready to type).
  // Blur resets the store (onBlur below) so a later Enter re-arms. The modal
  // instance ignores this — it focuses on mount via the effect above.
  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  useEffect(() => { if (persistent && paletteOpen) inputRef.current?.focus(); }, [persistent, paletteOpen]);
  useEffect(() => setActiveIndex(query.trim() ? 0 : -1), [query]);

  const results = useMemo<PaletteItem[]>(() => {
    // AI mode has no result list: what you type is a prompt, not a query over
    // commands, so ranking commands under it would offer an Enter that does
    // something other than what the field says it will.
    if (aiMode) return [];
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
  }, [query, commands, toggles, persistent, focused, recentsVersion, aiMode]);

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
    // AI mode: Enter submits the prompt; Escape steps back — first out of a
    // shown result, then out of the palette (the shared handler below).
    if (aiMode) {
      if (e.key === "Enter") {
        e.preventDefault();
        void submitAiPrompt();
        return;
      }
      if (e.key === "Escape" && aiState.phase !== "idle" && aiState.phase !== "busy") {
        e.preventDefault();
        setAiState({ phase: "idle" });
        return;
      }
      if (e.key !== "Escape") return;
    }
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
      <div
        className={
          `solenoid-cmdpalette${persistent ? " solenoid-cmdpalette--persistent" : ""}` +
          (aiMode ? " solenoid-cmdpalette--ai" : "")
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        {aiMode && aiState.phase !== "idle" && (
          // The turn's output. A NEUTRAL overlay surface even in AI mode — the
          // accent marks the input's rerouted Enter; the output is content.
          // preventDefault on mousedown for the same focus-keeping reason as the
          // results list.
          <div className="solenoid-cmdpalette__airesult" onMouseDown={(e) => e.preventDefault()}>
            {aiState.phase === "busy" && (
              <div className="solenoid-cmdpalette__aibusy">Working…</div>
            )}
            {aiState.phase === "answer" && (
              <div className="solenoid-cmdpalette__aianswer">{aiState.text}</div>
            )}
            {aiState.phase === "error" && (
              <div className="solenoid-cmdpalette__aierror">{aiState.message}</div>
            )}
            {aiState.phase === "edit" && (
              <>
                <div className="solenoid-cmdpalette__aidiff">
                  {aiState.diff.map((d, i) => (
                    <div key={i} className={`solenoid-cmdpalette__aidiffline solenoid-cmdpalette__aidiffline--${d.kind}`}>
                      {d.text || " "}
                    </div>
                  ))}
                </div>
                {aiState.warnings.length > 0 && (
                  <div className="solenoid-cmdpalette__aiwarnings">
                    {aiState.warnings.map((wText, i) => (
                      <div key={i}>{wText}</div>
                    ))}
                  </div>
                )}
                <div className="solenoid-cmdpalette__aiactions">
                  <button type="button" className="solenoid-cmdpalette__aibtn" onClick={() => setAiState({ phase: "idle" })}>
                    Cancel
                  </button>
                  <button type="button" className="solenoid-cmdpalette__aibtn solenoid-cmdpalette__aibtn--apply" onClick={() => void applyAiEdit()}>
                    Apply
                  </button>
                </div>
              </>
            )}
          </div>
        )}
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
        <div className={`solenoid-cmdpalette__field${aiAvailable ? " solenoid-cmdpalette__field--ai" : ""}`}>
          <input
            ref={inputRef}
            className="solenoid-cmdpalette__input"
            value={query}
            // A SEMANTIC search field — the reliable lever to stop Android Chrome's
            // autofill bar (password / card / address). `autocomplete="off"` alone
            // doesn't (Chrome ignores it), and a `name`d `type="text"` reads as a
            // fillable form field; `type="search"` tells the OS it's a search box, so
            // it drops the credential/payment/address prompts. No `name` (our other
            // fields have none and don't trigger it). Native clear (×) hidden in CSS.
            type="search"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder={aiMode ? "Ask the AI…" : "Run a command…"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            // Persistent: dropping focus also clears paletteStore (onClose ===
            // paletteStore.close), so the next bare Enter flips it true again and
            // the focus effect above re-fires. Without this reset the store stays
            // true after the first Enter and the hotkey never re-focuses the bar.
            onBlur={() => { setFocused(false); if (persistent) onClose(); }}
          />
          {aiAvailable && (
            <button
              type="button"
              className="solenoid-cmdpalette__ai"
              aria-pressed={aiMode}
              aria-label={aiMode ? "Back to commands" : "Ask the AI"}
              title={aiMode ? "Back to commands" : "Ask the AI"}
              // preventDefault so the press doesn't blur the input: in docked mode a
              // blur calls onClose (clearing paletteStore) and hides the list, so the
              // mode would flip and the bar would drop focus in the same click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setAiMode((m) => !m); inputRef.current?.focus(); }}
            >
              <SparkleIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
