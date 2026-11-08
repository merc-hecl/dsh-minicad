import { Color } from "three/src/math/Color.js";

// Encode sRGB as packed RGB + 1 so zero means no explicit color.
export function packedColor(color) {
  if (color == null) return 0;
  if (typeof color === "string") {
    const name = color.toLowerCase().replaceAll(" ", "");
    if (Object.hasOwn(Color.NAMES, name)) return Color.NAMES[name] + 1;
    const hex = color.replace(/^#+/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16) + 1;
    if (/^[0-9a-f]{3}$/i.test(hex)) return parseInt([...hex].map(c => c + c).join(""), 16) + 1;
    return 0;
  }
  const [r, g, b] = [color[0], color[1], color[2]];
  const scale = Math.max(r, g, b) > 1 ? 1 : 255;
  const byte = value => Math.round(Math.max(0, Math.min(255, value * scale)));
  return ((byte(r) << 16) | (byte(g) << 8) | byte(b)) + 1;
}

export function colorHex(color) {
  const packed = packedColor(color);
  return packed ? `#${(packed - 1).toString(16).padStart(6, "0").toUpperCase()}` : null;
}
