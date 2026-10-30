import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { documentStore } from "../documentStore";
import { recentDocsStore, recentDocs } from "../recentDocsStore";
import { navigatorFiles } from "../outlineStore";
import { SEEDS, SEED_GROUPS } from "../seeds";
import "./documentTitle.css";

export function DocumentTitle() {
  useSyncExternalStore(documentStore.subscribe, documentStore.version);
  useSyncExternalStore(recentDocsStore.subscribe, recentDocsStore.version);
  const name = documentStore.currentName();
  const currentId = documentStore.currentId();
  useEffect(() => {
    recentDocsStore.seed([...documentStore.list()].sort((a, b) => b.updatedAt - a.updatedAt).map((d) => d.id));
    if (currentId) recentDocsStore.touch(currentId);
  }, [currentId]);
  // The menu keeps a handful of recents; every document lives in the Navigator's Files tree.
  const all = documentStore.list();
  const current = all.find((d) => d.current);
  const recents = recentDocs(recentDocsStore.ids(), all);
  const docs = current && !recents.includes(current) ? [current, ...recents.slice(0, -1)] : recents;

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  // An accordion, one group open at a time, so a long list of seeds can't flood the menu.
  const [openGroup, setOpenGroup] = useState<string | null>(SEED_GROUPS[0]?.head ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState("");
  // The menu is a popover: the top layer lifts it out of the app bar's stacking context, the caret is its invoker,
  // a click outside or Escape closes it, and CSS anchors it under this instance's title (two instances are mounted).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const menuId = `doc-menu-${uid}`;
  const anchor = { "--doc-anchor": `--doctitle-${uid}` } as CSSProperties;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => menuRef.current?.hidePopover();
  function onMenuToggle(e: ToggleEvent) {
    setMenuOpen(e.newState === "open");
    setRenaming(false);
    setRenamingId(null);
  }

  useEffect(() => {
    if (renaming) { setDraft(name); inputRef.current?.select(); }
  }, [renaming, name]);

  useEffect(() => {
    if (!renaming) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t)) setRenaming(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [renaming]);

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

  return (
    <div className="solenoid-doctitle" ref={rootRef} style={anchor} onPointerDown={(e) => e.stopPropagation()}>
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
        popoverTarget={menuId}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 5.5 L8 11 L13.5 5.5" />
        </svg>
      </button>

      <div
          id={menuId}
          popover="auto"
          className="solenoid-doctitle__menu"
          ref={menuRef}
          style={anchor}
          onToggle={(e) => onMenuToggle(e.nativeEvent as ToggleEvent)}
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
                    onClick={() => { closeMenu(); if (!d.current) void documentStore.open(d.id); }}
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
                  onClick={(e) => { e.stopPropagation(); closeMenu(); void documentStore.duplicate(d.id); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5 V3.5 a1 1 0 0 0 -1 -1 H3.5 a1 1 0 0 0 -1 1 V9.5 a1 1 0 0 0 1 1 h2" />
                  </svg>
                </button>
                {/* The open document would come straight back, so only the others clear. */}
                <button
                  type="button"
                  className="solenoid-doctitle__doc-action"
                  title="Clear from recents"
                  aria-label={`Clear ${d.name} from recents`}
                  disabled={d.current}
                  onClick={(e) => { e.stopPropagation(); recentDocsStore.clear(d.id); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4 L12 12 M12 4 L4 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {all.length > docs.length && (
            <button type="button" className="solenoid-doctitle__action solenoid-doctitle__all" onClick={() => { closeMenu(); navigatorFiles.open(); }}>
              All Documents ({all.length})…
            </button>
          )}
          <div className="solenoid-doctitle__sep" />
          <button type="button" className="solenoid-doctitle__action" onClick={() => { closeMenu(); void documentStore.newBlank(); }}>
            New Blank Document
          </button>

          <div className="solenoid-doctitle__sep" />
          <div className="solenoid-doctitle__section-head">New from example</div>
          {SEED_GROUPS.map((group) => {
            const open = openGroup === group.head;
            return (
              <div key={group.head} className="solenoid-doctitle__docs">
                <button
                  type="button"
                  className={`solenoid-doctitle__group-head${open ? " solenoid-doctitle__group-head--open" : ""}`}
                  aria-expanded={open}
                  onClick={() => setOpenGroup(open ? null : group.head)}
                >
                  <svg className="solenoid-doctitle__group-chev" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <span>{group.head}</span>
                </button>
                {open && group.ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="solenoid-doctitle__action solenoid-doctitle__template"
                    onClick={() => { closeMenu(); void documentStore.newFromTemplate(id); }}
                  >
                    {SEEDS[id].label}
                  </button>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
