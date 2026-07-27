import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { documentStore } from "../documentStore";
import { requestConfirm } from "../confirmStore";
import { IS_MOBILE } from "../coarse";
import { SEEDS } from "../seeds";
import "./documentTitle.css";

/**
 * The current document's name, centered in the menu bar. Clicking the name opens
 * an inline rename editor (Excel-style); the ▾ caret opens the documents menu —
 * switch between saved documents, start a new blank one, or start from one of
 * the bundled examples. This is the home of the "file system"; the example
 * graphs appear here only as starting points, not as a working-graph picker.
 */
export function DocumentTitle() {
  useSyncExternalStore(documentStore.subscribe, documentStore.version);
  const name = documentStore.currentName();
  const docs = documentStore.list();

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline rename of a specific row in the documents menu (the pencil action).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState("");
  // The menu is portaled to <body> so it escapes the app bar's stacking context
  // (which otherwise traps it below the pin/alert HUD) and can be bounded to the
  // viewport (so a long name truncates instead of shoving the row off-screen).
  // Its fixed position is computed from the trigger when opened.
  const [menuPos, setMenuPos] = useState<{ top: number; left?: number }>({ top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openMenu() {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setMenuPos(IS_MOBILE ? { top: r.bottom + 4 } : { top: r.bottom + 5, left: r.left + r.width / 2 });
    setMenuOpen((o) => !o);
    setRenaming(false);
    setRenamingId(null);
  }

  useEffect(() => {
    if (renaming) { setDraft(name); inputRef.current?.select(); }
  }, [renaming, name]);

  // Close menu / rename on outside interaction.
  useEffect(() => {
    if (!menuOpen && !renaming) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) { setMenuOpen(false); setRenaming(false); setRenamingId(null); }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen, renaming]);

  function commitRename() {
    const v = draft.trim();
    if (v && v !== name) documentStore.renameCurrent(v);
    setRenaming(false);
  }

  function commitRowRename(id: string, original: string) {
    const v = rowDraft.trim();
    if (v && v !== original) documentStore.rename(id, v);
    setRenamingId(null);
  }

  async function removeDoc(id: string, docName: string) {
    const ok = await requestConfirm({
      message: `Remove "${docName}"? Unsaved changes will be lost.`,
      confirmLabel: "Remove",
    });
    if (ok) void documentStore.remove(id);
  }

  return (
    <div className="solenoid-doctitle" ref={rootRef} onPointerDown={(e) => e.stopPropagation()}>
      {renaming ? (
        <input
          ref={inputRef}
          className="solenoid-doctitle__input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
          }}
          onBlur={commitRename}
        />
      ) : (
        <button
          type="button"
          className="solenoid-doctitle__name"
          title="Rename"
          onClick={() => setRenaming(true)}
        >
          {name}
        </button>
      )}
      <button
        type="button"
        className={`solenoid-doctitle__caret${menuOpen ? " solenoid-doctitle__caret--open" : ""}`}
        title="Documents"
        aria-label="Documents"
        onClick={openMenu}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 5.5 L8 11 L13.5 5.5" />
        </svg>
      </button>

      {menuOpen && createPortal(
        <div
          className="solenoid-doctitle__menu"
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left, transform: IS_MOBILE ? "none" : "translateX(-50%)" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="solenoid-doctitle__section-head">Recent documents</div>
          <div className="solenoid-doctitle__docs">
            {docs.map((d) => (
              <div
                key={d.id}
                className={`solenoid-doctitle__doc-row${d.current ? " solenoid-doctitle__doc--current" : ""}`}
              >
                {renamingId === d.id ? (
                  <input
                    className="solenoid-doctitle__doc-rename"
                    value={rowDraft}
                    autoFocus
                    onChange={(e) => setRowDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRowRename(d.id, d.name); }
                      if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                    }}
                    onBlur={() => commitRowRename(d.id, d.name)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    type="button"
                    className="solenoid-doctitle__doc-open"
                    onClick={() => { setMenuOpen(false); if (!d.current) void documentStore.open(d.id); }}
                  >
                    <span className="solenoid-doctitle__check">{d.current ? "✓" : ""}</span>
                    <span className="solenoid-doctitle__doc-name">{d.name}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="solenoid-doctitle__doc-action"
                  title="Rename"
                  aria-label={`Rename ${d.name}`}
                  onClick={(e) => { e.stopPropagation(); setRenamingId(d.id); setRowDraft(d.name); }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="solenoid-doctitle__doc-action"
                  title="Duplicate"
                  aria-label={`Duplicate ${d.name}`}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); void documentStore.duplicate(d.id); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5 V3.5 a1 1 0 0 0 -1 -1 H3.5 a1 1 0 0 0 -1 1 V9.5 a1 1 0 0 0 1 1 h2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="solenoid-doctitle__doc-action solenoid-doctitle__doc-action--danger"
                  title="Remove from documents"
                  aria-label={`Remove ${d.name}`}
                  onClick={(e) => { e.stopPropagation(); void removeDoc(d.id, d.name); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4 L12 12 M12 4 L4 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div className="solenoid-doctitle__sep" />
          <button type="button" className="solenoid-doctitle__action" onClick={() => { setMenuOpen(false); void documentStore.newBlank(); }}>
            New blank document
          </button>

          <div className="solenoid-doctitle__sep" />
          <div className="solenoid-doctitle__section-head">New from example</div>
          <div className="solenoid-doctitle__docs">
            {Object.entries(SEEDS).map(([id, seed]) => (
              <button
                key={id}
                type="button"
                className="solenoid-doctitle__action solenoid-doctitle__template"
                onClick={() => { setMenuOpen(false); void documentStore.newFromTemplate(id); }}
              >
                {seed.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
