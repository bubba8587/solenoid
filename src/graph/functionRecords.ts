// [[C140]] functionRecords
// A function's record opened in the Cube popup, read-only. The records load only when one is opened.
import { recordsToCube } from "./frame";
import { cubePopup } from "./cubePopupStore";

const FILES = import.meta.glob<string>("../../fixtures/functions/*.json", { query: "?raw", import: "default" });

const RECORDS = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(FILES)) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  if (name !== "harvest") RECORDS.set(name, load);
}

export const hasFunctionRecord = (name: string): boolean => RECORDS.has(name.toUpperCase());

export async function openFunctionRecord(name: string): Promise<void> {
  const load = RECORDS.get(name.toUpperCase());
  if (!load) return;
  const groups = JSON.parse(await load()) as Array<Record<string, unknown>>;
  cubePopup.open({ kind: "cube", label: name.toUpperCase(), cube: recordsToCube(groups) });
}
