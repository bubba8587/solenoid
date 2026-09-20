// [[C107]] obsidianPlugin
import { Plugin, PluginSettingTab, Setting, addIcon, type App } from "obsidian";
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
import { PROPERTY_KINDS, validateYaml, type PropertyKind } from "./yamlValue";
import { createShadowHost, releaseShadowHost, popupLayerRoot, removePopupLayer, syncTheme, refreshTokens, openPopupsOver } from "./shadow";
import { KIND_ICONS } from "./icons";

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

interface PluginData { palette?: string }

export default class SolenoidPropertiesPlugin extends Plugin {
  private mounts = new Set<Mount>();
  private popups: Root | null = null;

  async onload(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as PluginData;
    if (data.palette) paletteStore.setActiveBase(data.palette as PaletteName);

    for (const [id, svg] of Object.entries(KIND_ICONS)) addIcon(id, svg);
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) widgets[kind.id] = this.widgetFor(kind);

    this.popups = createRoot(popupLayerRoot());
    this.popups.render(<><TablePopup /><CubePopup /></>);

    this.registerEvent(this.app.workspace.on("css-change", syncTheme));
    this.addSettingTab(new SolenoidSettingTab(this.app, this));
  }

  onunload(): void {
    const widgets = this.typeManager().registeredTypeWidgets;
    for (const kind of PROPERTY_KINDS) delete widgets[kind.id];
    tablePopup.close();
    cubePopup.close();
    for (const m of this.mounts) this.unmount(m);
    this.popups?.unmount();
    this.popups = null;
    removePopupLayer();
  }

  async setPalette(name: PaletteName): Promise<void> {
    paletteStore.setActiveBase(name);
    refreshTokens();
    await this.saveData({ palette: name } satisfies PluginData);
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
      if (m.host.isConnected) m.attached = true;
      else if (m.attached) this.unmount(m);
    }
  }

  /** The note's own pane when it sits in the center area; else the center area (a property
   *  shown in a sidebar would otherwise size its editor to the sidebar). */
  private paneOf(host: Element): HTMLElement | null {
    const center = this.app.workspace.containerEl.querySelector<HTMLElement>(".mod-root");
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
      icon: `solenoid-${kind.shape}`,
      name: () => kind.name,
      validate: (value) => validateYaml(kind, value),
      render: (el, value, ctx) => {
        const shadow = this.mount(el, "solenoid-property-chip",
          <PropertyChip kind={kind} label={ctx.key} initial={value} onChange={(next) => ctx.onChange(next)} />);
        shadow.host.addEventListener("pointerdown", () => openPopupsOver(this.paneOf(shadow.host)), true);
        return { focus: () => shadow.querySelector("button")?.focus() };
      },
    };
  }
}

class SolenoidSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SolenoidPropertiesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // The app's Settings row: the dropdown with the swatch legend stacked under it.
    const palette = new Setting(containerEl)
      .setName("Color palette")
      .addDropdown((dropdown) => {
        for (const name of paletteStore.names()) dropdown.addOption(name, name);
        dropdown.setValue(paletteStore.activeBase());
        dropdown.onChange((name) => void this.plugin.setPalette(name as PaletteName));
      });
    palette.controlEl.addClass("solenoid-settings-palette");
    this.plugin.mount(palette.controlEl, "solenoid-settings-swatches", <PaletteSwatches />);
    new Setting(containerEl)
      .setName("Property types")
      .setDesc("Lists and Matrices of numbers, text, dates, complex numbers and Booleans, plus Frames and Cubes. Values stay plain YAML in the note.");
  }
}
