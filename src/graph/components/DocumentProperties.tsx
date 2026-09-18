import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFocusTrap } from "./useFocusTrap";
import { useEscapeToClose } from "./useEscapeToClose";
import { CloseIcon } from "./CloseIcon";
import { documentStore } from "../documentStore";
import { docMetaStore, docPropertiesPanel } from "../docMetaStore";
import { paletteStore } from "../palette";
import { getEditor } from "../process";
import { rebuildGroupMembership } from "../groupMembership";
import "../Settings.css";
import "./DocumentProperties.css";

// Commits on Enter/blur (Escape reverts), never per keystroke.
function TextRow({ label, value, placeholder, onCommit }: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="solenoid-settings__row">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{label}</span>
      </span>
      <input
        className="sol-docprops__input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
        }}
        onBlur={() => { if (draft !== value) onCommit(draft); }}
      />
    </label>
  );
}

const splitTags = (v: string) => v.split(",").map((t) => t.trim()).filter(Boolean);

/** Title lives in documentStore, author/tags in docMetaStore (→ SavedGraph.meta);
 *  edits capture into the current document so they persist. */
export function DocumentProperties() {
  const open = useSyncExternalStore(docPropertiesPanel.subscribe, docPropertiesPanel.get);
  useSyncExternalStore(documentStore.subscribe, documentStore.version);
  useSyncExternalStore(docMetaStore.subscribe, docMetaStore.version);
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEscapeToClose(() => docPropertiesPanel.close(), open);

  if (!open) return null;

  const title = documentStore.currentName();
  const author = docMetaStore.author();
  const tags = docMetaStore.tags().join(", ");
  const docBase = paletteStore.docPalette()?.base ?? "";

  const capture = () => documentStore.captureCurrent();

  function setDocBase(name: string) {
    const overrides = paletteStore.docPalette()?.overrides;
    paletteStore.setDocPalette(name ? { base: name, overrides } : overrides ? { overrides } : null);
    const ed = getEditor();
    if (ed) rebuildGroupMembership(ed);
    capture();
  }

  return (
    <div className="solenoid-settings" onPointerDown={() => docPropertiesPanel.close()}>
      <div
        ref={panelRef}
        className="solenoid-settings__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Document properties"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="solenoid-settings__header">
          <span className="solenoid-settings__title">Document properties</span>
          <button className="solenoid-settings__close" onClick={() => docPropertiesPanel.close()} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="solenoid-settings__body">
          <div className="solenoid-settings__section">
            <div className="solenoid-settings__section-title">Details</div>
            <TextRow label="Title" value={title} onCommit={(v) => { const t = v.trim(); if (t) documentStore.renameCurrent(t); }} />
            <TextRow label="Author" value={author} onCommit={(v) => { docMetaStore.setAuthor(v.trim()); capture(); }} />
            <TextRow label="Tags" value={tags} placeholder="comma, separated" onCommit={(v) => { docMetaStore.setTags(splitTags(v)); capture(); }} />
          </div>
          <div className="solenoid-settings__section">
            <div className="solenoid-settings__section-title">Appearance</div>
            <label className="solenoid-settings__row solenoid-settings__row--palette">
              <span className="solenoid-settings__row-text">
                <span className="solenoid-settings__row-label">Color palette for this document</span>
              </span>
              <span className="solenoid-settings__select-wrap">
                <select className="solenoid-settings__select" value={docBase} onChange={(e) => setDocBase(e.target.value)}>
                  <option value="">Follow app</option>
                  {paletteStore.names().map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <svg className="solenoid-settings__select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
