import * as cad from "@classcad/smlibwasm";
import { readFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { inside } from "./files.js";

export const kernelName = `SMLib / smlibwasm ${cad.version}`;
const vector = (v) => [v.x, v.y, v.z];
export function readShape(bytes, name) {
  return cad.fromFile(bytes, name);
}
export const saveShape = (shape) =>
  Buffer.from(cad.toSmb(shape, { ascii: false }));
export function buildShape(
  source,
  parameters,
  filename,
  assets = {},
  onRead = () => {},
  root = dirname(filename),
) {
  const require = createRequire(filename);
  for (const file of Object.keys(require.cache))
    if (file.startsWith(dirname(filename) + sep)) delete require.cache[file];
  const api = {
    ...cad,
    edit: editShape,
    readModel: (name) => {
      const bytes = assets[name] || readFileSync(inside(root, name));
      onRead(name, bytes);
      assets[name] = bytes;
      return readShape(bytes, name);
    },
  };
  const fn = new Script(
    `(function(parameters,cad,require,__filename,__dirname){\n${source}\nif(typeof build !== 'function') throw new Error('建模源码必须定义 build(parameters, cad) 函数');\nreturn build(parameters,cad);\n})`,
    { filename },
  ).runInThisContext();
  return fn(parameters, api, require, filename, dirname(filename));
}
function select(part, kind, selector = {}) {
  let list = kind === "faces" ? part.faces() : part.edges();
  if (selector.geomType) list = list.ofType(selector.geomType);
  if (selector.parallelTo)
    list = list.parallelTo(new cad.Axis([0, 0, 0], selector.parallelTo));
  if (selector.facing) list = list.facing(selector.facing);
  if (selector.position) {
    if (
      !["top", "bottom", "front", "back", "left", "right"].includes(
        selector.position,
      )
    )
      throw new Error("不支持的几何选择条件");
    list = list[selector.position]();
  }
  if (selector.nearest)
    list = list.minBy(
      (item) =>
        Math.hypot(
          ...vector(item.center()).map(
            (value, i) => value - selector.nearest[i],
          ),
        ),
      1e-7,
    );
  if (!list.length) throw new Error("没有找到匹配的面或边，请重新查询几何");
  if (selector.one && list.length !== 1)
    throw new Error("几何选择不唯一，请缩小查询范围");
  return list;
}
const values = (input, parameters) => {
  if (Array.isArray(input)) return input.map((v) => values(v, parameters));
  if (input && typeof input === "object") {
    if (
      Object.keys(input).length === 1 &&
      typeof input.parameter === "string"
    ) {
      if (!Object.hasOwn(parameters, input.parameter))
        throw new Error(`参数不存在：${input.parameter}`);
      return parameters[input.parameter];
    }
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, values(v, parameters)]),
    );
  }
  return input;
};
function placed(shape, spec) {
  if (spec.rotate)
    shape = shape.rotate(
      new cad.Axis([0, 0, 0], spec.rotate.axis),
      spec.rotate.angle,
    );
  if (spec.center) shape = shape.translate(spec.center);
  return shape;
}
function primitive(spec) {
  let shape;
  switch (spec.shape || spec.op) {
    case "box":
      shape = cad.Box(...spec.size);
      break;
    case "cylinder":
      shape = cad.Cylinder(spec.radius, spec.height);
      break;
    case "sphere":
      shape = cad.Sphere(spec.radius);
      break;
    case "cone":
      shape = cad.Cone(spec.bottomRadius, spec.topRadius, spec.height);
      break;
    case "torus":
      shape = cad.Torus(spec.majorRadius, spec.minorRadius);
      break;
    case "extrude": {
      const p = spec.profile;
      const sketch =
        p.shape === "circle"
          ? cad.Circle(p.radius)
          : p.shape === "polygon"
            ? cad.Polygon(...p.points)
            : cad.Rectangle(...p.size);
      shape = sketch.extrude(spec.amount);
      break;
    }
    default:
      throw new Error("不支持的建模操作");
  }
  return placed(shape, spec);
}
export function editShape(part, operations, parameters = {}) {
  for (const raw of operations) {
    const op = values(raw, parameters);
    if (
      ["box", "cylinder", "sphere", "cone", "torus", "extrude"].includes(op.op)
    ) {
      const next = primitive(op);
      if (op.mode && !["cut", "fuse", "intersect"].includes(op.mode))
        throw new Error("不支持的实体组合方式");
      part = part ? part[op.mode || "fuse"](next) : next;
      continue;
    }
    if (!part) throw new Error("请先创建实体");
    switch (op.op) {
      case "cut":
      case "fuse":
      case "intersect":
        part = part[op.op](primitive(op.tool));
        break;
      case "fillet":
        part = part.fillet(select(part, "edges", op.edges), op.radius);
        break;
      case "chamfer":
        part = part.chamfer(select(part, "edges", op.edges), op.distance);
        break;
      case "shell":
        part = part.shell(
          op.thickness,
          op.faces ? select(part, "faces", op.faces) : undefined,
        );
        break;
      case "offset":
        part = part.offset(op.distance);
        break;
      case "move_faces":
        part = part.moveFaces(select(part, "faces", op.faces), op.by);
        break;
      case "offset_faces":
        part = part.offsetFaces(select(part, "faces", op.faces), op.distance);
        break;
      case "remove_faces":
        part = part.removeFaces(select(part, "faces", op.faces));
        break;
      case "remove_fillets":
        part = part.removeFillets(select(part, "faces", op.faces));
        break;
      case "translate":
        part = part.translate(op.by);
        break;
      case "rotate":
        part = part.rotate(
          new cad.Axis(op.origin || [0, 0, 0], op.axis),
          op.angle,
        );
        break;
      case "mirror":
        part = part.mirror(
          new cad.Plane(op.origin || [0, 0, 0], null, op.normal),
        );
        break;
      default:
        throw new Error(`不支持的建模操作：${op.op}`);
    }
  }
  return part;
}
export function normalizeOperations(operations, shape, revision) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 100
  )
    throw new Error("请提供 1 至 100 个建模操作");
  return operations.map((input) => {
    const op = structuredClone(input);
    for (const [field, kind] of [
      ["faces", "faces"],
      ["edges", "edges"],
    ]) {
      if (typeof op[field] !== "string") continue;
      const match = /^v(\d+):(faces|edges):(\d+)$/.exec(op[field]);
      if (!match || Number(match[1]) !== revision || match[2] !== kind)
        throw new Error("几何引用已过期，请重新查询当前版本");
      const item = shape?.[kind]()[Number(match[3])];
      if (!item) throw new Error("几何引用不存在，请重新查询当前版本");
      op[field] = {
        geomType: item.geomType,
        nearest: vector(item.center()),
        one: true,
      };
    }
    return op;
  });
}
export function editSource(source, operations, revision) {
  const name = `build_before_v${revision + 1}`;
  return `${source || "function build(parameters, cad) { return null; }"}\n\nconst ${name} = build;\nbuild = function(parameters, cad) {\n  return cad.edit(${name}(parameters, cad), ${JSON.stringify(operations, null, 2)}, parameters);\n};\n`;
}
export function queryShape(shape, revision, kind = "faces", selector = {}) {
  if (!["faces", "edges", "solids"].includes(kind))
    throw new Error("不支持的几何查询类型");
  const all = shape[kind](),
    picked = kind === "solids" ? all : select(shape, kind, selector);
  return picked.map((item) => {
    const index = all.findIndex((candidate) => candidate.equals(item));
    const box = item.bbox();
    const result = {
      id: `v${revision}:${kind}:${index}`,
      type: item.geomType || "solid",
      center: vector(item.center()),
      bounds: { min: vector(box.min), max: vector(box.max) },
    };
    if (kind === "faces") {
      result.area = item.area;
      if (item.geomType === "plane") result.normal = vector(item.normalAt());
    }
    if (kind === "edges") result.length = item.length;
    if (kind === "solids") result.volume = item.volume;
    if (
      ["circle", "cylinder", "sphere", "torus", "cone"].includes(item.geomType)
    )
      result.radius = item.radius;
    return result;
  });
}
export function describeShape(shape) {
  if (
    !(shape instanceof cad.Part) ||
    !shape.isValid() ||
    !shape.solids().length ||
    !Number.isFinite(shape.volume) ||
    shape.volume <= 0
  )
    throw new Error("模型必须包含有效的封闭实体；当前版本未被覆盖");
  const box = shape.bbox(),
    size = vector(box.size);
  const metrics = {
    sizeX: size[0],
    sizeY: size[1],
    sizeZ: size[2],
    volume: shape.volume,
    solidCount: shape.solids().length,
    faceCount: shape.faces().length,
    valid: true,
  };
  const preview = previewShape(shape);
  const views = cad
    .drawingViews(shape, ["top", "front", "right"])
    .map((view) => ({
      name: view.name.toUpperCase(),
      paths: [
        [false, view.visible],
        [true, view.hidden],
      ].flatMap(([hidden, group]) =>
        group.map((edge) => ({
          hidden,
          points: Array.from(
            { length: edge.geomType === "line" ? 2 : 49 },
            (_, i) =>
              vector(
                edge.pointAt(i / ((edge.geomType === "line" ? 2 : 49) - 1)),
              ).slice(0, 2),
          ),
        })),
      ),
    }));
  return {
    metrics,
    ...preview,
    views,
    projectionVersion: 3,
    kernel: kernelName,
  };
}

export function previewShape(shape) {
  const size = vector(shape.bbox().size);
  const raw = shape.mesh(
    Math.max(0.01, Math.max(...size) * 0.0003),
    (0.15 * 180) / Math.PI,
  );
  if (raw.triangles.length / 3 > 500000)
    throw new Error("预览网格超过 50 万三角形，请简化模型");
  // SMLib shares positions across BREP faces, but its normals belong to triangle
  // corners. Split vertices at normal discontinuities to keep planar faces flat
  // and curved faces smooth, without averaging across sharp CAD boundaries.
  const vertices = [],
    normals = [],
    triangles = [],
    indices = new Map();
  const cornerNormals = raw.normals?.length === raw.triangles.length * 3;
  for (let i = 0; i < raw.triangles.length; i += 3) {
    const points = Array.from(raw.triangles.slice(i, i + 3), (index) =>
      Array.from(raw.vertices.slice(index * 3, index * 3 + 3)),
    );
    const a = points[1].map((v, axis) => v - points[0][axis]),
      b = points[2].map((v, axis) => v - points[0][axis]);
    const cross = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.hypot(...cross) || 1;
    const triangle = [];
    for (let corner = 0; corner < 3; corner++) {
      const normal = cornerNormals
        ? Array.from(raw.normals.slice((i + corner) * 3, (i + corner + 1) * 3))
        : cross.map((v) => v / length);
      const key = `${raw.triangles[i + corner]}:${normal.join(",")}`;
      if (!indices.has(key)) {
        indices.set(key, vertices.length);
        vertices.push(points[corner]);
        normals.push(normal);
      }
      triangle.push(indices.get(key));
    }
    triangles.push(triangle);
  }
  const edges = shape
    .edges({ seams: true })
    .map((e) =>
      Array.from({ length: e.geomType === "line" ? 2 : 33 }, (_, i) =>
        vector(e.pointAt(i / ((e.geomType === "line" ? 2 : 33) - 1))),
      ),
    );
  return { mesh: { vertices, triangles, normals }, edges, previewVersion: 1 };
}
export function exportShape(shape, format) {
  if (format === "smb") return saveShape(shape);
  if (format === "step") {
    const text = cad.toStep(shape),
      back = cad.fromStep(text);
    try {
      if (
        !back.isValid() ||
        Math.abs(back.volume - shape.volume) >
          Math.max(0.001, shape.volume * 1e-6)
      )
        throw new Error("STEP 回读校验失败");
    } finally {
      back.dispose();
    }
    return Buffer.from(text);
  }
  if (format === "stl") return Buffer.from(cad.toStl(shape));
  throw new Error("不支持的导出格式");
}
