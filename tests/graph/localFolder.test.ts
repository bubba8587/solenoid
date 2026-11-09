// [[D126]] folderAsOneTable
import { describe, it, expect, afterEach } from "vitest";
import { matchFiles, isFilePattern, type DirEntry } from "../../src/graph/fileGlob";
import { setFsProvider, type FsProvider } from "../../src/graph/fileBridge";
import { settingsStore } from "../../src/graph/settingsStore";
import { connectionStore } from "../../src/graph/connectionStore";
import { LocalFileNode } from "../../src/graph/nodes/connection";
import type { FrameValue } from "../../src/graph/frame";

const TREE: Record<string, string> = {
  "accounts.csv": "Id\n1\n",
  "monthly/2026-2.csv": "Day,Region,Amount\n2026-02-03,East,150\n",
  "monthly/2026-10.csv": "Day,Region,Amount,Rep\n2026-10-02,North,210,Ada\n",
  "monthly/notes.txt": "not data",
  "monthly/old/2025-12.csv": "Day,Region,Amount\n2025-12-30,South,5\n",
  "monthly/.cache/2026-2.csv": "Day\n2020-01-01\n",
};

/** One folder's entries, by its path relative to the tree's root. */
async function readDir(rel: string): Promise<DirEntry[]> {
  const prefix = rel === "" ? "" : `${rel}/`;
  const names = new Map<string, boolean>();
  for (const key of Object.keys(TREE)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf("/");
    names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
  }
  return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }));
}

describe("a file pattern", () => {
  it("is a name with a wildcard", () => {
    expect([isFilePattern("monthly/*.csv"), isFilePattern("q?.csv"), isFilePattern("orders.csv")]).toEqual([true, true, false]);
  });

  it("takes the files of one folder, digits in number order, case ignored", async () => {
    expect(await matchFiles("monthly/*.CSV", readDir)).toEqual(["monthly/2026-2.csv", "monthly/2026-10.csv"]);
    expect(await matchFiles("*.csv", readDir)).toEqual(["accounts.csv"]);
    expect(await matchFiles("monthly/2026-1?.csv", readDir)).toEqual(["monthly/2026-10.csv"]);
  });

  it("looks through subfolders only under **/, and never into a hidden folder", async () => {
    expect(await matchFiles("monthly/**/*.csv", readDir)).toEqual(["monthly/2026-2.csv", "monthly/2026-10.csv", "monthly/old/2025-12.csv"]);
    expect(await matchFiles("**/*.csv", readDir)).toHaveLength(4);
    expect(await matchFiles("nowhere/*.csv", readDir)).toEqual([]);
  });
});

describe("Local File over a pattern", () => {
  const ROOT = "/data";
  const provider = {
    readTextFile: async (p: string) => {
      const rel = p.slice(ROOT.length + 1);
      if (rel === "monthly/old/2025-12.csv") throw new Error("locked by another program");
      if (!(rel in TREE)) throw new Error(`no such file ${rel}`);
      return TREE[rel];
    },
    readDir: (p: string) => readDir(p === ROOT ? "" : p.slice(ROOT.length + 1)),
    join: async (...parts: string[]) => parts.join("/"),
  } as unknown as FsProvider;

  afterEach(() => { setFsProvider(null); settingsStore.set("csvFolder", ""); });

  const read = async (fileName: string) => {
    setFsProvider(provider);
    settingsStore.set("csvFolder", ROOT);
    const node = new LocalFileNode({ fileName });
    return { node, out: await node.data() };
  };

  it("stacks every matching file into one table with a File column, columns meeting by name", async () => {
    const { node, out } = await read("monthly/*.csv");
    const frame = out.frame as FrameValue;
    expect(frame.columns.map((c) => c.name)).toEqual(["File", "Day", "Region", "Amount", "Rep"]);
    expect(frame.columns[0].values).toEqual(["monthly/2026-2.csv", "monthly/2026-10.csv"]);
    expect(frame.columns[3].values).toEqual([150, 210]);
    expect(frame.columns[4].values).toEqual([null, "Ada"]);
    expect(connectionStore.getState(node.id)).toMatchObject({ status: "ok", files: 2, rows: 2, cols: 5 });
    expect(out.plan).toBeNull();
  });

  it("names a file that didn't read and still loads the rest", async () => {
    const { node, out } = await read("monthly/**/*.csv");
    expect((out.frame as FrameValue).columns[0].values).toEqual(["monthly/2026-2.csv", "monthly/2026-10.csv"]);
    const state = connectionStore.getState(node.id);
    expect(state.files).toBe(2);
    expect(state.message).toBe("1 didn't read: monthly/old/2025-12.csv (locked by another program)");
  });

  it("says when nothing matches", async () => {
    const { node, out } = await read("monthly/*.parquetx");
    expect(out.frame).toBeNull();
    expect(connectionStore.getState(node.id)).toMatchObject({ status: "error", message: "No CSV or Parquet file matches monthly/*.parquetx" });
  });
});
