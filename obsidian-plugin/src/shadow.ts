// [[C107]] obsidianPlugin
import { themeVars, type ThemeMode } from "../../src/graph/themeVars";
import { DEFAULT_ACCENT } from "./lookTokens";

declare const __SOLENOID_CSS__: string;

let accentSlot: string = DEFAULT_ACCENT;
export function setAccentSlot(slot: string): void {
  accentSlot = slot;
}

const hosts = new Set<HTMLElement>();
const sheetsByDoc = new Map<Document, CSSStyleSheet[]>();
let layer: HTMLElement | null = null;

export let popupDocument: Document = document;
export let popupWindow: typeof window = window;

function tokenBlock(selector: string, mode: ThemeMode): string {
  const lines = Object.entries(themeVars(accentSlot, mode))
    .filter((e): e is [string, string] => e[1] !== null)
    .map(([name, value]) => `${name}:${value};`);
  return `${selector}{${lines.join("")}}`;
}

const tokenCss = (): string =>
  `${tokenBlock(":host", "dark")}${tokenBlock(':host([data-theme="light"])', "light")}` +
  ":host{color:var(--text);color-scheme:dark}:host([data-theme=\"light\"]){color-scheme:light}";

function styleSheets(doc: Document): CSSStyleSheet[] {
  const made = sheetsByDoc.get(doc);
  if (made) return made;
  const Sheet = (doc.defaultView ?? window).CSSStyleSheet;
  const reset = new Sheet();
  reset.replaceSync(":host{all:initial}");
  const app = new Sheet();
  app.replaceSync(__SOLENOID_CSS__);
  const tokens = new Sheet();
  tokens.replaceSync(tokenCss());
  const sheets = [reset, app, tokens];
  sheetsByDoc.set(doc, sheets);
  return sheets;
}

export function refreshTokens(): void {
  const css = tokenCss();
  for (const [doc, sheets] of sheetsByDoc) {
    if (!doc.defaultView) sheetsByDoc.delete(doc);
    else sheets[2].replaceSync(css);
  }
  bumpTheme();
}

let themeTick = 0;
const themeListeners = new Set<() => void>();
function bumpTheme(): void {
  themeTick++;
  for (const listener of themeListeners) listener();
}
export const themeVersion = {
  subscribe: (listener: () => void): (() => void) => {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  },
  get: (): number => themeTick,
};

export function tokenHex(name: string): string | undefined {
  return themeVars(accentSlot, obsidianMode())[name] ?? undefined;
}

function obsidianMode(): ThemeMode {
  return document.body.classList.contains("theme-light") ? "light" : "dark";
}

export function createShadowHost(tag: "span" | "div", className: string, doc: Document = document): { host: HTMLElement; root: ShadowRoot } {
  // The window's own createEl: a host made in another document loses its sheets when it moves.
  const host = (doc.win as typeof window).createEl(tag);
  host.className = className;
  host.dataset.theme = obsidianMode();
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = styleSheets(doc);
  hosts.add(host);
  return { host, root };
}

export function adoptSheets(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (!root) return;
  const sheets = styleSheets(host.ownerDocument);
  if (root.adoptedStyleSheets[0] !== sheets[0]) root.adoptedStyleSheets = sheets;
}

export function releaseShadowHost(host: HTMLElement): void {
  hosts.delete(host);
}

export function syncTheme(): void {
  const mode = obsidianMode();
  for (const host of hosts) {
    if (!host.isConnected && host !== layer) hosts.delete(host);
    else host.dataset.theme = mode;
  }
  bumpTheme();
}

const PANE_CSS =
  ".sol-popup-overlay{padding-left:calc(10px + var(--sol-pane-left,0px));padding-right:calc(10px + var(--sol-pane-right,0px))}" +
  ".table-popup{width:min(1100px,calc(var(--sol-pane-width,100vw)*0.94))}";

function popupLayer(): ShadowRoot {
  if (!layer) {
    const made = createShadowHost("div", "solenoid-popup-layer", popupDocument);
    layer = made.host;
    const paneSheet = new popupWindow.CSSStyleSheet();
    paneSheet.replaceSync(PANE_CSS);
    made.root.adoptedStyleSheets = [...made.root.adoptedStyleSheets, paneSheet];
    made.root.append(popupWindow.createDiv(), popupWindow.createDiv());
    popupDocument.body.appendChild(layer);
    popupWindow.addEventListener("resize", placeOverPane);
  }
  return layer.shadowRoot!;
}

function dropLayer(): void {
  if (!layer) return;
  popupWindow.removeEventListener("resize", placeOverPane);
  releaseShadowHost(layer);
  layer.remove();
  layer = null;
}

/** True when the layer moved or its window closed: the caller renders the popups again, since the old React root went with the old layer. */
export function homePopupLayer(doc: Document): boolean {
  const gone = layer !== null && !layer.isConnected;
  if (popupDocument === doc && !gone) return false;
  dropLayer();
  popupDocument = doc;
  popupWindow = doc.defaultView ?? window;
  return true;
}

let pane: HTMLElement | null = null;
function placeOverPane(): void {
  if (!layer) return;
  const rect = pane?.isConnected ? pane.getBoundingClientRect() : null;
  for (const [name, px] of [
    ["--sol-pane-left", rect ? rect.left : 0],
    ["--sol-pane-right", rect ? popupWindow.innerWidth - rect.right : 0],
    ["--sol-pane-width", rect ? rect.width : popupWindow.innerWidth],
  ] as const) layer.style.setProperty(name, `${px}px`);
}

/** Null measures the window. */
export function openPopupsOver(el: HTMLElement | null): void {
  pane = el;
  popupLayer();
  placeOverPane();
}

export function popupLayerRoot(): HTMLElement {
  return popupLayer().children[0] as HTMLElement;
}

export function popupPortalRoot(): HTMLElement {
  return popupLayer().children[1] as HTMLElement;
}

export function removePopupLayer(): void {
  dropLayer();
  pane = null;
  sheetsByDoc.clear();
  popupDocument = document;
  popupWindow = window;
}
