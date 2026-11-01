// Revision-local preview transport. All blocks are aligned, little-endian,
// and can be used directly as GPU attributes without flattening JSON arrays.
const MAGIC = 0x3156434d; // MCV1
const HEADER = 32;
const fail = () => {
  throw new Error(
    "预览数据无效，请重新加载 / invalid preview data; reload the model",
  );
};

export function previewInfo(input, byteLength = input.byteLength) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (bytes.byteLength < HEADER) fail();
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  if (header.getUint32(0, true) !== MAGIC || header.getUint32(4, true) !== 2)
    fail();
  const counts = [8, 12, 16, 20, 24, 28].map((offset) =>
    header.getUint32(offset, true),
  );
  const [positions, normals, indices, edges, faceIndices, edgeIndices] = counts;
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
    format: 2,
    byteLength,
    positions,
    normals,
    indices,
    edges,
    faceIndices,
    edgeIndices,
  };
}
export function encodePreview(preview) {
  const arrays = [
    preview.positions,
    preview.normals,
    preview.indices,
    preview.edges,
    preview.faceIndices,
    preview.edgeIndices,
  ];
  const size =
    HEADER + arrays.reduce((sum, array) => sum + array.length * 4, 0);
  const result = new Uint8Array(size),
    header = new DataView(result.buffer);
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, 2, true);
  let offset = HEADER;
  arrays.forEach((array, i) => {
    header.setUint32(8 + i * 4, array.length, true);
    const target = [2, 4, 5].includes(i)
      ? new Uint32Array(result.buffer, offset, array.length)
      : new Float32Array(result.buffer, offset, array.length);
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
  for (const name of [
    "positions",
    "normals",
    "indices",
    "edges",
    "faceIndices",
    "edgeIndices",
  ]) {
    const Type = ["indices", "faceIndices", "edgeIndices"].includes(name)
      ? Uint32Array
      : Float32Array;
    result[name] = new Type(bytes.buffer, offset, info[name]);
    offset += info[name] * 4;
  }
  for (const name of ["positions", "normals", "edges"])
    for (const value of result[name]) if (!Number.isFinite(value)) fail();
  for (const index of result.indices) if (index >= info.positions / 3) fail();
  return result;
}
