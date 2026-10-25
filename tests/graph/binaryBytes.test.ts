// [[C130]] rustCore
// The columnar hand-off as one buffer (`Columnar::to_bytes`), as the desktop's Parquet read sends it: the bytes the
// Rust froze (`binary.rs` `bytes_match_the_frozen_file`) read back as the frame they were made from.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { binaryFromBytes, decodeBinary } from "../../src/graph/binaryCells";
import { enc } from "./coreFixtures";

it("reads the one-buffer hand-off, at any offset", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../../fixtures/core/columnar-bytes.bin"));
  const want = [
    { name: "a", type: "number", values: [{ __nf: "-0" }, { __nf: "nan" }, 1.5, null, { __err: "#N/A", msg: "m" }], unit: { dim: { length: 1 }, display: "km" } },
    { name: "é", type: "string", values: ["x😀", true, false, "", null] },
  ];
  const exact = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  expect(enc(decodeBinary(binaryFromBytes(exact)))).toEqual(want);
  const shifted = new Uint8Array(file.byteLength + 3);
  shifted.set(file, 3);
  expect(enc(decodeBinary(binaryFromBytes(shifted.subarray(3))))).toEqual(want);
});
