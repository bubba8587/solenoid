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

// Graph-domain shortcuts route through Canvas's keydown handler, never duplicated here.
function fireCanvasKey(code: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code, ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true,
    }),
  );
}

// Lucide "sparkle" (ISC), NOT the three-star cluster or a gradient mark (DESIGN.md).
// viewBox shifted +0.7/-1: the glyph's ink centroid measured +0.69/-1.03 from the
// box center (upper-right-heavy), so it sat off-center (archived dev-notes 2026-06-20).
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0.7 -1 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

// One turn at a time: a prompt replaces the previous result.
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
  // EVERY menubar action is a command, so the two surfaces can't drift; individual
  // node types stay OUT — the Add menu is the one place to browse the catalog.
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
    // Labels name the END EFFECT, not the axis: center-h stacks nodes VERTICALLY.
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
      // A setting Settings grays out on this device must not be reachable here
      // either, or the palette is a back door to flipping it.
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
  // Local state, not a store: the mode belongs to THIS palette session, so a reopened
  // modal comes back in command mode.
  const [aiMode, setAiMode] = useState(false);
  // Subscribed so storing or clearing the key shows/hides the sparkle live.
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  const aiAvailable = aiConnected();
  // Clearing the key must not strand the palette in a mode whose exit control just went.
  useEffect(() => { if (!aiAvailable) setAiMode(false); }, [aiAvailable]);
  const [aiState, setAiState] = useState<AiState>({ phase: "idle" });
  // A reply landing after unmount must not set state on a dead component; the flag
  // outlives the closure.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
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
    // The same governed path a file open takes — the validator already passed this text.
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
  // -1 = nothing selected: a blind Enter must never fire an action the user didn't
  // pick, though typing a query DOES auto-select the top result.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const recentsVersion = useSyncExternalStore(commandRecents.subscribe, commandRecents.version);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(buildCommands, []);
  const toggles = useMemo(buildSettingToggles, []);

  // Docked mode must NOT steal focus from the canvas on mount; the modal opens for
  // immediate typing.
  useEffect(() => { if (!persistent) inputRef.current?.focus(); }, [persistent]);
  // Docked mode is always mounted, so paletteStore's open flag can't mount it —
  // it means "focus the bar" instead, and blur resets it so Enter re-arms.
  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  useEffect(() => { if (persistent && paletteOpen) inputRef.current?.focus(); }, [persistent, paletteOpen]);
  useEffect(() => setActiveIndex(query.trim() ? 0 : -1), [query]);

  const results = useMemo<PaletteItem[]>(() => {
    // AI mode has no result list — what you type is a prompt, so ranking commands
    // under it would offer an Enter that does something else.
    if (aiMode) return [];
    const q = query.trim();
    // No query → 8 previews, LED by the 3 most-recently-run commands.
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
    // Only repeatable actions are recorded, and by LABEL — a recent-preview item's
    // id carries a `recent:` prefix.
    if (item.kind === "command" || item.kind === "setting") commandRecents.record(item.label);
    item.run();
    if (persistent) { setQuery(""); setActiveIndex(-1); inputRef.current?.focus(); }
    else onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // In AI mode Escape steps back out of a shown result FIRST, then the palette.
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
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0 && results[activeIndex]) run(results[activeIndex]); }
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
          // A NEUTRAL surface even in AI mode — the accent marks the input's
          // rerouted Enter, not the output.
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
          // preventDefault so clicking a row doesn't blur the input — in docked mode
          // that would hide the list before the click fires.
          <div className="solenoid-cmdpalette__results" onMouseDown={(e) => e.preventDefault()}>
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`solenoid-cmdpalette__item${i === activeIndex ? " solenoid-cmdpalette__item--active" : ""}`}
                // onMouseMove, NOT onMouseEnter: the palette mounts under the pointer
                // and a synthetic mouseenter would steal the highlight from row 0.
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
            // `type="search"` with no `name` is what stops Android Chrome's autofill
            // bar; `autocomplete="off"` alone is ignored.
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
            // Blur must clear paletteStore, else it stays true after the first Enter
            // and the hotkey never re-focuses the bar.
            onBlur={() => { setFocused(false); if (persistent) onClose(); }}
          />
          {aiAvailable && (
            <button
              type="button"
              className="solenoid-cmdpalette__ai"
              aria-pressed={aiMode}
              aria-label={aiMode ? "Back to commands" : "Ask the AI"}
              title={aiMode ? "Back to commands" : "Ask the AI"}
              // preventDefault so the press doesn't blur the input — in docked mode
              // the bar would flip mode and drop focus in the same click.
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
