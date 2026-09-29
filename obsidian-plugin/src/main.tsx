// [[C107]] obsidianPlugin, [[D89]] pluginApi, [[D90]] cubeTypesAtDepth
import { Plugin, PluginSettingTab, Setting, addIcon, type App, type SettingDefinitionItem } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/index.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "../../src/App.css";
import { TablePopup } from "../../src/graph/components/TablePopup";
import { CubePopup } from "../../src/graph/components/CubePopup";
import { tablePopup } from "../../src/graph/tablePopupStore";
import { cubePopup } from "../../src/graph/cubePopupStore";
import { paletteStore, type PaletteName } from "../../src/graph/palette";
import type { ReactNode } from "react";
import { PropertyChip } from "./PropertyChip";
import { PaletteSwatches } from "./PaletteSwatches";
import { PROPERTY_KINDS, validateYaml, readColumnTypes, scalarText, cellToYaml, columnNameOptions, type PropertyKind, type ColumnTypes, type ColumnNameOption } from "./yamlValue";
import { readPluginNestedTables, type PluginNestedTables } from "../../src/graph/pluginColumnTypes";
import type { NestedTables } from "../../src/graph/cubeTypes";
import { createShadowHost, releaseShadowHost, popupLayerRoot, removePopupLayer, homePopupLayer, adoptSheets, syncTheme, refreshTokens, openPopupsOver, setAccentSlot } from "./shadow";
import { CUSTOM_ICONS, kindIcon } from "./icons";
import { LOOK_CLASS, DEFAULT_ACCENT, paletteClass, accentClass, isAccentSlot } from "./lookTokens";
import { KnapNotes } from "./knapBody";
import { setObsidianApp } from "./obsidianApp";

interface WidgetContext {
  app: App;
  key: string;
  onChange(value: unknown): void;
  sourcePath: string;
  blur(): void;
}
interface PropertyWidget {
  type: string;
  icon: string;
  name(): string;
  validate(value: unknown): boolean;
  render(el: HTMLElement, value: unknown, ctx: WidgetContext): { focus(mode?: string): void };
}
interface MetadataTypeManager {
  registeredTypeWidgets: Record<string, PropertyWidget>;
  getAssignedWidget(name: string): string | null;
}

interface Mount { host: HTMLElement; root: Root; attached: boolean }

interface PluginData {
  palette?: string;
  accent?: string;
  columnTypes?: Record<string, ColumnTypes>;
  /** Note path, then property: the column types of the tables nested in that note's cube. */
  nestedTables?: PluginNestedTables;
  look?: boolean;
  /** Off only when the user turns it off ([[D92]] columnNameSuggest). */
  suggestColumns?: boolean;
}

const SOLENOID_LINKS = ["https://solenoid-ngc.vercel.app", "https://github.com/bubba8587/solenoid"];

const COLUMN_TYPES_EVENT = "solenoid-properties:column-types";
const FRAME_KIND = PROPERTY_KINDS.find((kind) => kind.id === "solenoid-frame")!;

export default class SolenoidPropertiesPlugin extends Plugin {
  private mounts = new Set<Mount>();
  private popups: Root | null = null;
  private data: PluginData = {};

  readonly api = {
    version: 1 as const,
    COLUMN_TYPES_EVENT,
    frameChip: (el: HTMLElement, key: string, value: unknown, onChange: (next: unknown) => void): void => {
      this.chip(el, FRAME_KIND, key, value, onChange);
    },
    release: (el: Element): void => this.release(el),
    columnTypes: (key: string): ColumnTypes => ({ ...this.data.columnTypes?.[key] }),
    setColumnTypes: (key: string, types: ColumnTypes, replace = false): Promise<void> => this.setColumnTypes(key, types, replace),
    columnNames: (): ColumnNameOption[] => this.columnNames(),
  };

  async onload(): Promise<void> {
    setObsidianApp(this.app);
    const stored = ((await this.loadData()) ?? {}) as PluginData;
    this.data = {
      palette: stored.palette,
      accent: isAccentSlot(stored.accent) ? stored.accent : DEFAULT_ACCENT,
      columnTypes: readColumnTypes(stored.columnTypes),
      nestedTables: readPluginNestedTables(stored.nestedTables),
      look: stored.look === true,
      suggestColumns: stored.suggestColumns !== false,
    };
    paletteStore.setActiveBase((this.data.palette ?? "Default") as PaletteName);
    setAccentSlot(this.accent);

    for (const [id, svg] of Object.entries(CUSTOM_ICONS)) addIcon(id, svg);
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) widgets[kind.id] = this.widgetFor(kind);

    this.renderPopups();
    new KnapNotes(this).register();

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.moveNestedTables(oldPath, file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => void this.moveNestedTables(file.path, null)));
    this.registerEvent(this.app.workspace.on("css-change", syncTheme));
    this.registerEvent(this.app.workspace.on("window-open", () => window.setTimeout(() => this.sweep(), 300)));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.sweep()));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.wearLook(win.doc)));
    this.app.workspace.onLayoutReady(() => this.wearLook());
    this.addSettingTab(new SolenoidSettingTab(this.app, this));
  }

  onunload(): void {
    for (const doc of this.windows()) this.shedLook(doc);
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) delete widgets[kind.id];
    tablePopup.close();
    cubePopup.close();
    for (const m of this.mounts) this.unmount(m);
    this.popups?.unmount();
    this.popups = null;
    removePopupLayer();
  }

  private windows(): Set<Document> {
    const docs = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return docs;
  }

  wearLook(doc?: Document): void {
    const wear = [LOOK_CLASS, paletteClass(paletteStore.activeBase()), accentClass(this.accent)];
    for (const d of doc ? [doc] : this.windows()) {
      this.shedLook(d, wear);
      // One class per call: Obsidian's toggleClass tests instanceof Array, which an array from another window fails.
      for (const cls of wear) d.body.toggleClass(cls, this.look);
    }
  }

  private shedLook(doc: Document, keep: string[] = []): void {
    for (const cls of Array.from(doc.body.classList)) {
      if (cls.startsWith("solenoid-") && !keep.includes(cls)) doc.body.removeClass(cls);
    }
  }

  get look(): boolean { return this.data.look === true; }
  get accent(): string { return this.data.accent ?? DEFAULT_ACCENT; }
  get suggestColumns(): boolean { return this.data.suggestColumns !== false; }

  async setSuggestColumns(on: boolean): Promise<void> {
    this.data.suggestColumns = on;
    await this.saveData(this.data);
  }

  /** The column names typed in the vault's Frame and Cube properties, or none when the setting is off. */
  columnNames(): ColumnNameOption[] {
    if (!this.suggestColumns) return [];
    const types = this.data.columnTypes ?? {};
    return columnNameOptions(types, Object.keys(types).filter((key) => this.objectKind(key)?.shape === "frame" || this.objectKind(key)?.shape === "cube"));
  }

  async setLook(on: boolean): Promise<void> {
    this.data.look = on;
    this.wearLook();
    this.announceCss();
    await this.saveData(this.data);
  }

  /** The graph view is a canvas that re-reads its colors only when Obsidian says the CSS changed. */
  private announceCss(): void {
    this.app.workspace.trigger("css-change");
  }

  private renderPopups(): void {
    this.popups?.unmount();
    this.popups = createRoot(popupLayerRoot());
    this.popups.render(<><TablePopup /><CubePopup /></>);
  }

  async setPalette(name: PaletteName): Promise<void> {
    paletteStore.setActiveBase(name);
    refreshTokens();
    this.wearLook();
    this.announceCss();
    this.data.palette = name;
    await this.saveData(this.data);
  }

  async setAccent(slot: string): Promise<void> {
    if (!isAccentSlot(slot)) return;
    this.data.accent = slot;
    setAccentSlot(slot);
    refreshTokens();
    this.wearLook();
    this.announceCss();
    await this.saveData(this.data);
  }

  private async setColumnTypes(key: string, types: ColumnTypes, replace = false): Promise<void> {
    this.data.columnTypes = { ...this.data.columnTypes, [key]: replace ? { ...types } : { ...this.data.columnTypes?.[key], ...types } };
    await this.saveData(this.data);
    this.app.workspace.trigger(COLUMN_TYPES_EVENT, key);
  }

  mount(el: HTMLElement, className: string, node: ReactNode): ShadowRoot {
    this.sweep();
    const { host, root: shadow } = createShadowHost("span", className, el.ownerDocument);
    el.appendChild(host);
    const root = createRoot(shadow);
    root.render(node);
    this.mounts.add({ host, root, attached: host.isConnected });
    window.requestAnimationFrame(() => this.sweep());
    return shadow;
  }

  private sweep(): void {
    for (const m of this.mounts) {
      if (m.host.isConnected) { m.attached = true; adoptSheets(m.host); }
      else if (m.attached) this.unmount(m);
    }
  }

  private paneOf(host: Element): HTMLElement | null {
    // A popped-out note has a center area of its own, in its own document.
    const center = host.ownerDocument.querySelector<HTMLElement>(".mod-root");
    const leaf = host.closest<HTMLElement>(".workspace-leaf");
    return leaf && center?.contains(leaf) ? leaf : center;
  }

  private typeManager(): MetadataTypeManager {
    return (this.app as unknown as { metadataTypeManager: MetadataTypeManager }).metadataTypeManager;
  }

  private unmount(m: Mount): void {
    m.root.unmount();
    releaseShadowHost(m.host);
    this.mounts.delete(m);
  }

  /** Unmounts what `mount` put inside `el`. */
  release(el: Element): void {
    for (const m of this.mounts) if (el.contains(m.host)) this.unmount(m);
  }

  /** The Solenoid type a property is assigned, when it is one with a chip. */
  objectKind(key: string): PropertyKind | undefined {
    const id = this.typeManager().getAssignedWidget(key);
    return PROPERTY_KINDS.find((kind) => kind.id === id && kind.shape !== "scalar");
  }

  /** A note's nested-table types follow it when it's renamed, and go when it's deleted. */
  private async moveNestedTables(from: string, to: string | null): Promise<void> {
    const { [from]: moved, ...rest } = this.data.nestedTables ?? {};
    if (!moved) return;
    this.data.nestedTables = to ? { ...rest, [to]: moved } : rest;
    await this.saveData(this.data);
  }

  private async setNestedTables(note: string, key: string, nested: NestedTables): Promise<void> {
    const { [note]: props = {}, ...others } = this.data.nestedTables ?? {};
    const { [key]: _old, ...otherProps } = props;
    const nextProps = Object.keys(nested).length ? { ...otherProps, [key]: nested } : otherProps;
    this.data.nestedTables = Object.keys(nextProps).length ? { ...others, [note]: nextProps } : others;
    await this.saveData(this.data);
  }

  /** A property's chip in `el`, the same in the properties panel and in a note's body. `sourcePath` is the note the chip edits; without one (another plugin's Frame), nested types are neither read nor kept. */
  chip(el: HTMLElement, kind: PropertyKind, key: string, value: unknown, onChange: (next: unknown) => void, sourcePath?: string): ShadowRoot {
    const shadow = this.mount(el, "solenoid-property-chip",
      <PropertyChip
        kind={kind}
        label={key}
        initial={value}
        onChange={onChange}
        columnTypes={this.data.columnTypes?.[key]}
        onColumnTypes={(types, replace) => void this.setColumnTypes(key, types, replace)}
        columnNameOptions={() => this.columnNames()}
        nestedTables={sourcePath ? this.data.nestedTables?.[sourcePath]?.[key] : undefined}
        onNestedTables={sourcePath ? (nested) => void this.setNestedTables(sourcePath, key, nested) : undefined}
      />);
    shadow.host.addEventListener("pointerdown", () => {
      if (homePopupLayer(shadow.host.ownerDocument)) this.renderPopups();
      openPopupsOver(this.paneOf(shadow.host));
    }, true);
    return shadow;
  }

  private widgetFor(kind: PropertyKind): PropertyWidget {
    return {
      type: kind.id,
      icon: kindIcon(kind),
      name: () => kind.name,
      validate: (value) => validateYaml(kind, value),
      render: (el, value, ctx) => {
        if (kind.shape === "scalar") return scalarField(el, kind, value, ctx);
        const shadow = this.chip(el, kind, ctx.key, value, (next) => ctx.onChange(next), ctx.sourcePath);
        return { focus: () => shadow.querySelector("button")?.focus() };
      },
    };
  }
}

function scalarField(el: HTMLElement, kind: PropertyKind, value: unknown, ctx: WidgetContext): { focus(): void } {
  const input = el.createEl("input", { cls: "metadata-input metadata-input-text solenoid-scalar", type: "text" });
  let settled = scalarText(kind, value);
  input.value = settled;
  input.spellcheck = false;
  const commit = () => {
    const text = input.value.trim();
    const next = cellToYaml(text, kind.family!);
    const refused = text !== "" && next === null;
    input.toggleClass("is-invalid", refused);
    if (refused || text === settled) return;
    settled = text;
    ctx.onChange(next);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = settled; input.removeClass("is-invalid"); input.blur(); }
  });
  return { focus: () => input.focus() };
}

class SolenoidSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SolenoidPropertiesPlugin) {
    super(app, plugin);
  }

  private rows(): { name: string; render: (setting: Setting) => void }[] {
    return [
      {
        name: "Color palette",
        render: (setting) => {
          this.plugin.wearLook(setting.settingEl.ownerDocument);
          setting.addDropdown((dropdown) => {
            for (const name of paletteStore.names()) dropdown.addOption(name, name);
            dropdown.setValue(paletteStore.activeBase());
            dropdown.onChange(async (name) => {
              await this.plugin.setPalette(name as PaletteName);
              this.plugin.wearLook(setting.settingEl.ownerDocument);
            });
          });
          setting.controlEl.addClass("solenoid-settings-palette");
          this.plugin.mount(setting.controlEl, "solenoid-settings-swatches",
            <PaletteSwatches accent={() => this.plugin.accent} onPick={(slot) => void this.plugin.setAccent(slot).then(() => this.plugin.wearLook(setting.settingEl.ownerDocument))} />);
        },
      },
      {
        name: "Solenoid look",
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.look).onChange(async (on) => {
            await this.plugin.setLook(on);
            this.plugin.wearLook(setting.settingEl.ownerDocument);
          }));
        },
      },
      {
        name: "Suggest column names",
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.suggestColumns).onChange((on) => void this.plugin.setSuggestColumns(on)));
        },
      },
      {
        name: "Solenoid",
        render: (setting) => {
          setting.controlEl.addClass("solenoid-settings-links");
          for (const url of SOLENOID_LINKS) {
            setting.controlEl.createEl("a", { text: url.replace("https://", ""), href: url, cls: "external-link", attr: { target: "_blank", rel: "noopener" } });
          }
        },
      },
    ];
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.rows().map((row) => ({ name: row.name, render: (setting) => row.render(setting.setName(row.name)) }));
  }

  /** Obsidian before 1.13 draws the tab through this; 1.13 draws it from the definitions. */
  display(): void {
    this.containerEl.empty();
    for (const row of this.rows()) row.render(new Setting(this.containerEl).setName(row.name));
  }
}
