import { localizedError } from "../shared/errors.js";
import * as cad from "@classcad/smlibwasm";
import { namedShape, solidNames, setSolidNames } from "./naming.js";
import { colorHex } from "./colors.js";

// An assembly is a collection, never a Boolean union. IDs belong to the design,
// while face/edge indices remain revision-local like ordinary model references.
export class Assembly {
  constructor(parts) {
    if (!Array.isArray(parts) || !parts.length || parts.length > 100)
      throw localizedError("请提供 1 至 100 个零件", "provide 1–100 parts");
    const ids = new Set();
    this.parts = parts.map(({ id, shape, name = shape?.name || "" }) => {
      if (typeof id !== "string" || !id.trim() || ids.has(id))
        throw localizedError("零件 ID 必须非空且唯一", "part IDs must be nonempty and unique");
      if (typeof name !== "string" || !(shape instanceof cad.Part) || !shape.isValid() || !(shape.volume > 0))
        throw localizedError("零件无效", "invalid part", `: ${id}`);
      ids.add(id);
      return { id, name, shape: namedShape(shape, name, id) };
    });
  }
  part(id) {
    const item = this.parts.find(item => item.id === id);
    if (!item) throw localizedError("零件不存在", "unknown part", `: ${id}`);
    return item;
  }
  translate(...args) { return assembly(this.parts.map(p => ({ ...p, shape: setSolidNames(p.shape.translate(...args), solidNames(p.shape)) }))); }
  rotate(...args) { return assembly(this.parts.map(p => ({ ...p, shape: setSolidNames(p.shape.rotate(...args), solidNames(p.shape)) }))); }
  faces() { return new cad.ShapeList(...this.parts.flatMap(p => [...p.shape.faces()])); }
  edges(options) { return new cad.ShapeList(...this.parts.flatMap(p => [...p.shape.edges(options)])); }
  vertices() { return new cad.ShapeList(...this.parts.flatMap(p => [...p.shape.vertices()])); }
  solids() { return new cad.ShapeList(...this.parts.flatMap(p => [...p.shape.solids()])); }
  bbox() { return this.parts.map(p => p.shape.bbox()).reduce((a, b) => a.union(b)); }
  get volume() { return this.parts.reduce((sum, p) => sum + p.shape.volume, 0); }
  get area() { return this.parts.reduce((sum, p) => sum + p.shape.area, 0); }
  isValid() { return this.parts.every(p => p.shape.isValid()); }
  dispose() { for (const shape of new Set(this.parts.map(p => p.shape))) shape.dispose(); }
  // Boolean material comparisons explicitly operate on the occupied volume.
  material() { return this.parts[0].shape.fuse(this.parts.slice(1).map(p => p.shape)); }
  intersect(other) {
    const material = this.material();
    try { return material.intersect(other); } finally { material.dispose(); }
  }
}

export function assembly(parts) { return new Assembly(parts); }

export function partInfo(shape) {
  if (!(shape instanceof Assembly)) return undefined;
  let face = 0, edge = 0;
  return shape.parts.map(({ id, name, shape }) => {
    const faceCount = shape.faces().length;
    const edgeCount = shape.edges().union(shape.edges({ seams: true })).length;
    const item = { id, name, color: colorHex(shape.color), faceStart: face, faceCount, edgeStart: edge, edgeCount,
      volume: shape.volume, size: [...shape.bbox().size], center: [...shape.bbox().center] };
    face += faceCount; edge += edgeCount;
    return item;
  });
}

export function inspectFit(assembly, pairs, tolerance = 0.001) {
  if (!(assembly instanceof Assembly)) throw localizedError("请先创建多零件模型", "build an assembly first");
  if (!Number.isFinite(tolerance) || tolerance < 0) throw localizedError("公差无效", "invalid tolerance");
  return pairs.map(({ from, to }) => {
    if (from === to) throw localizedError("请选择两个不同零件", "choose two different parts");
    const a = assembly.part(from).shape, b = assembly.part(to).shape;
    const overlap = a.intersect(b);
    try {
      const volume = overlap.solids().length ? overlap.volume : 0;
      const distance = volume > 0 ? 0 : a.distanceTo(b);
      return { from, to, interferenceVolume: volume, distance,
        relation: volume > Math.max(1e-9, tolerance ** 3) ? "interference" : distance <= tolerance ? "contact" : "separated",
        tolerance, distanceUnit: "mm", volumeUnit: "mm3" };
    } finally { overlap.dispose(); }
  });
}
