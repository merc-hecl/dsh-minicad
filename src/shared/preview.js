import { localizedError } from "./errors.js";
// Revision-local preview transport. All blocks are aligned, little-endian,
// and can be used directly as GPU attributes without flattening JSON arrays.
const MAGIC = 0x3156434d; // MCV1
const FORMAT = 3;
const fields = ["positions", "normals", "indices", "edges", "faceIndices", "edgeIndices", "faceColors"];
const floatFields = ["positions", "normals", "edges"];
const HEADER = 8 + fields.length * 4;
const emptyColors = new Uint32Array();
export const PREVIEW_VERSION = 4;
const fail = () => {
  throw localizedError(
    "预览数据无效，请重新加载", "The preview data is invalid. Reload the model.",
  );
};

export function previewInfo(input, byteLength = input.byteLength) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (bytes.byteLength < HEADER) fail();
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  if (header.getUint32(0, true) !== MAGIC || header.getUint32(4, true) !== FORMAT)
    fail();
  const counts = fields.map((_, i) => header.getUint32(8 + i * 4, true));
  const [positions, normals, indices, edges, faceIndices, edgeIndices, faceColors] = counts;
  if (
    !positions ||
    positions % 3 ||
    normals !== positions ||
    !indices ||
    indices % 3 ||
    edges % 6 ||
    faceIndices !== indices / 3 ||
    edgeIndices !== edges / 6 ||
    HEADER + counts.reduce((sum, n) => sum + n * 4, 0) !== byteLength
  )
    fail();
  return {
    format: FORMAT,
    byteLength,
    positions,
    normals,
    indices,
    edges,
    faceIndices,
    edgeIndices,
    faceColors,
  };
}
export function encodePreview(preview) {
  const colors = preview.faceColors.some(Boolean) ? preview.faceColors : emptyColors;
  const arrays = fields.map(name => name === "faceColors" ? colors : preview[name]);
  const size =
    HEADER + arrays.reduce((sum, array) => sum + array.length * 4, 0);
  const result = new Uint8Array(size),
    header = new DataView(result.buffer);
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, FORMAT, true);
  let offset = HEADER;
  arrays.forEach((array, i) => {
    header.setUint32(8 + i * 4, array.length, true);
    const Type = floatFields.includes(fields[i]) ? Float32Array : Uint32Array;
    const target = new Type(result.buffer, offset, array.length);
    target.set(array);
    offset += array.length * 4;
  });
  previewInfo(result);
  return result;
}
export function decodePreview(input) {
  let bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteOffset % 4) bytes = bytes.slice();
  const info = previewInfo(bytes);
  let offset = bytes.byteOffset + HEADER;
  const result = {};
  for (const name of fields) {
    const Type = floatFields.includes(name) ? Float32Array : Uint32Array;
    result[name] = new Type(bytes.buffer, offset, info[name]);
    offset += info[name] * 4;
  }
  for (const name of floatFields)
    for (const value of result[name]) if (!Number.isFinite(value)) fail();
  for (const index of result.indices) if (index >= info.positions / 3) fail();
  return result;
}
