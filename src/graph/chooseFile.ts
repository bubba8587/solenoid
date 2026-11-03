// [[B2]] webTryDesktopFull: the desktop app asks the operating system; the web, and the demo vault on any platform, pick
// from the app's own list (`FilePicker.tsx`). Either way the answer is relative to the root it was asked under.
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktop } from "./fileBridge";
import { isDemoVaultPath } from "./demoVault";
import { filePicker } from "./filePickerStore";
import { pushNotice } from "./noticeStore";

export interface ChooseOptions {
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
  if (isDesktop() && o.root.trim() && !isDemoVaultPath(o.root) && !o.blocked) {
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
      answer: (rel) => { filePicker.close(); resolve(rel); },
    });
  });
}
