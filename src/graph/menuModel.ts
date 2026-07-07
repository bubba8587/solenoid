// The application menu model — ONE source of truth for the MenuBar dropdowns AND
// the Command Palette. Every menubar action is therefore a palette command by
// construction (add an item here and it shows up in both). `buildMenus()` reads the
// current dynamic state (theme/lock/snap/calc mode) from the stores each call, so the
// caller just re-renders on the relevant store change to pick up checkmarks/labels.
import { appThemeStore } from "./appTheme";
import { canvasLockStore } from "./canvasLock";
import { frStore } from "./frStore";
import { shortcutsStore } from "./shortcutsStore";
import { outlineSearch } from "./outlineStore";
import { autoArrange, cleanup, requestRecalc } from "./process";
import { calcModeStore } from "./calcModeStore";
import { refreshAllConnections } from "./connectionStore";
import { runModelFuzz } from "./modelFuzz";
import { problemsPanelUi } from "./problemsStore";
import { pushNotice } from "./noticeStore";
import { saveToDisk, openFromDisk } from "./fileSession";
import { documentStore } from "./documentStore";
import { addMenuRequest } from "./addMenuStore";
import { connectionDialog } from "./connectionDialogStore";
import { settingsPanel, settingsStore } from "./settingsStore";
import { pickFolderDialog, openInFileManager, isDesktop } from "./fileBridge";
import { docPropertiesPanel } from "./docMetaStore";
import { helpDialogStore } from "./helpDialogStore";
import { gridSnapStore } from "./gridSnapStore";
import { APP_LOCALE } from "./locale";

export type MenuItem =
  | { sep: true }
  | { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; checked?: boolean };
export type Menu = { label: string; items: MenuItem[] };

// Dispatch a synthetic keydown so the Canvas keyboard handler runs the real command
// (it listens on window). Reuses all the existing edit/graph shortcut logic.
export function fireMenuKey(code: string, opts: { key?: string; ctrl?: boolean; shift?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code,
      key: opts.key ?? "",
      ctrlKey: !!opts.ctrl,
      shiftKey: !!opts.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function buildMenus(): Menu[] {
  const mode = appThemeStore.getMode();
  const locked = canvasLockStore.get();
  const snap = gridSnapStore.get();
  const calcMode = calcModeStore.mode();

  return [
    {
      label: "File",
      items: [
        { label: "New blank document", onClick: () => void documentStore.newBlank() },
        { label: "Open…", shortcut: "Ctrl+O", onClick: () => void openFromDisk() },
        { sep: true },
        // Work autosaves to the in-app document continuously; Save writes the
        // graph out to its .json file (prompting for one the first time).
        { label: "Save", shortcut: "Ctrl+S", onClick: () => void saveToDisk() },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", onClick: () => void saveToDisk({ forceDialog: true }) },
        { sep: true },
        { label: "Document properties…", onClick: () => docPropertiesPanel.open() },
        { sep: true },
        // A genuine reload of the current document (full rebuild from the saved
        // graph), which replays the cinematic load reveal — a browser refresh
        // doesn't. A deliberate combo, not a stray single key.
        { label: "Reload document", shortcut: "Ctrl+Shift+L", onClick: () => void documentStore.reloadCurrent() },
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
        { label: "Undo", shortcut: "Ctrl+Z", onClick: () => fireMenuKey("KeyZ", { ctrl: true }) },
        { label: "Redo", shortcut: "Ctrl+Shift+Z", onClick: () => fireMenuKey("KeyZ", { ctrl: true, shift: true }) },
        { sep: true },
        { label: "Copy", shortcut: "Ctrl+C", onClick: () => fireMenuKey("KeyC", { ctrl: true }) },
        { label: "Paste", shortcut: "Ctrl+V", onClick: () => fireMenuKey("KeyV", { ctrl: true }) },
        { label: "Delete", shortcut: "Del", onClick: () => fireMenuKey("Delete", { key: "Delete" }) },
        { sep: true },
        { label: "Select all", shortcut: "Ctrl+A", onClick: () => fireMenuKey("KeyA", { ctrl: true }) },
        { label: "Group selection", shortcut: "G", onClick: () => fireMenuKey("KeyG") },
        { label: "Make composite", shortcut: "Ctrl+Shift+G", onClick: () => fireMenuKey("KeyG", { ctrl: true, shift: true }) },
        { label: "Autofit group box", shortcut: "F", onClick: () => fireMenuKey("KeyF") },
        { sep: true },
        { label: "Find node…", shortcut: "Ctrl+F", onClick: () => outlineSearch.open() },
      ],
    },
    {
      label: "View",
      items: [
        { label: mode === "dark" ? "Light theme" : "Dark theme", onClick: () => appThemeStore.toggleMode() },
        { label: "Lock canvas", checked: locked, onClick: () => canvasLockStore.toggle() },
        { sep: true },
        { label: "Tidy (auto-arrange)", shortcut: "T", onClick: () => autoArrange() },
        { label: "Cleanup (tidy + collapse + fit)", shortcut: "C", onClick: () => cleanup() },
        { label: "Snap to grid", checked: snap, onClick: () => gridSnapStore.toggle() },
        { sep: true },
        { label: "Function reference", shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Settings…", shortcut: "Ctrl+,", onClick: () => settingsPanel.open() },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Add node…", shortcut: "A", onClick: () => addMenuRequest.open(window.innerWidth / 2, 140) },
        { label: "Add connection…", onClick: () => connectionDialog.open() },
      ],
    },
    {
      label: "Data",
      items: [
        { label: "Refresh all connections", onClick: () => void refreshAllConnections() },
        { sep: true },
        {
          label: "Run model check (fuzz)",
          onClick: () => void (async () => {
            const r = await runModelFuzz();
            problemsPanelUi.setOpen(true);
            pushNotice(
              r.findings > 0
                ? `Model check: ${r.findings} finding${r.findings === 1 ? "" : "s"} across ${r.samples.toLocaleString(APP_LOCALE)} samples — see Problems.`
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
        { label: "Calculate now", shortcut: "F9", onClick: () => void requestRecalc() },
        { sep: true },
        {
          label: "Automatic",
          checked: calcMode === "auto",
          // Switching to Automatic catches up on everything suppressed while manual.
          onClick: () => { if (calcModeStore.setMode("auto")) void requestRecalc(); },
        },
        {
          label: "Manual",
          checked: calcMode === "manual",
          onClick: () => { calcModeStore.setMode("manual"); },
        },
        {
          label: "Sketch (approximate on a sample)",
          checked: calcMode === "sketch",
          // Sketch recomputes live, same as Automatic — catch up on anything
          // suppressed while Manual, same as switching to Automatic does.
          onClick: () => { if (calcModeStore.setMode("sketch")) void requestRecalc(); },
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Function reference", shortcut: "Ctrl+/", onClick: () => frStore.open("reference") },
        { label: "Help", onClick: () => frStore.open("help") },
        { label: "Notes", onClick: () => frStore.open("notes") },
        { sep: true },
        { label: "Keyboard shortcuts…", onClick: () => shortcutsStore.toggle() },
        { sep: true },
        { label: "What's new…", onClick: () => helpDialogStore.openWhatsNew() },
        { label: "About Solenoid", onClick: () => helpDialogStore.openAbout() },
      ],
    },
  ];
}
