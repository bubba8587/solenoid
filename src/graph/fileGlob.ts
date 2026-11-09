// [[B11]] maximalMerge
// A file name with a wildcard names every file it matches: `*` any run of characters inside one folder, `?` one
// character, `**/` any depth of folders. Matching ignores case, as file pickers do.

export type DirEntry = { name: string; isDirectory: boolean; isFile: boolean };

/** Whether a Local File name is a pattern over many files. */
export function isFilePattern(name: string): boolean {
  return /[*?]/.test(name);
}

function segmentRe(segment: string): RegExp {
  const body = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

/** How many folders deep `**` looks, and how many files one pattern may take: a pattern over a whole drive stops. */
export const GLOB_MAX_DEPTH = 8;
export const GLOB_MAX_FILES = 2000;

/** The files under `root` the pattern names, as paths relative to it with `/` between folders, in name order
 *  (digits by value, so `2` sorts before `10`). `readDir` lists one folder by its relative path ("" is the root). */
export async function matchFiles(pattern: string, readDir: (rel: string) => Promise<DirEntry[]>): Promise<string[]> {
  const segments = pattern.trim().split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  const out: string[] = [];
  const full = () => out.length >= GLOB_MAX_FILES;
  const walk = async (dir: string, at: number, depth: number): Promise<void> => {
    if (full() || at >= segments.length || depth > GLOB_MAX_DEPTH) return;
    const segment = segments[at];
    const last = at === segments.length - 1;
    let entries: DirEntry[];
    try { entries = await readDir(dir); } catch { return; }
    const under = (name: string) => (dir === "" ? name : `${dir}/${name}`);
    if (segment === "**") {
      await walk(dir, at + 1, depth);
      for (const e of entries) if (e.isDirectory && !e.name.startsWith(".")) await walk(under(e.name), at, depth + 1);
      return;
    }
    const re = segmentRe(segment);
    for (const e of entries) {
      if (full()) return;
      if (!re.test(e.name)) continue;
      if (last && e.isFile) out.push(under(e.name));
      else if (!last && e.isDirectory) await walk(under(e.name), at + 1, depth + 1);
    }
  };
  await walk("", 0, 0);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
