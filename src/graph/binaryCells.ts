// [[C130]] rustCore
// Frames cross into the core and back as buffers: one tag, number and text run per cell (crates/solenoid-core/src/binary.rs).
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "./frame";
import type { BinaryCells } from "./engineWasm";
import { errorRef, errorFromCore } from "./coreValues";
import { isSolError } from "./errorValue";

const TAG_NULL = 0, TAG_NUM = 1, TAG_STR = 2, TAG_FALSE = 3, TAG_TRUE = 4, TAG_ERR = 5;

/** A frame's cells for the core, with each column's unit and format unless `meta` is false; any other object crosses as
 *  its text, or with `flatOnly` (a value the card wire carries as JSON then: undefined, an object, an error with its
 *  origin) the frame doesn't cross and the answer is undefined. */
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
    for (const v of c.values) {
      if (typeof v === "number") { tags[k] = TAG_NUM; nums[k] = v; }
      else if (typeof v === "string") { tags[k] = TAG_STR; text(v); }
      else if (typeof v === "boolean") tags[k] = v ? TAG_TRUE : TAG_FALSE;
      else if (v === null) tags[k] = TAG_NULL;
      else if (isSolError(v)) {
        if (flatOnly && v.origin) return undefined;
        tags[k] = TAG_ERR; nums[k] = errorRef(v) ?? NaN; text(v.code); text(v.message);
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
        case TAG_ERR: {
          const code = text(), message = text(), ref = b.nums[k];
          values[i] = errorFromCore(code, message || "from the engine", ref);
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

