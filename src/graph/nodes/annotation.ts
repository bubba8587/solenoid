import { ClassicPreset } from "rete";
import {
  numberSocket, stringSocket, logicalSocket, dateSocket,
  listSocket, strListSocket, logicalListSocket, dateListSocket, frameSocket,
  SolenoidSocket,
} from "../sockets";
import { parseDateToSerial } from "./date";
import { chartOut, strOut, documentOut } from "./shared";
import { makeDocument, type DocumentValue } from "../documentValue";
import type { FrameValue, FrameColumn, FrameColType, FrameCell } from "../frame";
import type { ImageValue } from "../imageValue";
import type { SvgValue } from "../svgValue";
import {
  parseNoteFrontmatter,
  type FrontmatterFieldType,
  type FrontmatterScalar,
  type FrontmatterRow,
  type FrontmatterValue,
} from "../noteFrontmatter";

/** The value a frontmatter key emits: a scalar/list (FrontmatterValue) or, for a `frame`
 *  field, a built FrameValue. */
type EmittedValue = FrontmatterValue | FrameValue;

// A Note is a pure SOURCE: `---`-fenced frontmatter keys become typed OUTPUT
// sockets, and it deliberately mints no inputs — that is the Report node's job.

const FIELD_SOCKETS: Record<FrontmatterFieldType, SolenoidSocket> = {
  number: numberSocket,
  string: stringSocket,
  logical: logicalSocket,
  date: dateSocket,
  list: listSocket,
  strlist: strListSocket,
  logicallist: logicalListSocket,
  datelist: dateListSocket,
  frame: frameSocket,
};

const FIELD_BASE: Record<Exclude<FrontmatterFieldType, "frame">, "number" | "string" | "logical" | "date"> = {
  number: "number", string: "string", logical: "logical", date: "date",
  list: "number", strlist: "string", logicallist: "logical", datelist: "date",
};
const LIST_TYPES = new Set<FrontmatterFieldType>(["list", "strlist", "logicallist", "datelist"]);

/** A frame column's type from its cells, first non-null wins (dates already collapsed to
 *  serials, so they type as number — a Note frame is plain data, no per-column date pick). */
function frameColType(cells: FrontmatterScalar[]): FrameColType {
  for (const v of cells) {
    if (v === null) continue;
    if (typeof v === "boolean") return "logical";
    if (typeof v === "number") return "number";
    return "string";
  }
  return "string";
}

/** Rows of `{name: value}` → a FrameValue: columns are the keys in first-appearance order
 *  (the mirror of the Script node's frame form). A missing key in a row is a null cell. */
function rowsToFrame(rows: FrontmatterRow[]): FrameValue {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  const columns: FrameColumn[] = names.map((name) => {
    const cells = rows.map((r) => (name in r ? r[name] : null));
    return { name, type: frameColType(cells), values: cells as FrameCell[] };
  });
  return { __frame: true, columns };
}

// Only bites when a per-key TYPE override disagrees with the guessed value.
function coerceScalar(v: FrontmatterScalar, base: "number" | "string" | "logical" | "date"): FrontmatterScalar {
  if (v === null) return null;
  switch (base) {
    case "number": {
      const n = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "string":
      return typeof v === "string" ? v : String(v);
    case "logical":
      return typeof v === "boolean" ? v : v === 1 || v === "1" || String(v).toLowerCase() === "true";
    case "date": {
      const s = typeof v === "number" ? v : parseDateToSerial(String(v));
      return Number.isFinite(s) ? Math.round(s) : null;
    }
  }
}

function coerceValue(value: FrontmatterValue, type: FrontmatterFieldType): EmittedValue {
  if (type === "frame") return rowsToFrame(Array.isArray(value) ? (value as FrontmatterRow[]) : []);
  const base = FIELD_BASE[type];
  if (LIST_TYPES.has(type)) {
    const arr = Array.isArray(value) ? value : value === null ? [] : [value];
    return arr.map((e) => coerceScalar(e as FrontmatterScalar, base));
  }
  const scalar = Array.isArray(value) ? (value[0] ?? null) : value;
  return coerceScalar(scalar as FrontmatterScalar, base);
}

export class NoteNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    document: "Carries the note's full text, frontmatter included, for a document sink such as Write to Obsidian.",
  };

  body: string;        // markdown — may open with a `---`-fenced YAML frontmatter block
  color: string;       // palette SLOT id (resolved to a hex at render); tints the note bg + accent
  width: number;
  height: number;
  collapsed: boolean;  // when true, only the header bar shows
  // A field's type is GUESSED on first sight; a user pick pins it here so editing
  // the value later can't silently re-type the socket. Persisted.
  fieldTypes: Record<string, FrontmatterFieldType>;

  // Derived from `body` on every sync (NOT persisted — the body is the source).
  private _renderBody = "";                              // markdown below the block
  private _fieldKeys: string[] = [];                     // output keys in source order
  private _fieldValues = new Map<string, EmittedValue>();

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
    // The FIXED output — syncFields skips it when reconciling the per-key ones.
    this.addOutput("document", documentOut("Document"));
    // At construction `outputs` is empty, so this only ADDS — connections restored
    // after node creation then find their outputs present.
    this.syncFields();
  }

  /** The markdown to render — the body with any frontmatter block stripped. */
  get renderBody(): string { return this._renderBody; }
  /** Output keys (frontmatter keys) in source order, for socket layout. */
  fieldKeys(): string[] { return this._fieldKeys; }
  /** A field's current socket type (override or guess), or undefined. */
  fieldType(key: string): FrontmatterFieldType | undefined {
    const sock = this.outputs[key]?.socket;
    return sock instanceof SolenoidSocket ? (sock.dataType as FrontmatterFieldType) : undefined;
  }

  /**
   * Reconcile the output sockets to the body's frontmatter. Adds new keys, drops
   * vanished ones, and retypes a key whose socket family changed. Returns BOTH:
   *  - `removed`: keys whose output is GONE — the caller must drop their cables.
   *  - `retyped`: keys whose output stayed but changed TYPE — the caller keeps a
   *    cable iff the downstream input still accepts the new type (an `any` input
   *    always does), else drops it. The output is removed+re-added (same key, new
   *    socket) so the dot re-renders with the new color; the editor connection,
   *    which references the KEY, survives that as long as the caller doesn't drop it.
   * Connection cleanup is the CALLER's job (the node has no editor handle); at
   * construction there are none.
   */
  syncFields(): {
    removed: string[];
    retyped: { key: string; type: FrontmatterFieldType }[];
  } {
    const parsed = parseNoteFrontmatter(this.body);
    this._renderBody = parsed.body;

    const wanted = new Map<string, { value: EmittedValue; type: FrontmatterFieldType }>();
    for (const f of parsed.fields) {
      const type = this.fieldTypes[f.key] ?? f.guessed;
      wanted.set(f.key, { value: coerceValue(f.value, type), type });
    }
    // Prune overrides for keys no longer present (keep the save lean).
    for (const k of Object.keys(this.fieldTypes)) if (!wanted.has(k)) delete this.fieldTypes[k];

    const removed: string[] = [];
    const retyped: { key: string; type: FrontmatterFieldType }[] = [];
    for (const key of Object.keys(this.outputs)) {
      if (key === "document") continue; // the fixed document output isn't a frontmatter key
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

  data(): Record<string, EmittedValue | DocumentValue> {
    return { ...this.fieldValues(), document: makeDocument(this.body, {}, undefined, this.id) };
  }

/** Use this from the UI: the installErrorGuards wrapper calls `firstInputError`
 *  OUTSIDE its try/catch, so calling `data()` with no args throws. */
  fieldValues(): Record<string, EmittedValue> {
    const out: Record<string, EmittedValue> = {};
    for (const [k, v] of this._fieldValues) out[k] = v;
    return out;
  }
}

// A LOCAL file's bytes never enter the save JSON (`dataUrl` is off copyPaste's
// extractInit whitelist); desktop bundles the file beside the doc and persists
// `assetPath`, web keeps a local attach session-only.

export class ImageNode extends ClassicPreset.Node {
  url: string;        // web URL — persisted
  dataUrl: string;    // local file as a base64 data: URL — session-only, NOT persisted
  fileName: string;   // the attached file's original name — names the bundled copy
  assetPath: string;  // doc-relative bundled file ("images/photo.png") — persisted
  height: number;     // rendered image height in px (the inline height field)
  width: number;      // node card width
  collapsed: boolean; // when true, only the header bar shows

  constructor(init?: { label?: string; url?: string; fileName?: string; assetPath?: string; height?: number; width?: number; collapsed?: boolean }) {
    super(init?.label ?? "Image");
    this.url = init?.url ?? "";
    this.dataUrl = "";
    this.fileName = init?.fileName ?? "";
    this.assetPath = init?.assetPath ?? "";
    this.height = init?.height ?? 160;
    this.width = init?.width ?? 240;
    this.collapsed = init?.collapsed ?? false;
    // A chart-family figure value, so it wires into a Report or any `chart` consumer.
    this.addOutput("image", chartOut("Image"));
  }

  /** The image to show: a freshly-attached local file wins, else the saved URL. */
  get src(): string {
    return this.dataUrl || this.url;
  }

  data(): { image: ImageValue | null } {
    const src = this.src;
    if (!src) return { image: null };
    return { image: { __image: true, src, height: this.height, alt: this.label, title: this.label } };
  }
}

// A LINK to a file on disk — the path, never the bytes. A canvas object with NO
// sockets: it carries nothing into the graph, it just points at a file you can open.
// Desktop persists the absolute `path`; on web there is no path (the browser sandbox
// has none), so an attach is session-only and only `fileName` survives a reload —
// the same "local file, not saved with the document" bargain the Image node strikes.
export class FileLinkNode extends ClassicPreset.Node {
  path: string;        // absolute path — persisted (desktop); "" on web
  fileName: string;    // display name (with extension) — persisted, carries web reloads
  collapsed: boolean;  // when true, only the header bar shows
  // Fixed-width card (no resize gesture), so it deliberately owns no width/height —
  // the width lives in CSS, and it stays out of the persistence SIZE_OWNERS set.

  constructor(init?: { label?: string; path?: string; fileName?: string; collapsed?: boolean }) {
    super(init?.label ?? "File Link");
    this.path = init?.path ?? "";
    this.fileName = init?.fileName ?? "";
    this.collapsed = init?.collapsed ?? false;
    // No addInput/addOutput: a link is not a value in the dataflow.
  }

  // No outputs, but the dataflow engine still calls data() on every node — return
  // nothing (the Presentation / Session History pattern for a sockets-less node).
  data(): Record<string, never> {
    return {};
  }
}

// A visual slicer: clicking a shape emits that layer's NAME on `Layer`, and the
// picture flows out `chart` carrying the selection. The markup is just text, so it
// persists in `stringLiterals.source`.

const DEFAULT_SVG_HOVER = "#4f9dff";

export class SvgPickerNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    layer: "Carries the clicked layer's name and stays blank until a shape is picked.",
  };

  url: string;                                  // last web source URL — persisted
  stringLiterals: Record<string, string> = {}; // .source = inlined SVG markup — persisted
  hoverColor: string;                           // hover/selection highlight color — persisted
  selectedLayer: string;                        // the clicked layer name ("" = none) — persisted
  height: number;                               // rendered SVG-well height in px
  width: number;                                // node card width

  constructor(init?: {
    label?: string; url?: string; source?: string; hoverColor?: string;
    selectedLayer?: string; height?: number; width?: number;
  }) {
    super(init?.label ?? "SVG");
    this.url = init?.url ?? "";
    // On load, persistence restores stringLiterals separately (extractInit skips it).
    this.stringLiterals.source = init?.source ?? "";
    this.hoverColor = init?.hoverColor ?? DEFAULT_SVG_HOVER;
    this.selectedLayer = init?.selectedLayer ?? "";
    this.height = init?.height ?? 200;
    this.width = init?.width ?? 260;
    this.addOutput("chart", chartOut("SVG"));
    this.addOutput("layer", strOut("Layer"));
  }

  /** The inlined SVG markup to render (source of truth for the figure + picking). */
  get source(): string { return this.stringLiterals.source ?? ""; }

  data(): { chart: SvgValue | null; layer: string | null } {
    const source = this.source;
    const layer = this.selectedLayer || null;
    const chart: SvgValue | null = source
      ? { __svg: true, source, selected: layer, hoverColor: this.hoverColor, height: this.height, title: this.label }
      : null;
    return { chart, layer };
  }
}
