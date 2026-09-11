// Write Properties (bundle 24 item B): a cube of rows → notes' YAML frontmatter, LINE-LEVEL
// (frontmatterPatch, the ONE writer of a note's YAML). Its own file so connection.ts — whose
// Import nodes call a private this.run() fetch helper — stays clear of the sinkRunButtonOnly
// write-API scan. data() only plans; Preview reads + resolves; Run applies behind the Run
// button (armed), gated on hasFs() so the headless `--run` can drive it.
import { ClassicPreset } from "rete";
import { cubeIn, frameOut } from "./shared";
import { planPropertyWrites, propertyPlanFrame, resolveKey, resolveBody, patchFrontmatter, setBody, writableKeys, NOTE_BODY, type PlanRow } from "../frontmatterPatch";
import { buildBaseView, baseRelPath } from "../baseView";
import { formatDateSerial } from "./dateSerial";
import { mdbaseSchemaFor, validateAgainst, parseMdbaseCollection, type MdbaseCollection, type PropConstraint } from "../mdbaseTypes";
import { type Shape } from "../frameShape";
import { settingsStore } from "../settingsStore";
import { hasFs, readVaultFile, writeTextFilePath, joinPath, listMarkdownFiles, readFileText } from "../fileBridge";
import { isCubeValue, type CubeValue, type FrameValue } from "../frame";
import { isSolError, type SolError } from "../errorValue";

export type WritePropertiesStatus = "idle" | "previewing" | "writing" | "ok" | "error";

/** The notes named in a cube (its path + name columns), so a string cell matching one
 *  serializes as a `[[link]]`. */
function noteNamesOf(cube: CubeValue): Set<string> {
  const names = new Set<string>();
  for (const c of cube.columns) {
    if (c.name !== "path" && c.name !== "name") continue;
    for (const cell of c.cells) if (typeof cell === "string" && cell) names.add(cell);
  }
  return names;
}

/** A cube column's Obsidian property-type name (for the .obsidian/types.json registration). */
function obsidianTypeName(cube: CubeValue, key: string): string {
  const col = cube.columns.find((c) => c.name === key);
  if (col && col.cells.some((cell) => Array.isArray(cell))) return "multitext";
  switch (col?.type) {
    case "number":  return "number";
    case "logical": return "checkbox";
    case "date":    return "date";
    default:        return "text";
  }
}

/** Now as a local-wall-clock Excel serial (date + time of day). */
function nowSerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;
}

export class WritePropertiesNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rows: "Wiring rows never writes. The write runs only from the Run button, and the node loads disarmed. Needs a `path` column naming each note; a `note-body` column writes each note's body, every other column its frontmatter.",
    plan: "One row per note × property: path, key, the note's current value, the value to write, and the action. Preview reads the notes to resolve add / update / unchanged / refused.",
  };
  label: string;
  /** The one vault, from the app-wide setting (singleVaultFromSetting). */
  private get vault(): string { return settingsStore.get("obsidianVault"); }
  /** Columns to write, comma-separated; "" = every writable column present. */
  stringLiterals: Record<string, string> = { keys: "" };
  /** Append + register a key the note doesn't have yet. */
  addMissing = true;
  /** Also write a `<node>.base` beside the notes (a live Bases table over what B wrote). */
  writeBase = false;
  /** Never persisted (sinkRunButtonOnly) — always false on a fresh construction. */
  enabled = false;
  cachedCube: CubeValue | SolError | null = null;
  cachedPlan: FrameValue | SolError | null = null;
  private planRows: PlanRow[] = [];
  status: WritePropertiesStatus = "idle";
  statusMessage = "";
  width = 262; height = 250;

  frameShape(): Shape {
    return { columns: [
      { name: "path", type: "string" }, { name: "key", type: "string" },
      { name: "before", type: "string" }, { name: "after", type: "string" }, { name: "action", type: "string" },
    ] };
  }

  constructor(init?: { label?: string; addMissing?: boolean; writeBase?: boolean }) {
    super("WriteProperties");
    this.label = init?.label ?? "Write Properties";
    if (init?.addMissing === false) this.addMissing = false;
    if (init?.writeBase) this.writeBase = true;
    this.addInput("rows", cubeIn("Rows"));
    this.addOutput("plan", frameOut("Plan"));
  }

  // Caches + plans only; never touches disk.
  data(inputs: { rows?: (CubeValue | SolError | null)[] }): { plan: FrameValue | SolError | null } {
    const raw = inputs.rows?.[0] ?? null;
    if (raw === this.cachedCube) return { plan: this.cachedPlan }; // unchanged — keep Preview's resolutions
    this.cachedCube = raw;
    if (isSolError(raw)) { this.cachedPlan = raw; this.planRows = []; return { plan: raw }; }
    if (!isCubeValue(raw)) { this.cachedPlan = null; this.planRows = []; return { plan: null }; }
    this.planRows = planPropertyWrites(raw, this.stringLiterals.keys ?? "", noteNamesOf(raw));
    this.cachedPlan = propertyPlanFrame(this.planRows);
    return { plan: this.cachedPlan };
  }

  private byPath(): Map<string, PlanRow[]> {
    const m = new Map<string, PlanRow[]>();
    for (const r of this.planRows) {
      const list = m.get(r.path) ?? [];
      list.push(r);
      m.set(r.path, list);
    }
    return m;
  }

  // ── mdbase validation: a row that violates the note's schema is REFUSED, not written ──
  private _mdbaseCache = new Map<string, MdbaseCollection | null>();

  private async loadCollection(folder: string): Promise<MdbaseCollection | null> {
    try {
      const yaml = await readVaultFile(this.vault, folder ? `${folder}/mdbase.yaml` : "mdbase.yaml");
      let types: string[] = [];
      try {
        const typesDir = folder ? await joinPath(this.vault, ...folder.split("/"), "_types") : await joinPath(this.vault, "_types");
        const names = await listMarkdownFiles(typesDir);
        types = await Promise.all(names.map((n) => readFileText(typesDir, n)));
      } catch { types = []; }
      return parseMdbaseCollection(yaml, types);
    } catch {
      return null;
    }
  }

  /** The mdbase schema governing a note, walking up its folders for `mdbase.yaml`. */
  private async schemaFor(relPath: string): Promise<{ constraints: Record<string, PropConstraint>; required: string[] } | null> {
    const parts = relPath.split("/");
    parts.pop();
    for (let i = parts.length; i >= 0; i--) {
      const folder = parts.slice(0, i).join("/");
      if (!this._mdbaseCache.has(folder)) this._mdbaseCache.set(folder, await this.loadCollection(folder));
      const coll = this._mdbaseCache.get(folder)!;
      if (coll) {
        const collRel = folder ? relPath.slice(folder.length + 1) : relPath;
        const sch = mdbaseSchemaFor(coll, collRel);
        if (sch) return sch;
      }
    }
    return null;
  }

  /** Set any row that violates its note's schema to refused, in place. */
  private validateRows(rows: PlanRow[], sch: { constraints: Record<string, PropConstraint>; required: string[] } | null): void {
    if (!sch) return;
    for (const r of rows) {
      if (r.action === "refused" || r.action === "unreadable") continue;
      if (sch.required.includes(r.key) && r.value === null) { r.action = "refused"; r.reason = "required, can't be blank"; continue; }
      const c = sch.constraints[r.key];
      if (c) { const reason = validateAgainst(r.value, c); if (reason) { r.action = "refused"; r.reason = `mdbase: ${reason}`; } }
    }
  }

  /** Read each note and resolve every row's action + current value. Never writes. */
  async preview(): Promise<void> {
    if (this.status === "previewing" || this.status === "writing") return;
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    if (this.vault.trim() === "") { this.status = "error"; this.statusMessage = "Set the Obsidian vault folder in Settings"; return; }
    this.status = "previewing";
    this._mdbaseCache.clear();
    try {
      for (const [p, rows] of this.byPath()) {
        let text: string;
        try { text = await readVaultFile(this.vault, p); }
        catch { for (const r of rows) { r.action = "unreadable"; r.before = ""; r.reason = undefined; } continue; }
        for (const r of rows) {
          if (r.key === NOTE_BODY) {
            const { action, before } = resolveBody(text, r.value as string);
            r.before = before; r.action = action; r.reason = undefined;
            continue;
          }
          const { action, before } = resolveKey(text, r.key, r.value);
          r.before = before;
          r.action = action === "add" && !this.addMissing ? "unchanged" : action;
          r.reason = action === "refused" ? "nested block" : undefined;
        }
        this.validateRows(rows, await this.schemaFor(p)); // mdbase: refuse invalid rows
      }
      this.cachedPlan = propertyPlanFrame(this.planRows);
      const n = (a: string) => this.planRows.filter((r) => r.action === a).length;
      this.status = "idle";
      this.statusMessage = `Preview: ${n("add")} to add, ${n("update")} to update, ${n("unchanged")} unchanged` +
        `${n("refused") ? `, ${n("refused")} refused` : ""}${n("unreadable") ? `, ${n("unreadable")} unreadable` : ""}`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  /** Call ONLY from the Run button (or the headless --run); re-entrancy-guarded. */
  async run(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (!hasFs()) { this.status = "error"; this.statusMessage = "Writing needs the desktop app"; return; }
    if (this.vault.trim() === "") { this.status = "error"; this.statusMessage = "Set the Obsidian vault folder in Settings"; return; }
    if (isSolError(this.cachedCube)) { this.status = "error"; this.statusMessage = this.cachedCube.code; return; }
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    this.status = "writing";
    this._mdbaseCache.clear();
    let wrote = 0, changed = 0, failed = 0;
    const failures: string[] = [];
    const newTypes = new Map<string, string>(); // key → obsidian type, for addMissing
    const cube = isCubeValue(this.cachedCube) ? this.cachedCube : null;
    try {
      for (const [p, rows] of this.byPath()) {
        let text: string;
        try { text = await readVaultFile(this.vault, p); }
        catch { failed++; if (failures.length < 3) failures.push(`${p}: unreadable`); continue; }
        const sch = await this.schemaFor(p);
        // Only the rows that would change; a fresh resolve so a stale Preview can't misfire.
        const patch: Record<string, PlanRow["value"]> = {};
        let touched = 0;
        let newBody: string | null = null;
        for (const r of rows) {
          if (r.key === NOTE_BODY) {
            if (resolveBody(text, r.value as string).action === "update") { newBody = r.value as string; touched++; }
            continue;
          }
          const { action } = resolveKey(text, r.key, r.value);
          if (action === "refused") continue;
          if (action === "add" && !this.addMissing) continue;
          if (action === "unchanged") continue;
          // mdbase: never write a value the note's schema would reject.
          if (sch) {
            if (sch.required.includes(r.key) && r.value === null) continue;
            const c = sch.constraints[r.key];
            if (c && validateAgainst(r.value, c)) continue;
          }
          patch[r.key] = r.value;
          touched++;
          if (action === "add" && cube) newTypes.set(r.key, obsidianTypeName(cube, r.key));
        }
        // Bump an existing dateModified / updated in its own form.
        for (const stampKey of ["dateModified", "updated"]) {
          const cur = resolveKey(text, stampKey, "");
          if (cur.action !== "add") {
            patch[stampKey] = formatDateSerial(nowSerial(), /^\d{4}-\d{2}-\d{2}$/.test(cur.before) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
          }
        }
        if (touched === 0) continue;
        let out = Object.keys(patch).length ? patchFrontmatter(text, patch).text : text;
        if (newBody !== null) out = setBody(out, newBody); // the note-body column → the body
        try {
          await writeTextFilePath(await joinPath(this.vault, ...p.split("/")), out);
          wrote++; changed += touched;
        } catch (e) {
          failed++;
          if (failures.length < 3) failures.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (this.addMissing && newTypes.size > 0) await this.registerTypes(newTypes);
      if (this.writeBase && wrote > 0 && cube) {
        try {
          const folders = new Set(this.planRows.map((r) => (r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "")));
          const folder = folders.size === 1 ? [...folders][0] : "";
          await writeTextFilePath(
            await joinPath(this.vault, ...baseRelPath(folder, this.label).split("/")),
            buildBaseView(folder, writableKeys(cube, this.stringLiterals.keys ?? ""), this.label),
          );
        } catch { /* the .base companion is a convenience, never a write failure */ }
      }
      this.status = failed ? "error" : "ok";
      this.statusMessage = `${changed} propert${changed === 1 ? "y" : "ies"} across ${wrote} note${wrote === 1 ? "" : "s"}` +
        `${failed ? `, ${failed} failed — ${failures.join("; ")}` : ""}`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  /** Merge new keys' types into `.obsidian/types.json` (one JSON write). Best effort. */
  private async registerTypes(newTypes: Map<string, string>): Promise<void> {
    try {
      let types: Record<string, string> = {};
      try {
        const parsed = JSON.parse(await readVaultFile(this.vault, ".obsidian/types.json")) as { types?: Record<string, string> };
        types = parsed.types ?? {};
      } catch { /* no file yet */ }
      let added = false;
      for (const [k, t] of newTypes) if (!(k in types)) { types[k] = t; added = true; }
      if (!added) return;
      await writeTextFilePath(await joinPath(this.vault, ".obsidian", "types.json"), JSON.stringify({ types }, null, 2) + "\n");
    } catch { /* registration is a convenience, never a write failure */ }
  }
}
