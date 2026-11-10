// Minimal GIF89a writer: median-cut global palette, LZW-compressed frames.
// Input frames are RGBA pixel buffers from a 2D canvas.
const BITS = 5;
const LEVELS = 1 << (BITS * 3);
const binOf = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

function histogram(frames) {
  const counts = new Uint32Array(LEVELS);
  for (const pixels of frames)
    for (let index = 0; index < pixels.length; index += 4)
      counts[binOf(pixels[index], pixels[index + 1], pixels[index + 2])]++;
  return counts;
}

function boxOf(bins, counts) {
  let rMin = 31, rMax = 0, gMin = 31, gMax = 0, bMin = 31, bMax = 0, total = 0;
  for (const bin of bins) {
    const r = (bin >> 10) & 31, g = (bin >> 5) & 31, b = bin & 31;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
    total += counts[bin];
  }
  return { bins, total, ranges: [rMax - rMin, gMax - gMin, bMax - bMin] };
}

function splitBox(box, counts) {
  const channel = box.ranges[0] >= box.ranges[1] && box.ranges[0] >= box.ranges[2] ? 0 : box.ranges[1] >= box.ranges[2] ? 1 : 2;
  const shift = channel === 0 ? 10 : channel === 1 ? 5 : 0;
  const sorted = box.bins.slice().sort((left, right) => ((left >> shift) & 31) - ((right >> shift) & 31));
  const half = box.total / 2;
  let accumulated = 0, split = 1;
  for (let index = 0; index < sorted.length - 1; index++) {
    accumulated += counts[sorted[index]];
    if (accumulated >= half) { split = index + 1; break; }
  }
  return [boxOf(sorted.slice(0, split), counts), boxOf(sorted.slice(split), counts)];
}

function buildPalette(counts) {
  const bins = [];
  for (let bin = 0; bin < LEVELS; bin++) if (counts[bin]) bins.push(bin);
  if (!bins.length) bins.push(0);
  let boxes = [boxOf(bins, counts)];
  while (boxes.length < 256) {
    let best = -1, bestScore = 0;
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      if (box.bins.length < 2) continue;
      const score = Math.max(...box.ranges) * Math.log2(box.total + 1);
      if (score > bestScore) { bestScore = score; best = index; }
    }
    if (best < 0) break;
    const [left, right] = splitBox(boxes[best], counts);
    boxes.splice(best, 1, left, right);
  }
  const colors = [], lookup = new Uint8Array(LEVELS);
  boxes.forEach((box, index) => {
    let r = 0, g = 0, b = 0, total = 0;
    for (const bin of box.bins) {
      const weight = counts[bin];
      r += ((((bin >> 10) & 31) << 3) + 4) * weight;
      g += ((((bin >> 5) & 31) << 3) + 4) * weight;
      b += (((bin & 31) << 3) + 4) * weight;
      total += weight;
      lookup[bin] = index;
    }
    colors.push([Math.min(255, Math.round(r / total)), Math.min(255, Math.round(g / total)), Math.min(255, Math.round(b / total))]);
  });
  while (colors.length < 256) colors.push(colors.at(-1));
  return { colors, lookup };
}

class BitWriter {
  constructor() { this.bytes = []; this.current = 0; this.bits = 0; }
  write(code, size) {
    this.current |= code << this.bits;
    this.bits += size;
    while (this.bits >= 8) {
      this.bytes.push(this.current & 255);
      this.current >>= 8;
      this.bits -= 8;
    }
  }
  finish() {
    if (this.bits > 0) this.bytes.push(this.current & 255);
    return Uint8Array.from(this.bytes);
  }
}

function lzw(indexes, minCodeSize) {
  const clearCode = 1 << minCodeSize, endCode = clearCode + 1;
  const writer = new BitWriter();
  let dictionary = new Map(), codeSize = minCodeSize + 1, nextCode = endCode + 1;
  writer.write(clearCode, codeSize);
  let prefix = indexes[0];
  for (let index = 1; index < indexes.length; index++) {
    const suffix = indexes[index];
    const key = (prefix << 8) | suffix;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    writer.write(prefix, codeSize);
    if (nextCode === 4096) {
      writer.write(clearCode, codeSize);
      dictionary = new Map();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    } else {
      dictionary.set(key, nextCode++);
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    }
    prefix = suffix;
  }
  writer.write(prefix, codeSize);
  writer.write(endCode, codeSize);
  return writer.finish();
}

export function encodeGif(frames, { width, height, delay = 70 }) {
  const counts = histogram(frames);
  const { colors, lookup } = buildPalette(counts);
  const out = [];
  const push = (...values) => { for (const value of values) out.push(value); };
  const u16 = value => out.push(value & 255, (value >> 8) & 255);
  push(71, 73, 70, 56, 57, 97); // GIF89a
  u16(width);
  u16(height);
  push(0xF7, 0x00, 0x00); // global palette, 256 entries
  for (const color of colors) push(color[0], color[1], color[2]);
  push(0x21, 0xFF, 0x0B, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 0x03, 0x01, 0x00, 0x00, 0x00);
  for (const pixels of frames) {
    const indexes = new Uint8Array((pixels.length / 4) | 0);
    for (let index = 0, target = 0; index < pixels.length; index += 4, target++)
      indexes[target] = lookup[binOf(pixels[index], pixels[index + 1], pixels[index + 2])];
    push(0x21, 0xF9, 0x04, 0x04);
    u16(delay);
    push(0x00, 0x00);
    push(0x2C);
    u16(0); u16(0); u16(width); u16(height);
    push(0x00, 0x08);
    const compressed = lzw(indexes, 8);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const chunk = compressed.subarray(offset, offset + 255);
      push(chunk.length);
      for (const value of chunk) push(value);
    }
    push(0x00);
  }
  push(0x3B);
  return Uint8Array.from(out);
}
