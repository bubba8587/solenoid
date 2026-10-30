// [[C98]] paletteMirrorsMenubar (the one menu model)
// One source for the MenuBar and the Command Palette, so every menubar action is a palette command by construction.
import { appThemeStore } from "./appTheme";
import { canvasLockStore } from "./canvasLock";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { outlineSearch } from "./outlineStore";
import { requestRecalc } from "./process";
import { calcModeStore } from "./calcModeStore";
import { refreshAllConnections } from "./connectionStore";
import { runModelFuzz } from "./modelFuzz";
import { problemsPanelUi } from "./problemsStore";
import { pushNotice } from "./noticeStore";
import { saveToDisk, openFromDisk } from "./fileSession";
import { documentStore } from "./documentStore";
import { inspectorStore } from "./inspectorStore";
import { addMenuRequest } from "./addMenuStore";
import { connectionDialog } from "./connectionDialogStore";
import { settingsPanel, settingsStore } from "./settingsStore";
import { pickFolderDialog, openInFileManager, openExternal, isDesktop } from "./fileBridge";
import { docPropertiesPanel } from "./docMetaStore";
import { helpDialogStore } from "./helpDialogStore";
import { gridSnapStore } from "./gridSnapStore";
import { APP_LOCALE } from "./locale";
import { drawModeStore } from "./drawnCables";
import { SITE_ORIGIN, SITE_PAGES } from "./landing/siteMeta";

// Desktop has no address bar, so this is the only way to the site; on web the current origin serves the same route.
const HOSTED_SITE = SITE_ORIGIN;
function openWebsite(): void {
  const onOrigin = /^https?:$/.test(window.location.protocol);
  void openExternal(isDesktop() || !onOrigin ? `${HOSTED_SITE}${SITE_PAGES.about.path}` : `${window.location.origin}${SITE_PAGES.about.path}`);
}

/** Read only by the phone sheet (`MobileMenuSheet.tsx`): `icon` and `short`, `inHeading` for a command that rides in its
 *  section's heading as a button, a separator's `label` captioning the group after it, and `hideOnPhone` for a command
 *  the phone's own chrome already carries on screen. */
export type MenuIcon =
  | "new" | "open" | "save" | "saveAs" | "copy" | "paste" | "toFront" | "forward" | "backward" | "toBack"
  | "refresh" | "recalc" | "draw" | "find" | "inspector" | "problems" | "reference" | "external";
export type MenuItem =
  | { sep: true; label?: string }
  | { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; checked?: boolean; icon?: MenuIcon; short?: string; inHeading?: true; hideOnPhone?: true };
export type Menu = { label: string; items: MenuItem[] };

/** Presses a canvas key as a real keyboard would: down on the document, where React Flow's Delete listens (the event
 *  bubbles on to the canvas keyboard on window), and up a task later. Without the release RF's key trackers keep the
 *  synthetic key as held, and a later Ctrl-click no longer multi-selects. */
export function fireMenuKey(code: string, opts: { key?: string; ctrl?: boolean; shift?: boolean } = {}) {
  const init = { code, key: opts.key ?? "", ctrlKey: !!opts.ctrl, shiftKey: !!opts.shift, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", init));
  setTimeout(() => document.dispatchEvent(new KeyboardEvent("keyup", init)), 0);
}

export function buildMenus(): Menu[] {
  const mode = appThemeStore.getMode();
  const locked = canvasLockStore.get();
  const snap = gridSnapStore.get();
  const calcMode = calcModeStore.mode();
  const drawArmed = drawModeStore.armed();

  return [
    {
      label: "File",
      items: [
        { label: "New Document", icon: "new", short: "New", onClick: () => void documentStore.newBlank() },
        { label: "Open…", icon: "open", short: "Open", shortcut: "Ctrl+O", onClick: () => void openFromDisk() },
        { sep: true },
        { label: "Save", icon: "save", short: "Save", shortcut: "Ctrl+S", onClick: () => void saveToDisk() },
        { label: "Save As…", icon: "saveAs", short: "Save As", shortcut: "Ctrl+Shift+S", onClick: () => void saveToDisk({ forceDialog: true }) },
        { sep: true },
        { label: "Document properties…", onClick: () => docPropertiesPanel.open() },
        { sep: true },
        { label: "Reload document", icon: "refresh", short: "Reload", inHeading: true, shortcut: "Ctrl+Shift+L", onClick: () => void documentStore.reloadCurrent() },
        ...(isDesktop() ? ([{ sep: true }, {
          label: "Open documents folder",
          onClick: () => void (async () => {
            let folder = settingsStore.get("docsFolder");
            if (!folder) {
              const picked = await pickFolderDialog();
              if (!picked) return;
              settingsStore.set("docsFolder", picked);
              folder = picked;
            }
            void openInFileManager(folder);
          })(),
        }] as MenuItem[]) : []),
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", hideOnPhone: true, shortcut: "Ctrl+Z", onClick: () => fireMenuKey("KeyZ", { ctrl: true }) },
        { label: "Redo", hideOnPhone: true, shortcut: "Ctrl+Shift+Z", onClick: () => fireMenuKey("KeyZ", { ctrl: true, shift: true }) },
        { sep: true, label: "Clipboard" },
        { label: "Copy", icon: "copy", shortcut: "Ctrl+C", onClick: () => fireMenuKey("KeyC", { ctrl: true }) },
        { label: "Paste", icon: "paste", shortcut: "Ctrl+V", onClick: () => fireMenuKey("KeyV", { ctrl: true }) },
        { label: "Delete", hideOnPhone: true, shortcut: "Del", onClick: () => fireMenuKey("Delete", { key: "Delete" }) },
        { sep: true },
        { label: "Select all", shortcut: "Ctrl+A", onClick: () => fireMenuKey("KeyA", { ctrl: true }) },
        { label: "Group selection", hideOnPhone: true, shortcut: "G", onClick: () => fireMenuKey("KeyG") },
        { label: "Wrap as Composite", shortcut: "Ctrl+Shift+G", onClick: () => fireMenuKey("KeyG", { ctrl: true, shift: true }) },
        { label: "Group Autofit", shortcut: "F", onClick: () => fireMenuKey("KeyF") },
        { sep: true, label: "Arrange" },
        { label: "Bring to front", icon: "toFront", shortcut: "Ctrl+Shift+]", onClick: () => fireMenuKey("BracketRight", { ctrl: true, shift: true }) },
        { label: "Bring forward", icon: "forward", shortcut: "Ctrl+]", onClick: () => fireMenuKey("BracketRight", { ctrl: true }) },
        { label: "Send backward", icon: "backward", shortcut: "Ctrl+[", onClick: () => fireMenuKey("BracketLeft", { ctrl: true }) },
        { label: "Send to back", icon: "toBack", shortcut: "Ctrl+Shift+[", onClick: () => fireMenuKey("BracketLeft", { ctrl: true, shift: true }) },
        { sep: true },
        { label: "Find", icon: "find", shortcut: "Ctrl+F", onClick: () => outlineSearch.open() },
      ],
    },
    {
      label: "View",
      items: [
        { label: mode === "dark" ? "Light theme" : "Dark theme", hideOnPhone: true, onClick: () => appThemeStore.toggleMode() },
        { label: "Lock canvas", hideOnPhone: true, checked: locked, onClick: () => canvasLockStore.toggle() },
        { sep: true },
        { label: "Tidy", hideOnPhone: true, shortcut: "T", onClick: () => fireMenuKey("KeyT") },
        { label: "Cleanup", hideOnPhone: true, shortcut: "C", onClick: () => fireMenuKey("KeyC") },
        { label: "Snap to grid", hideOnPhone: true, checked: snap, onClick: () => gridSnapStore.toggle() },
        { sep: true },
        { label: "Function reference", hideOnPhone: true, shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Inspector", icon: "inspector", onClick: () => inspectorStore.toggle() },
        { label: "Settings…", hideOnPhone: true, shortcut: "Ctrl+,", onClick: () => settingsPanel.open() },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Add node…", hideOnPhone: true, shortcut: "A", onClick: () => addMenuRequest.open(window.innerWidth / 2, 140) },
        { label: "Add connection…", onClick: () => connectionDialog.open() },
        { sep: true },
        {
          label: "Draw a cable",
          icon: "draw",
          short: "Draw Cable",
          inHeading: true,
          checked: drawArmed,
          onClick: () => drawModeStore.toggle(),
        },
      ],
    },
    {
      label: "Data",
      items: [
        { label: "Refresh all connections", icon: "refresh", short: "Refresh", inHeading: true, onClick: () => void refreshAllConnections() },
        { sep: true },
        {
          label: "Run model check",
          icon: "problems",
          onClick: () => void (async () => {
            const r = await runModelFuzz();
            problemsPanelUi.setOpen(true);
            pushNotice(
              r.findings > 0
                ? `Model check: ${r.findings} finding${r.findings === 1 ? "" : "s"} across ${r.samples.toLocaleString(APP_LOCALE)} samples. See Problems.`
                : `Model check: no problems found across ${r.samples.toLocaleString(APP_LOCALE)} samples.`,
              r.findings > 0 ? "warn" : "info",
            );
          })(),
        },
      ],
    },
    {
      label: "Calculate",
      items: [
        { label: "Calculate now", icon: "recalc", short: "Recalculate", inHeading: true, shortcut: "F9", onClick: () => void requestRecalc() },
        { sep: true, label: "Mode" },
        {
          label: "Automatic",
          checked: calcMode === "auto",
          // Catches up on everything suppressed while manual.
          onClick: () => { if (calcModeStore.setMode("auto")) void requestRecalc(); },
        },
        {
          label: "Manual",
          checked: calcMode === "manual",
          onClick: () => { calcModeStore.setMode("manual"); },
        },
        {
          label: "Sketch",
          checked: calcMode === "sketch",
          // Sketch recomputes live, so it catches up like Automatic.
          onClick: () => { if (calcModeStore.setMode("sketch")) void requestRecalc(); },
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Function reference", icon: "reference", shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Help", onClick: () => frStore.open("help") },
        { label: "Notes", onClick: () => frStore.open("notes") },
        { sep: true },
        { label: "Keyboard shortcuts…", hideOnPhone: true, onClick: () => shortcutsStore.toggle() },
        { sep: true },
        { label: "Solenoid website", icon: "external", onClick: openWebsite },
        { label: "What's new…", onClick: () => helpDialogStore.openWhatsNew() },
        { label: "About Solenoid", onClick: () => helpDialogStore.openAbout() },
      ],
    },
  ];
}
