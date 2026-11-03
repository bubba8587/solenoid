// [[A1]] visualGraphCalculator (module-singleton store, storeKit), [[C106]] noNativeDialogs
import { createValueStore } from "./storeKit";

/** The open file picker (`FilePicker.tsx`): what it lists, under which root, and who hears the answer. */
export interface FilePickerState {
  title: string;
  kind: "file" | "folder";
  /** Paths relative to the root, `/`-separated. */
  load: () => Promise<string[]>;
  current?: string;
  /** Folder mode: the label of the root itself, offered first as `""`. */
  rootLabel?: string;
  empty: string;
  /** A note the list can't be read (no folder set, the web without the demo vault); shown in place of the list. */
  blocked?: string;
  /** A file's first `chars` characters, for the preview pane: a big file is never read whole. */
  readHead?: (rel: string, chars: number) => Promise<string>;
  /** Where this listing is kept for the session (`filePickerModel.ts` `listed`). */
  listKey: string;
  /** When a path last changed, for the preview pane. */
  stat?: (rel: string) => Promise<{ mtimeMs: number | null } | null>;
  /** Where the recent picks of this kind of pick are remembered (`filePickerModel.ts`). */
  recentKey?: string;
  /** Folder mode: every file beneath the root, so a folder's preview shows what it holds. */
  files?: () => Promise<string[]>;
  answer: (rel: string | null) => void;
}

export const filePicker = createValueStore<FilePickerState>();
