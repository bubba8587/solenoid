import { useEffect, useState, useSyncExternalStore } from "react";
import { settingsStore, settingsPanel, SETTINGS_SCHEMA, type SettingField } from "./settingsStore";
import { packsStore, allPacks, loadCustomPacks, customPacksFolder } from "./packs";
import { isDesktop, pickFolderDialog } from "./fileBridge";
import { paletteStore, type PaletteName } from "./palette";
import { useRenderMode, renderModeStore } from "./renderMode";
import { supportsHtmlInCanvas } from "./htmlCanvasSupport";
import { getEditor } from "./process";
import { rebuildGroupMembership } from "./groupMembership";
import { SwatchGrid } from "./components/SwatchGrid";
import "./Settings.css";

/**
 * Rudimentary Settings page. A modal rendered from SETTINGS_SCHEMA — add a field
 * there and a toggle shows up here automatically. (Node Packs will get their own
 * section here in a later pass.)
 */

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`solenoid-settings__switch${on ? " solenoid-settings__switch--on" : ""}`}
      onClick={onClick}
    >
      <span className="solenoid-settings__knob" />
    </button>
  );
}

function Row({ label, help, on, onToggle }: { label: string; help?: string; on: boolean; onToggle: () => void }) {
  return (
    <label className="solenoid-settings__row">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{label}</span>
        {help && <span className="solenoid-settings__row-help">{help}</span>}
      </span>
      <Switch on={on} onClick={onToggle} />
    </label>
  );
}

function Toggle({ field }: { field: SettingField }) {
  return (
    <Row
      label={field.label}
      help={field.help}
      on={settingsStore.get(field.key) as boolean}
      onToggle={() => settingsStore.toggle(field.key as Parameters<typeof settingsStore.toggle>[0])}
    />
  );
}

// A mutually-exclusive choice: a row of buttons, one highlighted.
function SegmentRow({ field }: { field: SettingField }) {
  const value = settingsStore.get(field.key) as string;
  return (
    <div className="solenoid-settings__row">
      <span className="solenoid-settings__row-text">
        <span className="solenoid-settings__row-label">{field.label}</span>
        {field.help && <span className="solenoid-settings__row-help">{field.help}</span>}
      </span>
      <span className="solenoid-settings__segment" role="radiogroup">
        {(field.options ?? []).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
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
        {value && <button type="button" className="solenoid-settings__store-btn" onClick={() => settingsStore.set(field.key, "")}>Clear</button>}
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
  function pick(name: PaletteName) {
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
          <span className="solenoid-settings__row-help">Recolors notes, groups, and node headers.</span>
        </span>
        {/* Dropdown + a read-only swatch legend stacked under it, on the right. */}
        <div className="solenoid-settings__palette-control">
          <span className="solenoid-settings__select-wrap">
            <select
              className="solenoid-settings__select"
              value={active}
              onChange={(e) => pick(e.target.value as PaletteName)}
            >
              {paletteStore.names().map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {/* Lucide "chevron-down" (ISC). */}
            <svg className="solenoid-settings__select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          <SwatchGrid readOnly />
        </div>
      </div>
    </div>
  );
}
// Renderer toggle — the HTML-in-Canvas ("html") renderer vs the permanent DOM renderer.
// Unlike the parked WGSL "canvas" mode (which was net-negative and stayed console-only),
// html is perf-validated, so it gets a real UI toggle — gated on the Chrome flag being on
// (supportsHtmlInCanvas). Off → DOM. The choice persists (renderModeStore).
function RendererSection() {
  const mode = useRenderMode();
  const [supported] = useState(supportsHtmlInCanvas);
  const on = mode === "html";
  return (
    <div className="solenoid-settings__section">
      <div className="solenoid-settings__section-title">Renderer</div>
      <Row
        label="GPU renderer (HTML-in-Canvas)"
        help={
          supported
            ? "Faster zoom and pan on big graphs. Experimental; the DOM renderer is the fallback."
            : "Requires Chrome with chrome://flags/#canvas-draw-element (Canary 149+). Unavailable in this browser."
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

export function Settings() {
  const open = useSyncExternalStore(settingsPanel.subscribe, settingsPanel.get);
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") settingsPanel.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="solenoid-settings" onPointerDown={() => settingsPanel.close()}>
      <div className="solenoid-settings__panel" onPointerDown={(e) => e.stopPropagation()}>
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
                : <Toggle key={f.key} field={f} />)}
            </div>
          ))}
          <PaletteSection />
          <RendererSection />
          <PacksSection />
        </div>
      </div>
    </div>
  );
}
