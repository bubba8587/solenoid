import { useRef, useState, useSyncExternalStore } from "react";
import { useFocusTrap } from "./components/useFocusTrap";
import { useEscapeToClose } from "./components/useEscapeToClose";
import { settingsStore, settingsPanel, SETTINGS_SCHEMA, type SettingField } from "./settingsStore";
import { apiKeyStore } from "./apiKeyStore";
import { AI_PROVIDER } from "./aiKey";
import { IS_MOBILE } from "./coarse";
import { packsStore, allPacks, loadCustomPacks, customPacksFolder } from "./packs";
import { isDesktop, pickFolderDialog, openInFileManager } from "./fileBridge";
import { paletteStore, paletteEditorPanel, type PaletteChoice } from "./palette";
import { useRenderMode, renderModeStore } from "./renderMode";
import { supportsHtmlInCanvas } from "./htmlCanvasSupport";
import { getEditor } from "./process";
import { rebuildGroupMembership } from "./groupMembership";
import { SwatchGrid } from "./components/SwatchGrid";
import "./Settings.css";

/**
 * Settings page: a modal rendered from SETTINGS_SCHEMA — add a field there and a
 * toggle shows up here automatically.
 */

// A setting whose feature has no mobile counterpart renders inert and grayed, with
// one line saying why. Greying rather than hiding keeps the Settings page the same
// shape on both, so a user who knows the desktop app can still find the row.
const MOBILE_NA = "Not available in mobile mode.";
const naOnThisDevice = (field: SettingField): boolean => IS_MOBILE && !!field.disabledOnMobile;

function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`solenoid-settings__switch${on ? " solenoid-settings__switch--on" : ""}`}
      onClick={onClick}
    >
      <span className="solenoid-settings__knob" />
    </button>
  );
}

function Row({ label, help, on, onToggle, disabled, disabledNote }: {
  label: string; help?: string; on: boolean; onToggle: () => void;
  disabled?: boolean; disabledNote?: string;
}) {
  return (
    // Stays a <label> so clicking anywhere on the row toggles the switch (the
    // browser forwards the click to the first labelable descendant). Switch's
    // own explicit aria-label wins over that implicit association, so the
    // announced name is just the label — the help text doesn't fold in.
    // When disabled the <button> is inert, so the label's click forwarding is a
    // no-op too — no extra guard needed.
    <label className={`solenoid-settings__row${disabled ? " solenoid-settings__row--disabled" : ""}`}>
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{label}</span>
        {help && <span className="solenoid-settings__row-help">{help}</span>}
        {disabled && disabledNote && <span className="solenoid-settings__muted">{disabledNote}</span>}
      </span>
      <Switch on={on} onClick={onToggle} label={label} disabled={disabled} />
    </label>
  );
}

function Toggle({ field }: { field: SettingField }) {
  const off = naOnThisDevice(field);
  return (
    <Row
      label={field.label}
      help={field.help}
      disabled={off}
      disabledNote={MOBILE_NA}
      on={settingsStore.get(field.key) as boolean}
      onToggle={() => settingsStore.toggle(field.key as Parameters<typeof settingsStore.toggle>[0])}
    />
  );
}

// A mutually-exclusive choice: a row of buttons, one highlighted.
function SegmentRow({ field }: { field: SettingField }) {
  const value = settingsStore.get(field.key) as string;
  const off = naOnThisDevice(field);
  return (
    <div className={`solenoid-settings__row${off ? " solenoid-settings__row--disabled" : ""}`}>
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{field.label}</span>
        {field.help && <span className="solenoid-settings__row-help">{field.help}</span>}
        {off && <span className="solenoid-settings__muted">{MOBILE_NA}</span>}
      </span>
      <span className="solenoid-settings__segment" role="radiogroup">
        {(field.options ?? []).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={off}
            className={`solenoid-settings__segbtn${value === o.value ? " solenoid-settings__segbtn--on" : ""}`}
            onClick={() => settingsStore.set(field.key, o.value as never)}
          >
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

// A path setting: shows the chosen folder + an OS picker. Desktop only — in the
// browser the picker is disabled with a note (no filesystem there).
function FolderRow({ field }: { field: SettingField }) {
  const value = settingsStore.get(field.key) as string;
  const desktop = isDesktop();
  async function choose() {
    const picked = await pickFolderDialog();
    if (picked) settingsStore.set(field.key, picked);
  }
  return (
    <div className="solenoid-settings__row solenoid-settings__row--folder">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{field.label}</span>
        {field.help && <span className="solenoid-settings__row-help">{field.help}</span>}
        <span className="solenoid-settings__path" title={value || undefined}>{value || "Not set"}</span>
        {!desktop && <span className="solenoid-settings__muted">Available in the desktop app only.</span>}
      </span>
      <span className="solenoid-settings__folder-actions">
        <button type="button" className="solenoid-settings__store-btn" disabled={!desktop} onClick={choose}>Choose…</button>
        {value && desktop && <button type="button" className="solenoid-settings__store-btn" onClick={() => void openInFileManager(value)}>Open</button>}
        {value && <button type="button" className="solenoid-settings__store-btn" onClick={() => settingsStore.set(field.key, "")}>Clear</button>}
      </span>
    </div>
  );
}

// A free-text setting (e.g. a relative subfolder name). Commits on blur / Enter,
// the typed-field convention — never per keystroke.
function TextRow({ field }: { field: SettingField }) {
  const value = settingsStore.get(field.key) as string;
  const [draft, setDraft] = useState(value);
  const commit = () => settingsStore.set(field.key, draft.trim() as never);
  return (
    <div className="solenoid-settings__row solenoid-settings__row--folder">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{field.label}</span>
        {field.help && <span className="solenoid-settings__row-help">{field.help}</span>}
      </span>
      <span className="solenoid-settings__folder-actions">
        <input
          type="text"
          className="solenoid-settings__key-input"
          placeholder={field.placeholder}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
          onBlur={commit}
        />
      </span>
    </div>
  );
}

// App-wide color palette switcher. Lives here (not in the accent dropdown) so the
// accent picker stays about the accent only. Bound to paletteStore, not
// settingsStore, so it can't reuse the schema-driven SegmentRow — but it borrows
// the same segment styling. setActiveBase retints everything that resolves a slot
// (notes, groups, accent, node headers) via the appThemeStore re-notify wired in
// appTheme.ts; the group member-dot store caches resolved hexes, so rebuild it too.
function PaletteSection() {
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  const active = paletteStore.activeBase();
  function pick(name: PaletteChoice) {
    paletteStore.setActiveBase(name);
    const ed = getEditor();
    if (ed) rebuildGroupMembership(ed);
  }
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">Appearance</div>
      <div className="solenoid-settings__row solenoid-settings__row--palette">
        <span className="solenoid-settings__row-text">
          <span className="solenoid-settings__row-label">Color palette</span>
        </span>
        {/* Dropdown + an "Edit…" that opens the custom-palette editor, with a
            read-only swatch legend of the active palette stacked under them. */}
        <div className="solenoid-settings__palette-control">
          <div className="solenoid-settings__palette-row">
            <span className="solenoid-settings__select-wrap">
              <select
                className="solenoid-settings__select"
                value={active}
                onChange={(e) => pick(e.target.value as PaletteChoice)}
              >
                {paletteStore.names().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="Custom">Custom</option>
              </select>
              {/* Lucide "chevron-down" (ISC). */}
              <svg className="solenoid-settings__select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            <button type="button" className="solenoid-settings__palette-edit" onClick={() => paletteEditorPanel.open()}>
              Edit custom…
            </button>
          </div>
          <SwatchGrid readOnly />
        </div>
      </div>
    </div>
  );
}
// Renderer toggle — the HTML-in-Canvas ("html") renderer vs the permanent DOM renderer.
// Gated on the Chrome flag being on (supportsHtmlInCanvas). Off → DOM. The choice
// persists (renderModeStore).
function RendererSection() {
  const mode = useRenderMode();
  const [supported] = useState(supportsHtmlInCanvas);
  const on = mode === "html";
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">Renderer</div>
      <Row
        label="HTML-in-Canvas GPU renderer"
        help={
          supported
            ? "Faster zoom and pan on big graphs. Experimental; the DOM renderer is the fallback."
            : "Requires Chrome with chrome://flags/#canvas-draw-element. Unavailable in this browser."
        }
        on={on && supported}
        onToggle={() => { if (supported) renderModeStore.set(on ? "dom" : "html"); }}
      />
      {!supported && (
        <div className="solenoid-settings__note">Enable the flag and reload to use the canvas renderer.</div>
      )}
    </div>
  );
}

function PacksSection() {
  useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const builtin = allPacks().filter((p) => p.builtin);
  const custom = loadCustomPacks();
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">Node Packs</div>
      {builtin.map((p) => (
        <Row
          key={p.id}
          label={p.name}
          help={p.description}
          on={packsStore.isActive(p.id)}
          onToggle={() => packsStore.toggle(p.id)}
        />
      ))}

      <div className="solenoid-settings__subhead">Custom packs</div>
      {custom.length === 0 ? (
        <div className="solenoid-settings__note">
          No custom packs.
          <span className="solenoid-settings__muted"> Custom-pack loading from <code>{customPacksFolder()}</code> isn’t wired up yet.</span>
        </div>
      ) : (
        custom.map((p) => (
          <Row key={p.id} label={p.name} help={p.description} on={packsStore.isActive(p.id)} onToggle={() => packsStore.toggle(p.id)} />
        ))
      )}

      <button type="button" className="solenoid-settings__store-btn" disabled title="Coming soon">
        Browse pack store…
      </button>
    </div>
  );
}

// API keys for the data-connection providers (FRED, Alpha Vantage). Stored per
// provider in localStorage on this device only (apiKeyStore) — the "never bundled"
// key store.
const API_PROVIDERS = [
  { id: "fred", label: "FRED", help: "Economic data series from the St. Louis Fed; free key at fredaccount.stlouisfed.org." },
  { id: "alphavantage", label: "Alpha Vantage", help: "Stock history; free key at alphavantage.co." },
] as const;

function ApiKeyRow({ id, label, help }: { id: string; label: string; help: string }) {
  const [draft, setDraft] = useState("");
  const stored = apiKeyStore.has(id);
  // Commit on blur / Enter (typed-field convention), not per keystroke.
  const commit = () => {
    if (draft.trim()) { apiKeyStore.set(id, draft); setDraft(""); }
  };
  return (
    <div className="solenoid-settings__row solenoid-settings__row--folder">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{label}</span>
        <span className="solenoid-settings__row-help">{help}</span>
        <span className="solenoid-settings__path">{stored ? "Key saved" : "No key"}</span>
      </span>
      <span className="solenoid-settings__folder-actions">
        <input
          type="password"
          className="solenoid-settings__key-input"
          placeholder={stored ? "Replace key…" : "Paste key…"}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          onBlur={commit}
        />
        {stored && (
          <button type="button" className="solenoid-settings__store-btn" onClick={() => apiKeyStore.remove(id)}>Clear</button>
        )}
      </span>
    </div>
  );
}

function ApiKeysSection() {
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">Data connection API keys</div>
      {API_PROVIDERS.map((p) => <ApiKeyRow key={p.id} id={p.id} label={p.label} help={p.help} />)}
      <div className="solenoid-settings__note">Stored only on this device; sent only to each provider's own API.</div>
    </div>
  );
}

// The AI account. Its own section rather than a third row under the data providers:
// the key gates a different surface (the command palette's AI mode), not a data node.
function AiSection() {
  useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.version);
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">AI</div>
      <ApiKeyRow
        id={AI_PROVIDER}
        label="Anthropic API key"
        help="Connects an AI account. The command palette gains a sparkle that switches it to asking the AI."
      />
      <div className="solenoid-settings__note">
        Stored only on this device and sent only to Anthropic. Type demo instead of a key
        to preview the assistant with canned replies.
      </div>
    </div>
  );
}

export function Settings() {
  const open = useSyncExternalStore(settingsPanel.subscribe, settingsPanel.get);
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEscapeToClose(() => settingsPanel.close(), open);

  if (!open) return null;

  return (
    <div className="solenoid-settings" onPointerDown={() => settingsPanel.close()}>
      <div ref={panelRef} className="solenoid-settings__panel" role="dialog" aria-modal="true" aria-label="Settings" onPointerDown={(e) => e.stopPropagation()}>
        <div className="solenoid-settings__header">
          <span className="solenoid-settings__title">Settings</span>
          <button className="solenoid-settings__close" onClick={() => settingsPanel.close()} aria-label="Close">×</button>
        </div>
        <div className="solenoid-settings__body">
          {SETTINGS_SCHEMA.map((section) => (
            <div key={section.title} className="solenoid-settings__section">
              <div className="solenoid-settings__section-title">{section.title}</div>
              {section.fields.map((f) =>
                f.type === "folder" ? <FolderRow key={f.key} field={f} />
                : f.type === "segment" ? <SegmentRow key={f.key} field={f} />
                : f.type === "text" ? <TextRow key={f.key} field={f} />
                : <Toggle key={f.key} field={f} />)}
            </div>
          ))}
          <PaletteSection />
          <RendererSection />
          <AiSection />
          <ApiKeysSection />
          <PacksSection />
        </div>
      </div>
    </div>
  );
}
