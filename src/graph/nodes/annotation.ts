import { ClassicPreset } from "rete";
import {
  numberSocket, stringSocket, logicalSocket, dateSocket,
  listSocket, strListSocket, logicalListSocket, dateListSocket,
  SolenoidSocket,
} from "../sockets";
import { parseDateToSerial } from "./date";
import { chartOut } from "./shared";
import type { ImageValue } from "../imageValue";
import {
  parseNoteFrontmatter,
  type FrontmatterFieldType,
  type FrontmatterScalar,
  type FrontmatterValue,
} from "../noteFrontmatter";

// ─── Note ─────────────────────────────────────────────────────────────────────
// A free-floating canvas annotation — a sticky note with a title + body. Like the
// Group node it's a real Rete node (selection, drag, delete, copy/paste, undo,
// persistence for free). Its body's optional Obsidian-style `---`-fenced YAML
// frontmatter turns each key into a typed OUTPUT socket — so a Note doubles as a
// lightweight typed-record / constants source (see noteFrontmatter.ts). A plain
// note (no frontmatter) keeps zero output sockets, exactly as before.
//
// A Note is a pure SOURCE: it emits (frontmatter outputs) and never consumes. It
// deliberately does NOT parse `` `=name` `` inline refs or mint input sockets — a
// `` `=name` `` span in a note body is just literal inline code. Reading live graph
// values into a document is the REPORT node's job (nodes/report.ts): Note = source,
// Report = sink, and the two are intentionally opposites (not convertible).

// A field type → its socket singleton. Names align with FrontmatterFieldType.
const FIELD_SOCKETS: Record<FrontmatterFieldType, SolenoidSocket> = {
  number: numberSocket,
  string: stringSocket,
  logical: logicalSocket,
  date: dateSocket,
  list: listSocket,
  strlist: strListSocket,
  logicallist: logicalListSocket,
  datelist: dateListSocket,
};

// The scalar element family backing each field type (lists carry that element).
const FIELD_BASE: Record<FrontmatterFieldType, "number" | "string" | "logical" | "date"> = {
  number: "number", string: "string", logical: "logical", date: "date",
  list: "number", strlist: "string", logicallist: "logical", datelist: "date",
};
const LIST_TYPES = new Set<FrontmatterFieldType>(["list", "strlist", "logicallist", "datelist"]);

// Coerce one scalar to a field's element family — used when a per-key TYPE override
// disagrees with the guessed value (e.g. user retypes the "42" string to a number).
// A no-op when the value already matches (the common, no-override path).
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

function coerceValue(value: FrontmatterValue, type: FrontmatterFieldType): FrontmatterValue {
  const base = FIELD_BASE[type];
  if (LIST_TYPES.has(type)) {
    const arr = Array.isArray(value) ? value : value === null ? [] : [value];
    return arr.map((e) => coerceScalar(e as FrontmatterScalar, base));
  }
  const scalar = Array.isArray(value) ? (value[0] ?? null) : value;
  return coerceScalar(scalar as FrontmatterScalar, base);
}

export class NoteNode extends ClassicPreset.Node {
  body: string;        // markdown — may open with a `---`-fenced YAML frontmatter block
  color: string;       // palette SLOT id (resolved to a hex at render); tints the note bg + accent
  width: number;
  height: number;
  collapsed: boolean;  // when true, only the header bar shows
  // Per-key TYPE override, persisted. A field's type is GUESSED on first sight,
  // then a user pick (the field type icon) pins it here so changing a value later
  // doesn't silently re-type the socket. Stale keys are pruned on each sync.
  fieldTypes: Record<string, FrontmatterFieldType>;

  // Derived from `body` on every sync (NOT persisted — the body is the source).
  private _renderBody = "";                              // markdown below the block
  private _fieldKeys: string[] = [];                     // output keys in source order
  private _fieldValues = new Map<string, FrontmatterValue>();

  // `label` (from ClassicPreset.Node) is the editable header name, mirroring how
  // every other node titles its header.
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
    // Build outputs from the initial body. At construction `outputs` is empty, so
    // this only ADDS — connections (restored after node creation on load) then find
    // their frontmatter-key outputs already present.
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
   *
   * A Note is output-only — no inline-ref inputs to reconcile (that's the Report's
   * job, nodes/report.ts).
   */
  syncFields(): {
    removed: string[];
    retyped: { key: string; type: FrontmatterFieldType }[];
  } {
    const parsed = parseNoteFrontmatter(this.body);
    this._renderBody = parsed.body;

    const wanted = new Map<string, { value: FrontmatterValue; type: FrontmatterFieldType }>();
    for (const f of parsed.fields) {
      const type = this.fieldTypes[f.key] ?? f.guessed;
      wanted.set(f.key, { value: coerceValue(f.value, type), type });
    }
    // Prune overrides for keys no longer present (keep the save lean).
    for (const k of Object.keys(this.fieldTypes)) if (!wanted.has(k)) delete this.fieldTypes[k];

    const removed: string[] = [];
    const retyped: { key: string; type: FrontmatterFieldType }[] = [];
    for (const key of Object.keys(this.outputs)) {
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

  // Each frontmatter key emits its value on the matching OUTPUT. A plain note
  // (no frontmatter) returns {} — no output sockets, exactly as before. A Note has
  // no inputs (output-only source), so data() takes none.
  data(): Record<string, FrontmatterValue> {
    return this.fieldValues();
  }

  /**
   * The current field values as a plain object. Use this from the UI — `data()` is
   * wrapped by installErrorGuards into `(inputs) => …`, which calls
   * `firstInputError(inputs)` OUTSIDE its try/catch, so invoking the wrapped data()
   * with no args throws. This accessor bypasses that wrapper.
   */
  fieldValues(): Record<string, FrontmatterValue> {
    const out: Record<string, FrontmatterValue> = {};
    for (const [k, v] of this._fieldValues) out[k] = v;
    return out;
  }
}

// ─── Image ──────────────────────────────────────────────────────────────────
// A free-floating image annotation — show a picture on the canvas, from a web URL
// or a local file. Like Note it's a real sockets-less node (selection, drag,
// delete, copy/paste, undo, persistence for free) and produces no data.
//
// Persistence: a web `url` round-trips through the JSON save. A LOCAL file is read
// into `dataUrl` (a base64 data: URL) for the session only — it is deliberately
// NOT persisted (the save format is plain JSON and we don't want to bloat it with
// embedded image bytes yet; bundling comes later). So a URL-backed image survives
// reload; a locally-attached one must be re-attached. `dataUrl` is intentionally
// absent from copyPaste's extractInit whitelist so neither save nor copy carries it.

export class ImageNode extends ClassicPreset.Node {
  url: string;        // web URL — persisted
  dataUrl: string;    // local file as a base64 data: URL — session-only, NOT persisted
  height: number;     // rendered image height in px (the inline height field)
  width: number;      // node card width
  collapsed: boolean; // when true, only the header bar shows

  constructor(init?: { label?: string; url?: string; height?: number; width?: number; collapsed?: boolean }) {
    super(init?.label ?? "Image");
    this.url = init?.url ?? "";
    this.dataUrl = "";
    // Default sizes that fit a reasonable card: a 240px-wide node with a 160px-tall
    // image well (letterboxed via object-fit, so any aspect ratio looks intentional).
    this.height = init?.height ?? 160;
    this.width = init?.width ?? 240;
    this.collapsed = init?.collapsed ?? false;
    // Emit the picture as a chart-family figure value so it can be wired into a
    // Report (or any `chart`/`any` consumer) — carrying the node's `height` and,
    // as the node grows transforms, whatever else shapes the rendered image.
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
