// [[B2]] webTryDesktopFull: the Android app's files are the folders the user grants it in Android's own folder picker
// (docs/android.md § Folders on Android). A path is the folder's tree address and a relative path under it
// (`content://…/tree/<id>/Notes/a.md`); this provider hands each call to `src-tauri/android/SafPlugin.kt`.
import type { FsProvider } from "./fileBridge";

const TREE = /^(content:\/\/[^/]+\/tree\/[^/]+)(?:\/(.*))?$/;

/** A path inside a folder Android granted. */
export function isTreePath(p: string): boolean {
  return TREE.test(p);
}

/** The granted folder as a person names it: `primary:Documents/Vault` reads "Documents/Vault", a card's
 *  `1A2B-3C4D:Data` reads "SD card/Data"; a path under it adds its own parts. */
export function treeLabel(p: string): string {
  const m = TREE.exec(p);
  if (!m) return p;
  const id = decodeURIComponent(m[1].slice(m[1].lastIndexOf("/") + 1));
  const colon = id.indexOf(":");
  const volume = colon >= 0 ? id.slice(0, colon) : "";
  const inner = colon >= 0 ? id.slice(colon + 1) : id;
  const base = volume === "primary" || volume === "" ? inner || "Phone" : `SD card${inner ? `/${inner}` : ""}`;
  return m[2] ? `${base}/${m[2]}` : base;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>("saf", { cmd, args });
}

/** Asks Android for a folder; its tree address, kept across restarts, or null when the user backs out. */
export async function pickTreeFolder(): Promise<string | null> {
  const r = await call<{ uri?: string }>("pickFolder");
  return r.uri ?? null;
}

/** Whether the app still holds the grant this path lives under (the user can revoke it in Android's settings). */
export async function stillGranted(p: string): Promise<boolean> {
  const m = TREE.exec(p);
  if (!m) return false;
  const { uris } = await call<{ uris: string[] }>("grants");
  return uris.includes(m[1]);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Joins a tree address and relative parts with `/`, never through a filesystem join, which would fold `content://`. */
export function joinTree(...parts: string[]): string {
  return parts
    .filter((x) => x !== "")
    .map((x, i) => (i === 0 ? x.replace(/\/+$/, "") : x.replace(/^\/+|\/+$/g, "")))
    .filter((x) => x !== "")
    .join("/");
}

export const treeFs: FsProvider = {
  readTextFile: async (path) => (await call<{ text: string }>("readText", { path })).text,
  readTextHead: async (path, chars) => (await call<{ text: string }>("readText", { path, max: chars })).text,
  readDir: async (path) =>
    (await call<{ entries: { name: string; dir: boolean }[] }>("list", { path })).entries.map((e) => ({
      name: e.name,
      isDirectory: e.dir,
      isFile: !e.dir,
    })),
  writeTextFile: async (path, text) => { await call("writeText", { path, text }); },
  rename: async (from, to) => { await call("rename", { from, to }); },
  mkdir: async (path) => { await call("mkdir", { path }); },
  exists: async (path) => (await call<{ exists: boolean }>("exists", { path })).exists,
  stat: async (path) => ({ mtimeMs: (await call<{ mtime?: number }>("stat", { path })).mtime ?? null, birthtimeMs: null }),
  join: async (...parts) => joinTree(...parts),
  dirname: async (path) => path.slice(0, path.lastIndexOf("/")),
  readBinary: async (path) => fromBase64((await call<{ base64: string }>("readBinary", { path })).base64),
  writeBinary: async (path, bytes) => { await call("writeBinary", { path, base64: toBase64(bytes) }); },
  walk: async (root, depth, folders) => (await call<{ paths: string[] }>("walk", { path: root, depth, folders })).paths,
};
