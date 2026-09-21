// [[C107]] obsidianPlugin
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
import { PROPERTY_KINDS, validateYaml, readColumnTypes, scalarText, cellToYaml, type PropertyKind, type ColumnTypes } from "./yamlValue";
import { createShadowHost, releaseShadowHost, popupLayerRoot, removePopupLayer, homePopupLayer, adoptSheets, syncTheme, refreshTokens, openPopupsOver } from "./shadow";
import { CUSTOM_ICONS, kindIcon } from "./icons";

/** What Obsidian hands a property widget (read from the 1.13 source; not in the public API). */
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
}

interface Mount { host: HTMLElement; root: Root; attached: boolean }

interface PluginData { palette?: string; columnTypes?: Record<string, ColumnTypes>; look?: boolean }

const LOOK_CLASS = "solenoid-look";

const SOLENOID_LINKS = ["https://solenoid-ngc.vercel.app", "https://github.com/bubba8587/solenoid"];

export default class SolenoidPropertiesPlugin extends Plugin {
  private mounts = new Set<Mount>();
  private popups: Root | null = null;
  private data: PluginData = {};

  async onload(): Promise<void> {
    const stored = ((await this.loadData()) ?? {}) as PluginData;
    this.data = { palette: stored.palette, columnTypes: readColumnTypes(stored.columnTypes), look: stored.look === true };
    // The app's stores keep nothing here (their `localStorage` is memory in this build): the
    // vault's own data decides the palette.
    paletteStore.setActiveBase((this.data.palette ?? "Default") as PaletteName);

    for (const [id, svg] of Object.entries(CUSTOM_ICONS)) addIcon(id, svg);
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) widgets[kind.id] = this.widgetFor(kind);

    this.renderPopups();

    this.registerEvent(this.app.workspace.on("css-change", syncTheme));
    // A tab dragged out to a window of its own carries its chips with it.
    this.registerEvent(this.app.workspace.on("window-open", () => window.setTimeout(() => this.sweep(), 300)));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.sweep()));
    this.registerEvent(this.app.workspace.on("window-open", (win) => this.wearLook(win.doc)));
    this.app.workspace.onLayoutReady(() => this.wearLook());
    this.addSettingTab(new SolenoidSettingTab(this.app, this));
  }

  onunload(): void {
    for (const doc of this.windows()) doc.body.removeClass(LOOK_CLASS);
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) delete widgets[kind.id];
    tablePopup.close();
    cubePopup.close();
    for (const m of this.mounts) this.unmount(m);
    this.popups?.unmount();
    this.popups = null;
    removePopupLayer();
  }

  /** Every Obsidian window's document: the main one and each popped-out note. */
  private windows(): Set<Document> {
    const docs = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return docs;
  }

  /** The Solenoid look is a class on the body: every rule of it hangs under that class. */
  wearLook(doc?: Document): void {
    for (const d of doc ? [doc] : this.windows()) d.body.toggleClass(LOOK_CLASS, this.data.look === true);
  }

  get look(): boolean { return this.data.look === true; }

  async setLook(on: boolean): Promise<void> {
    this.data.look = on;
    this.wearLook();
    await this.saveData(this.data);
  }

  /** The one popup layer, rendered in whichever window it currently lives in. */
  private renderPopups(): void {
    this.popups?.unmount();
    this.popups = createRoot(popupLayerRoot());
    this.popups.render(<><TablePopup /><CubePopup /></>);
  }

  async setPalette(name: PaletteName): Promise<void> {
    paletteStore.setActiveBase(name);
    refreshTokens();
    this.data.palette = name;
    await this.saveData(this.data);
  }

  /** A frame property's picked column types: by property name, vault-wide, as Obsidian types a property. */
  private async setColumnTypes(key: string, types: ColumnTypes): Promise<void> {
    this.data.columnTypes = { ...this.data.columnTypes, [key]: { ...this.data.columnTypes?.[key], ...types } };
    await this.saveData(this.data);
  }

  /** Mount app UI in its own shadow host under `el`. */
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

  /** Obsidian empties a container to re-render; what it dropped unmounts here. It also builds a
   *  property row off-document and attaches it after `render` returns, so a host only counts as
   *  dropped once it has been seen attached. */
  private sweep(): void {
    for (const m of this.mounts) {
      if (m.host.isConnected) { m.attached = true; adoptSheets(m.host); }
      else if (m.attached) this.unmount(m);
    }
  }

  /** The note's own pane when it sits in the center area; else the center area (a property
   *  shown in a sidebar would otherwise size its editor to the sidebar). */
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

  private widgetFor(kind: PropertyKind): PropertyWidget {
    return {
      type: kind.id,
      icon: kindIcon(kind),
      name: () => kind.name,
      validate: (value) => validateYaml(kind, value),
      render: (el, value, ctx) => {
        if (kind.shape === "scalar") return scalarField(el, kind, value, ctx);
        const shadow = this.mount(el, "solenoid-property-chip",
          <PropertyChip
            kind={kind}
            label={ctx.key}
            initial={value}
            onChange={(next) => ctx.onChange(next)}
            columnTypes={this.data.columnTypes?.[ctx.key]}
            onColumnTypes={(types) => void this.setColumnTypes(ctx.key, types)}
          />);
        shadow.host.addEventListener("pointerdown", () => {
          // The editor opens in the chip's own window: a popped-out note keeps its popup.
          if (homePopupLayer(shadow.host.ownerDocument)) this.renderPopups();
          openPopupsOver(this.paneOf(shadow.host));
        }, true);
        return { focus: () => shadow.querySelector("button")?.focus() };
      },
    };
  }
}

/** A scalar property is a plain field in Obsidian's own style: Enter or blur commits, Escape
 *  reverts, and text the family cannot read is marked and never written ([[C95]] commitOnEnter). */
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

  /** The three rows, each drawn by hand: the palette row mounts the app's swatches. */
  private rows(): { name: string; render: (setting: Setting) => void }[] {
    return [
      {
        name: "Color palette",
        render: (setting) => {
          // Settings is a window of its own.
          setting.settingEl.ownerDocument.body.toggleClass(LOOK_CLASS, this.plugin.look);
          // The app's Settings row: the dropdown with the swatch legend stacked under it.
          setting.addDropdown((dropdown) => {
            for (const name of paletteStore.names()) dropdown.addOption(name, name);
            dropdown.setValue(paletteStore.activeBase());
            dropdown.onChange((name) => void this.plugin.setPalette(name as PaletteName));
          });
          setting.controlEl.addClass("solenoid-settings-palette");
          this.plugin.mount(setting.controlEl, "solenoid-settings-swatches", <PaletteSwatches />);
        },
      },
      {
        name: "Solenoid look",
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(this.plugin.look).onChange(async (on) => {
            await this.plugin.setLook(on);
            setting.settingEl.ownerDocument.body.toggleClass(LOOK_CLASS, on);
          }));
        },
      },
      {
        name: "Solenoid",
        render: (setting) => {
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
