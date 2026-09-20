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
import { PropertyChip } from "./PropertyChip";
import { PROPERTY_KINDS, validateYaml, type PropertyKind } from "./yamlValue";
import { createShadowHost, releaseShadowHost, popupLayerRoot, removePopupLayer, syncTheme, refreshTokens } from "./shadow";
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

interface Mount { host: HTMLElement; root: Root }

interface PluginData { palette?: string }

/** One value per kind, for the settings page's preview row. */
const PREVIEW: Record<string, unknown> = {
  list: [1, 2, 3, 4],
  matrix: [[1, 2, 3], [4, 5, 6]],
  frame: [{ item: "Cabinets", cost: 4200 }, { item: "Tile", cost: 880 }],
  cube: [{ phase: "Install", crew: ["Ana", "Ben"] }],
};
const previewValue = (kind: PropertyKind): unknown => {
  const v = PREVIEW[kind.shape];
  if (kind.family === "string") return kind.shape === "list" ? ["a", "b", "c"] : [["a", "b"], ["c", "d"]];
  if (kind.family === "date") return kind.shape === "list" ? ["2026-01-01", "2026-06-01"] : [["2026-01-01", "2026-06-01"]];
  if (kind.family === "logical") return kind.shape === "list" ? [true, false, true] : [[true, false]];
  if (kind.family === "complex") return kind.shape === "list" ? ["3+4i", "1-2i"] : [["3+4i", "1-2i"]];
  return v;
};

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

  /** Mount one chip in its own shadow host; the caller owns where the host goes. */
  mountChip(el: HTMLElement, kind: PropertyKind, label: string, value: unknown, onChange: (next: unknown) => void): ShadowRoot {
    // Obsidian empties a value cell to re-render; the chips it dropped unmount here.
    for (const m of this.mounts) if (!m.host.isConnected) this.unmount(m);
    const { host, root: shadow } = createShadowHost("span", "solenoid-property-chip");
    el.appendChild(host);
    const root = createRoot(shadow);
    root.render(<PropertyChip kind={kind} label={label} initial={value} onChange={onChange} />);
    this.mounts.add({ host, root });
    return shadow;
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
        const shadow = this.mountChip(el, kind, ctx.key, value, (next) => ctx.onChange(next));
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
    new Setting(containerEl)
      .setName("Color palette")
      .setDesc("Colors the chips and their editors, as the same setting does in Solenoid.")
      .addDropdown((dropdown) => {
        for (const name of paletteStore.names()) dropdown.addOption(name, name);
        dropdown.setValue(paletteStore.activeBase());
        dropdown.onChange((name) => void this.plugin.setPalette(name as PaletteName));
      });
    const preview = containerEl.createDiv({ cls: "solenoid-settings-preview" });
    for (const kind of PROPERTY_KINDS) this.plugin.mountChip(preview, kind, kind.name, previewValue(kind), () => {});
  }
}
