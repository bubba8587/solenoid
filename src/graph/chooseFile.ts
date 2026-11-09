// [[B2]] webTryDesktopFull: the desktop app asks the operating system; the web, Android, and the demo vault on any
// platform, pick from the app's own list (`FilePicker.tsx`). Either way the answer is relative to the root it was asked under.
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktop, isAndroidApp } from "./fileBridge";
import { isDemoVaultPath } from "./demoVault";
import { filePicker } from "./filePickerStore";
import { pushNotice } from "./noticeStore";
import { readChipPopupStyle } from "./components/chipStyle";

interface ChooseOptions {
  title: string;
  /** The folder the answer must sit in, and the dialog opens at. */
  root: string;
  kind?: "file" | "folder";
  /** File mode: the extensions offered, without dots. */
  extensions?: string[];
  /** The current answer, relative to the root. */
  current?: string;
  /** The app's list, relative paths: what the web and the demo vault pick from. */
  list: () => Promise<string[]>;
  empty?: string;
  rootLabel?: string;
  blocked?: string;
  readHead?: (rel: string, chars: number) => Promise<string>;
  stat?: (rel: string) => Promise<{ mtimeMs: number | null } | null>;
  recentKey?: string;
  /** The field that asked: the popup takes its card's accent. */
  from?: HTMLElement;
  files?: () => Promise<string[]>;
  /** Folder mode as Save As: the answer is the folder and this name (`FilePickerState.save`). */
  save?: { name: string; extension: string };
}

const slashed = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** `path` relative to `root`, `""` for the root itself, null outside it. Windows paths compare without case. */
export function relativeTo(root: string, path: string): string | null {
  const r = slashed(root), p = slashed(path);
  const fold = /^[a-z]:/i.test(r) ? (s: string) => s.toLowerCase() : (s: string) => s;
  if (fold(p) === fold(r)) return "";
  return fold(p).startsWith(fold(r) + "/") ? p.slice(r.length + 1) : null;
}

/** Asks for a file or folder under `root`: the relative answer, or null when cancelled. */
export async function chooseFile(o: ChooseOptions): Promise<string | null> {
  const kind = o.kind ?? "file";
  // On Android the system picker answers with a content:// address the file calls can't read, so the app lists.
  if (isDesktop() && !isAndroidApp() && o.root.trim() && !isDemoVaultPath(o.root) && !o.blocked) {
    const res = await open({
      title: o.title,
      directory: kind === "folder",
      multiple: false,
      defaultPath: o.current ? `${slashed(o.root)}/${o.current}` : o.root,
      ...(kind === "file" && o.extensions?.length ? { filters: [{ name: o.extensions.join(", "), extensions: o.extensions }] } : {}),
    });
    if (typeof res !== "string") return null;
    const rel = relativeTo(o.root, res);
    if (rel === null) pushNotice(`Pick a ${kind} inside ${o.root}`, "warn");
    return rel;
  }
  return new Promise((resolve) => {
    filePicker.get()?.answer(null);
    filePicker.open({
      title: o.title,
      kind,
      load: o.list,
      current: o.current,
      rootLabel: o.rootLabel,
      empty: o.empty ?? (kind === "folder" ? "No folders" : "No files"),
      blocked: o.blocked,
      readHead: o.readHead,
      listKey: `${kind}|${o.root}|${(o.extensions ?? []).join(",")}`,
      stat: o.stat,
      recentKey: o.recentKey,
      files: o.files,
      save: o.save,
      ...(o.from ? readChipPopupStyle(o.from) : {}),
      answer: (rel) => { filePicker.close(); resolve(rel); },
    });
  });
}
