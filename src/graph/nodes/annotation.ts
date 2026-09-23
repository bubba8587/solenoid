// [[C68]]
import { ClassicPreset } from "rete";
import { sourceHasLayer } from "../svgLayer";
import {
  numberSocket, stringSocket, logicalSocket, dateSocket,
  listSocket, strListSocket, logicalListSocket, dateListSocket, frameSocket,
  complexSocket, complexListSocket,
  tableSocket, strTableSocket, logicalTableSocket, dateTableSocket, complexTableSocket,
  SolenoidSocket, cubeSocket, elementFamilyOf, latticeRank, typeAtRank,
} from "../sockets";
import { parseDateToSerial } from "./date";
import { noteDateText } from "./dateSerial";
import { chartOut, strOut, documentOut } from "./shared";
import { makeDocument, type DocumentValue } from "../documentValue";
import { hasKnapSyntax, knapErrorText, renderKnap, toTemplateValue } from "../knapTemplate";
import { solError, type SolError } from "../errorValue";
import { getActiveView, getOwningEditor } from "../activeGraph";
import { dropStrandedFrontmatterCables } from "../noteFrontmatterSync";
import { isFrameValue, recordsToCube, coerceFrameCell, type FrameValue, type FrameColumn, type FrameColType, type CubeValue } from "../frame";
import { shapeOfFrameValue, type Shape } from "../frameShape";
import type { ColumnPicks, PluginColumnTypes } from "../pluginColumnTypes";
import type { ImageValue } from "../imageValue";
import type { SvgValue } from "../svgValue";
import {
  parseNoteFrontmatter,
  guessScalarText,
  type FrontmatterFieldType,
  type FrontmatterScalar,
  type FrontmatterRow,
  type FrontmatterValue,
} from "../noteFrontmatter";

type EmittedValue = FrontmatterValue | FrameValue | CubeValue | SolError;

const KNAP_UNQUOTED = 'Knap vars in frontmatter require quoted "{{var}}" syntax';

const NOTE_RESERVED: ReadonlySet<string> = new Set(["document"]);

const FIELD_SOCKETS: Record<FrontmatterFieldType, SolenoidSocket> = {
  number: numberSocket,
  string: stringSocket,
  logical: logicalSocket,
  date: dateSocket,
  list: listSocket,
  strlist: strListSocket,
  logicallist: logicalListSocket,
  datelist: dateListSocket,
  complex: complexSocket,
  complexlist: complexListSocket,
  table: tableSocket,
  strtable: strTableSocket,
  logicaltable: logicalTableSocket,
  datetable: dateTableSocket,
  complextable: complexTableSocket,
  frame: frameSocket,
  cube: cubeSocket,
};

type FieldBase = "number" | "string" | "logical" | "date" | "complex";

function reshapePin(
  pinned: FrontmatterFieldType | undefined,
  guessed: FrontmatterFieldType,
): FrontmatterFieldType | undefined {
  const rank = latticeRank(guessed);
  if (!pinned || rank === null || latticeRank(pinned) === null) return undefined;
  return (typeAtRank(pinned, rank as 0 | 1 | 2) ?? undefined) as FrontmatterFieldType | undefined;
}

/** A plain ISO date is still text here; the reader's `dateColumns` names the date columns. */
function frameColType(cells: FrontmatterScalar[], isDate: boolean): FrameColType {
  if (isDate) return "date";
  for (const v of cells) {
    if (v === null) continue;
    if (typeof v === "boolean") return "logical";
    if (typeof v === "number") return "number";
    return "string";
  }
  return "string";
}

/** Every cell crosses coerceFrameCell with its text kept as `raw`, so a type that cannot read a cell shows NaN over the text ([[D72]]). */
function rowsToFrame(rows: FrontmatterRow[], dateColumns: readonly string[] = [], picks: ColumnPicks = {}): FrameValue {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  const columns: FrameColumn[] = names.map((name) => {
    // A frame cell is scalar: a stray list keeps its first element, a table nothing.
    const cells = rows.map((r): FrontmatterScalar => {
      const v = name in r ? r[name] : null;
      if (!Array.isArray(v)) return v;
      const first = v[0] ?? null;
      return typeof first === "object" ? null : first;
    });
    const type = picks[name] ?? frameColType(cells, dateColumns.includes(name));
    const raw = cells.map((c) => (c === null ? "" : typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c)));
    return { name, type, values: raw.map((r) => coerceFrameCell(type, r)), raw };
  });
  return { __frame: true, columns };
}

function coerceScalar(v: FrontmatterScalar, base: FieldBase): FrontmatterScalar {
  if (v === null) return null;
  switch (base) {
    case "number": {
      const n = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "string":
    case "complex":
      return typeof v === "string" ? v : String(v);
    case "logical":
      return typeof v === "boolean" ? v : v === 1 || v === "1" || String(v).toLowerCase() === "true";
    case "date": {
      const s = typeof v === "number" ? v : parseDateToSerial(String(v));
      return Number.isFinite(s) ? s : null;
    }
  }
}

/** `guessed` is what the reader saw: a date pinned to text keeps the ISO text written, not its serial. */
function coerceValue(value: FrontmatterValue, type: FrontmatterFieldType, dateColumns?: readonly string[], picks?: ColumnPicks, guessed?: FrontmatterFieldType): EmittedValue {
  if (type === "frame") return rowsToFrame(Array.isArray(value) ? (value as FrontmatterRow[]) : [], dateColumns, picks);
  if (type === "cube") return recordsToCube(Array.isArray(value) ? (value as Record<string, unknown>[]) : [], picks);
  const base = elementFamilyOf(type) as FieldBase;
  const rank = latticeRank(type);
  const datesAsText = guessed !== undefined && elementFamilyOf(guessed) === "date" && (base === "string" || base === "complex");
  const one = (e: unknown) => coerceScalar((datesAsText && typeof e === "number" ? noteDateText(e) : e) as FrontmatterScalar, base);
  const items: unknown[] = Array.isArray(value) ? value : value === null ? [] : [value];
  if (rank === 2) return items.map((row) => (Array.isArray(row) ? row : [row]).map(one));
  if (rank === 1) return items.flat().map(one);
  return one(items.flat()[0] ?? null);
}

export class NoteNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    document: "Carries the note's full text, frontmatter included and the template rendered, for a document sink such as Write to Obsidian.",
  };

  body: string;
  color: string;
  width: number;
  height: number;
  collapsed: boolean;
  fieldTypes: Record<string, FrontmatterFieldType>;
  columnPicks: PluginColumnTypes = {};

  private _renderBody = "";
  private _fieldKeys: string[] = [];
  private _fieldValues = new Map<string, EmittedValue>();
  private _knapRaw = new Map<string, string>();
  private _knapRendered = new Map<string, { raw: string; value: FrontmatterValue; type: FrontmatterFieldType }>();

  constructor(init?: {
    label?: string; body?: string; color?: string; width?: number; height?: number;
    collapsed?: boolean; fieldTypes?: Record<string, FrontmatterFieldType>;
  }) {
    super(init?.label ?? "Note");
    this.body = init?.body ?? "";
    this.color = init?.color ?? "amber";
    this.width = init?.width ?? 345;
    this.height = init?.height ?? 150;
    this.collapsed = init?.collapsed ?? false;
    this.fieldTypes = { ...(init?.fieldTypes ?? {}) };
    this.addOutput("document", documentOut("Document"));
    // At construction `outputs` is empty, so this only adds, and cables restored after creation find their outputs.
    this.syncFields();
  }

  protected reservedOutputs(): ReadonlySet<string> { return NOTE_RESERVED; }

  get renderBody(): string { return this._renderBody; }
  fieldKeys(): string[] { return this._fieldKeys; }
  fieldType(key: string): FrontmatterFieldType | undefined {
    const sock = this.outputs[key]?.socket;
    return sock instanceof SolenoidSocket ? (sock.dataType as FrontmatterFieldType) : undefined;
  }

  syncFields(): {
    removed: string[];
    retyped: { key: string; type: FrontmatterFieldType }[];
  } {
    const parsed = parseNoteFrontmatter(this.body);
    this._renderBody = parsed.body;

    const wanted = new Map<string, { value: EmittedValue; type: FrontmatterFieldType }>();
    this._knapRaw.clear();
    for (const f of parsed.fields) {
      if (f.knapUnquoted) { wanted.set(f.key, { value: solError("#SYNTAX!", KNAP_UNQUOTED), type: "string" }); continue; }
      const knap = typeof f.value === "string" && hasKnapSyntax(f.value);
      if (knap) this._knapRaw.set(f.key, f.value as string);
      const last = knap ? this._knapRendered.get(f.key) : undefined;
      const rendered = last && last.raw === f.value ? last : undefined;
      const guessed = rendered?.type ?? f.guessed;
      const pinned: FrontmatterFieldType | undefined = this.fieldTypes[f.key];
      const pin = reshapePin(pinned, guessed);
      if (pinned !== undefined && pin !== pinned) {
        if (pin === undefined) delete this.fieldTypes[f.key];
        else this.fieldTypes[f.key] = pin;
      }
      const type = pin ?? guessed;
      wanted.set(f.key, { value: coerceValue(rendered ? rendered.value : f.value, type, f.dateColumns, this.columnPicks[f.key], guessed), type });
    }
    for (const k of [...this._knapRendered.keys()]) if (!this._knapRaw.has(k)) this._knapRendered.delete(k);
    for (const k of Object.keys(this.fieldTypes)) if (!wanted.has(k)) delete this.fieldTypes[k];

    const removed: string[] = [];
    const retyped: { key: string; type: FrontmatterFieldType }[] = [];
    const reserved = this.reservedOutputs();
    for (const key of Object.keys(this.outputs)) {
      if (reserved.has(key)) continue;
      const w = wanted.get(key);
      const cur = this.outputs[key]!.socket;
      if (!w) {
        this.removeOutput(key);
        removed.push(key);
      } else if (FIELD_SOCKETS[w.type] !== cur) {
        this.removeOutput(key);
        this.addOutput(key, new ClassicPreset.Output(FIELD_SOCKETS[w.type], key));
        retyped.push({ key, type: w.type });
      }
    }
    for (const [key, w] of wanted) {
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(FIELD_SOCKETS[w.type], key));
    }

    this._fieldKeys = [...wanted.keys()];
    this._fieldValues = new Map([...wanted].map(([k, w]) => [k, w.value]));

    return { removed, retyped };
  }

  frameShape(outKey: string): Shape | null {
    const v = this.fieldValues()[outKey];
    return isFrameValue(v) ? shapeOfFrameValue(v) : null;
  }

  templateVariables(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    for (const [k, v] of this._fieldValues) vars[k] = toTemplateValue(v, this.fieldType(k));
    return vars;
  }

  private renderedFields(rendered: string): void {
    if (this._knapRaw.size === 0) return;
    const byKey = new Map(parseNoteFrontmatter(rendered).fields.map((f) => [f.key, f]));
    let retype = false;
    for (const [k, raw] of this._knapRaw) {
      const rf = byKey.get(k);
      let value: FrontmatterValue = rf?.value ?? null;
      let type: FrontmatterFieldType = rf?.guessed ?? "string";
      if (typeof value === "string") { const g = guessScalarText(value); value = g.value; type = g.kind; }
      if (this.fieldTypes[k] === undefined && this.fieldType(k) !== type) retype = true;
      this._knapRendered.set(k, { raw, value, type });
      this._fieldValues.set(k, coerceValue(value, this.fieldTypes[k] ?? type, undefined, undefined, type));
    }
    if (!retype) return;
    queueMicrotask(() => {
      void (async () => {
        const { removed, retyped } = this.syncFields();
        await dropStrandedFrontmatterCables(this.id, removed, retyped);
        const view = getActiveView();
        await view?.rerenderNode(this.id);
        const editor = getOwningEditor(this.id);
        if (editor && view && retyped.length) (await import("../fcReconcile")).reconcileFcTypes(editor, view);
      })();
    });
  }

  data(): Record<string, EmittedValue | DocumentValue> | Promise<Record<string, EmittedValue | DocumentValue | SolError>> {
    const extra = { source: this.body };
    if (!hasKnapSyntax(this.body)) return { ...this.fieldValues(), document: makeDocument(this.body, {}, undefined, this.id, extra) };
    return renderKnap(this.body, this.templateVariables(), { keepUnknown: true }).then((r) => {
      if (!r.errors.length) this.renderedFields(r.output);
      return {
        ...this.fieldValues(),
        document: r.errors.length ? solError("#SYNTAX!", knapErrorText(r.errors)) : makeDocument(r.output, {}, undefined, this.id, extra),
      };
    });
  }

  /** Use from the UI: the error-guard wrapper calls firstInputError outside its try/catch, so data() with no args throws. */
  fieldValues(): Record<string, EmittedValue> {
    const out: Record<string, EmittedValue> = {};
    for (const [k, v] of this._fieldValues) out[k] = v;
    return out;
  }
}

export class ImageNode extends ClassicPreset.Node {
  url: string;
  dataUrl: string;
  fileName: string;
  assetPath: string;
  height: number;
  width: number;
  collapsed: boolean;

  constructor(init?: { label?: string; url?: string; fileName?: string; assetPath?: string; height?: number; width?: number; collapsed?: boolean }) {
    super(init?.label ?? "Image");
    this.url = init?.url ?? "";
    this.dataUrl = "";
    this.fileName = init?.fileName ?? "";
    this.assetPath = init?.assetPath ?? "";
    this.height = init?.height ?? 160;
    this.width = init?.width ?? 240;
    this.collapsed = init?.collapsed ?? false;
    this.addOutput("image", chartOut("Image"));
  }

  get src(): string {
    return this.dataUrl || this.url;
  }

  data(): { image: ImageValue | null } {
    const src = this.src;
    if (!src) return { image: null };
    return { image: { __image: true, src, height: this.height, alt: this.label, title: this.label } };
  }
}

export class FileLinkNode extends ClassicPreset.Node {
  path: string;
  fileName: string;
  collapsed: boolean;
  // Fixed-width card: it owns no width or height, so it stays out of SIZE_OWNERS ([[C37]] observerOwnsSize).

  constructor(init?: { label?: string; path?: string; fileName?: string; collapsed?: boolean }) {
    super(init?.label ?? "File Link");
    this.path = init?.path ?? "";
    this.fileName = init?.fileName ?? "";
    this.collapsed = init?.collapsed ?? false;
  }

  // The engine still calls data() on a socketless node, so return nothing.
  data(): Record<string, never> {
    return {};
  }
}

const DEFAULT_SVG_HOVER = "#4f9dff";

export class SvgPickerNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    layer: "Carries the clicked layer's name and stays blank until a shape is picked.",
  };

  url: string;
  stringLiterals: Record<string, string> = {};
  hoverColor: string;
  selectedLayer: string;
  height: number;
  width: number;

  constructor(init?: {
    label?: string; url?: string; source?: string; hoverColor?: string;
    selectedLayer?: string; height?: number; width?: number;
  }) {
    super(init?.label ?? "SVG");
    this.url = init?.url ?? "";
    // Persistence restores stringLiterals separately on load; extractInit skips it.
    this.stringLiterals.source = init?.source ?? "";
    this.hoverColor = init?.hoverColor ?? DEFAULT_SVG_HOVER;
    this.selectedLayer = init?.selectedLayer ?? "";
    this.height = init?.height ?? 200;
    this.width = init?.width ?? 260;
    this.addOutput("chart", chartOut("SVG"));
    this.addOutput("layer", strOut("Layer"));
  }

  get source(): string { return this.stringLiterals.source ?? ""; }

  data(): { chart: SvgValue | null; layer: string | null } {
    const source = this.source;
    const layer = this.selectedLayer && sourceHasLayer(source, this.selectedLayer) ? this.selectedLayer : null;
    const chart: SvgValue | null = source
      ? { __svg: true, source, selected: layer, hoverColor: this.hoverColor, height: this.height, title: this.label }
      : null;
    return { chart, layer };
  }
}
