// [[C130]] rustCore
// Frames cross into the core and back as buffers: one tag, number and text run per cell (crates/solenoid-core/src/binary.rs).
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "./frame";
import type { BinaryCells } from "./engineWasm";
import { errorRef, errorFromCore } from "./coreValues";
import { isSolError, type SolError } from "./errorValue";

const TAG_NULL = 0, TAG_NUM = 1, TAG_STR = 2, TAG_FALSE = 3, TAG_TRUE = 4, TAG_ERR = 5, TAG_ERR_AT = 6, TAG_ERR_AT_SLOT = 7, TAG_ERR_SAME = 8;

/** A frame's cells for the core, with each column's unit and format unless `meta` is false; any other object crosses as
 *  its text, or with `flatOnly` (the card wire, which carries anything else as JSON: undefined, an object) the frame
 *  doesn't cross and the answer is undefined. The card wire keeps an error's origin ([[E9]] errorsKeepOrigin); the
 *  frame hand-offs don't carry it. */
export function encodeBinary(frame: FrameValue, meta?: boolean): BinaryCells;
export function encodeBinary(frame: FrameValue, meta: boolean, flatOnly: true): BinaryCells | undefined;
export function encodeBinary(frame: FrameValue, meta = true, flatOnly = false): BinaryCells | undefined {
  let total = 0;
  for (const c of frame.columns) total += c.values.length;
  const tags = new Uint8Array(total);
  const nums = new Float64Array(total);
  const parts: string[] = [];
  let lens = new Uint32Array(total + 16);
  let li = 0;
  const text = (t: string) => {
    if (li === lens.length) { const grown = new Uint32Array(lens.length * 2); grown.set(lens); lens = grown; }
    parts.push(t);
    lens[li++] = t.length;
  };
  let k = 0;
  for (const c of frame.columns) {
    // A repeat of the column's last error crosses as a tag alone (`binary.rs` TAG_ERR_SAME).
    let lastErr: unknown;
    for (const v of c.values) {
      if (typeof v === "number") { tags[k] = TAG_NUM; nums[k] = v; }
      else if (typeof v === "string") { tags[k] = TAG_STR; text(v); }
      else if (typeof v === "boolean") tags[k] = v ? TAG_TRUE : TAG_FALSE;
      else if (v === null) tags[k] = TAG_NULL;
      else if (isSolError(v) && v === lastErr) { tags[k] = TAG_ERR_SAME; nums[k] = NaN; }
      else if (isSolError(v)) {
        lastErr = v;
        nums[k] = errorRef(v) ?? NaN; text(v.code); text(v.message);
        const o = flatOnly ? v.origin : undefined;
        if (!o) tags[k] = TAG_ERR;
        else {
          text(o.nodeId); text(o.nodeName);
          if (o.inputSlot === undefined) tags[k] = TAG_ERR_AT;
          else { tags[k] = TAG_ERR_AT_SLOT; text(o.inputSlot); }
        }
      }
      else if (flatOnly) return undefined;
      else if (typeof v === "object") { tags[k] = TAG_STR; text(String(v)); }
      else tags[k] = TAG_NULL;
      k++;
    }
  }
  return {
    schema: frame.columns.map((c) => ({
      name: c.name, type: c.type, len: c.values.length,
      ...(meta && c.unit ? { unit: c.unit } : {}), ...(meta && c.format ? { format: c.format } : {}),
    })),
    tags, nums, strs: parts.join(""), lens: lens.slice(0, li),
  };
}

export function decodeBinary(b: BinaryCells): FrameColumn[] {
  let k = 0, off = 0, li = 0;
  let last: { code: string; message: string; ref: number; id?: string; name?: string; slot?: string; e: SolError } | undefined;
  const text = () => { const n = b.lens[li++]; const t = b.strs.slice(off, off + n); off += n; return t; };
  const out: FrameColumn[] = [];
  for (const c of b.schema) {
    const values = new Array<FrameCell>(c.len);
    for (let i = 0; i < c.len; i++, k++) {
      switch (b.tags[k]) {
        case TAG_NUM: values[i] = b.nums[k]; break;
        case TAG_STR: values[i] = text(); break;
        case TAG_FALSE: values[i] = false; break;
        case TAG_TRUE: values[i] = true; break;
        case TAG_ERR_SAME: values[i] = last!.e; break;
        case TAG_ERR: case TAG_ERR_AT: case TAG_ERR_AT_SLOT: {
          const tag = b.tags[k], code = text(), message = text(), ref = b.nums[k];
          const id = tag === TAG_ERR ? undefined : text(), name = tag === TAG_ERR ? undefined : text();
          const slot = tag === TAG_ERR_AT_SLOT ? text() : undefined;
          // A run of the same error (a card's guard tags every bad cell alike) shares one value.
          if (last && last.code === code && last.message === message && Object.is(last.ref, ref) && last.id === id && last.name === name && last.slot === slot) {
            values[i] = last.e;
            break;
          }
          const origin = id === undefined ? undefined : { nodeId: id, nodeName: name!, ...(slot !== undefined ? { inputSlot: slot } : {}) };
          const e = errorFromCore(code, message || "from the engine", ref, origin);
          last = { code, message, ref, id, name, slot, e };
          values[i] = e;
          break;
        }
        default: values[i] = null;
      }
    }
    if (c.raw) out[out.length - 1].raw = values as string[];
    else out.push({ name: c.name, type: c.type as FrameColType, values, ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}) });
  }
  return out;
}

/** The one buffer `Columnar::to_bytes` writes (`binary.rs`): four little-endian u32 counts, the schema's JSON text padded
 *  to 8 bytes, the numbers, the text lengths, the tags and the text. The numbers and lengths are read in place. */
export function binaryFromBytes(data: ArrayBuffer | ArrayBufferView): BinaryCells {
  let bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteOffset % 8) bytes = bytes.slice();
  const head = new DataView(bytes.buffer, bytes.byteOffset, 16);
  const [schemaLen, cells, lensLen, strsLen] = [0, 4, 8, 12].map((o) => head.getUint32(o, true));
  const utf8 = new TextDecoder();
  let at = 16;
  const schema = JSON.parse(utf8.decode(bytes.subarray(at, at + schemaLen))) as BinaryCells["schema"];
  at += schemaLen + ((8 - ((16 + schemaLen) % 8)) % 8);
  const nums = new Float64Array(bytes.buffer, bytes.byteOffset + at, cells);
  at += cells * 8;
  const lens = new Uint32Array(bytes.buffer, bytes.byteOffset + at, lensLen);
  at += lensLen * 4;
  const tags = bytes.subarray(at, at + cells);
  at += cells;
  return { schema, tags, nums, strs: utf8.decode(bytes.subarray(at, at + strsLen)), lens };
}

