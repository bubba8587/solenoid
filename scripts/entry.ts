// Whether the process was started on the script of this name, so a script's own `main` runs when it is launched and
// not when another script or the bundled CLI imports it. The path is followed through a symlink, as npm's bin links
// are, and compared by its file name, since the bundle holds every script in one file.
import { realpathSync } from "node:fs";
import path from "node:path";

export function isEntry(name: string): boolean {
  if (!process.argv[1]) return false;
  let launched = process.argv[1];
  try { launched = realpathSync(launched); } catch { /* a path that no longer resolves is compared as given */ }
  return path.basename(launched).replace(/\.(m?[jt]s)$/, "") === name;
}
