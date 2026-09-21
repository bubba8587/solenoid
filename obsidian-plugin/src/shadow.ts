// [[C107]] obsidianPlugin
import { themeVars, type ThemeMode } from "../../src/graph/themeVars";

/** The app's component CSS, `:root` rewritten to `:host`; filled in by the build. */
declare const __SOLENOID_CSS__: string;

const ACCENT_SLOT = "gold";

const hosts = new Set<HTMLElement>();
// One set of sheets PER DOCUMENT: Obsidian's settings and its popout notes are windows of their
// own, and a constructed stylesheet can only be adopted in the document that made it.
const sheetsByDoc = new Map<Document, CSSStyleSheet[]>();
let layer: HTMLElement | null = null;

/** The document and window the ONE popup layer lives in: the main window's, or a popped-out
 *  note's. The build points every free `document` / `window` in the app's components here
 *  (`popupGlobals` in vite.config.ts), so a popup listens, measures and portals in its own window. */
export let popupDocument: Document = document;
export let popupWindow: typeof window = window;

function tokenBlock(selector: string, mode: ThemeMode): string {
  const lines = Object.entries(themeVars(ACCENT_SLOT, mode))
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
  // Obsidian's inherited text styles stop at the host; the app's own follow.
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

/** Rewrite the palette-derived tokens; a document's sheet is shared, so every host retints at once. */
export function refreshTokens(): void {
  const css = tokenCss();
  for (const [doc, sheets] of sheetsByDoc) {
    if (!doc.defaultView) sheetsByDoc.delete(doc); // a closed window
    else sheets[2].replaceSync(css);
  }
  bumpTheme();
}

// A popup's ink and light-mode border derive from a HEX, so a chip resolves its type color
// here and re-renders when the palette or Obsidian's mode moves.
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

/** A token's value (`--sock-strlist`) under the current palette and Obsidian mode. */
export function tokenHex(name: string): string | undefined {
  return themeVars(ACCENT_SLOT, obsidianMode())[name] ?? undefined;
}

function obsidianMode(): ThemeMode {
  return document.body.classList.contains("theme-light") ? "light" : "dark";
}

/** A host element, made in `doc`, whose shadow root carries the app's styles and tokens. */
export function createShadowHost(tag: "span" | "div", className: string, doc: Document = document): { host: HTMLElement; root: ShadowRoot } {
  // The window's own `createEl`: a host made in another document loses its sheets when it moves.
  const host = (doc.win as typeof window).createEl(tag);
  host.className = className;
  host.dataset.theme = obsidianMode();
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = styleSheets(doc);
  hosts.add(host);
  return { host, root };
}

/** Obsidian builds a property row in the main window and may move it into a popped-out one,
 *  and a constructed sheet does not survive the move: adopt the sheets of the document the host
 *  is in NOW. */
export function adoptSheets(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (!root) return;
  const sheets = styleSheets(host.ownerDocument);
  if (root.adoptedStyleSheets[0] !== sheets[0]) root.adoptedStyleSheets = sheets;
}

export function releaseShadowHost(host: HTMLElement): void {
  hosts.delete(host);
}

/** Obsidian fires `css-change` on a light/dark switch. */
export function syncTheme(): void {
  const mode = obsidianMode();
  for (const host of hosts) {
    if (!host.isConnected && host !== layer) hosts.delete(host);
    else host.dataset.theme = mode;
  }
  bumpTheme();
}

// The overlay still dims the whole window, but the card centers over the note's pane and takes
// its default width from it, where the app measures the viewport.
const PANE_CSS =
  ".sol-popup-overlay{padding-left:calc(10px + var(--sol-pane-left,0px));padding-right:calc(10px + var(--sol-pane-right,0px))}" +
  ".table-popup{width:min(1100px,calc(var(--sol-pane-width,100vw)*0.94))}";

function popupLayer(): ShadowRoot {
  if (!layer) {
    const made = createShadowHost("div", "solenoid-popup-layer", popupDocument);
    layer = made.host;
    // A constructed sheet can only be adopted in the window that made it.
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

/** Move the popup layer to `doc`'s window. True when it moved (or its window had closed): the
 *  caller renders the popups again, since the old React root went with the old layer. */
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

/** The pane the next popup opens over; null measures the window. */
export function openPopupsOver(el: HTMLElement | null): void {
  pane = el;
  popupLayer();
  placeOverPane();
}

/** The one fixed layer the popups render into. */
export function popupLayerRoot(): HTMLElement {
  return popupLayer().children[0] as HTMLElement;
}

/** Where a body-aimed portal (a cell's suggestion list) lands: beside the popups, above them. */
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
