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
  answer: (rel: string | null) => void;
}

export const filePicker = createValueStore<FilePickerState>();
