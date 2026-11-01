import * as cad from "@classcad/smlibwasm";
import { readFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { inside } from "./files.js";
import { validate, operationSchema } from "../shared/cad-schema.js";
import {
  select,
  bindReference,
  direction,
  topologyItems,
} from "./inspection.js";
export {
  queryShape,
  modelScope,
  measureShape,
  checkShape,
  describeReference,
} from "./inspection.js";

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
  checkpoint,
  log = (...args) => console.log(...args),
) {
  const require = createRequire(filename);
  for (const file of Object.keys(require.cache))
    if (file.startsWith(dirname(filename) + sep)) delete require.cache[file];
  const api = {
    ...cad,
    log,
    edit: (part, operations, parameters) =>
      editShape(part, operations, parameters, { readModel: api.readModel, checkpoint }),
    checkpoint: (part, label = "") => checkpoint ? checkpoint(part, label) : part,
    readModel: (name) => {
      const bytes = assets[name] || readFileSync(inside(root, name));
      onRead(name, bytes);
      assets[name] = bytes;
      return readShape(bytes, name);
    },
  };
  const fn = new Script(
    `(function(parameters,cad,require,__filename,__dirname,console){\n${source}\nif(typeof build !== 'function') throw new Error('建模源码必须定义 build(parameters, cad) 函数');\nreturn build(parameters,cad);\n})`,
    { filename, lineOffset: -1 },
  ).runInThisContext();
  return fn(parameters, api, require, filename, dirname(filename),
    Object.assign(Object.create(console), { log, info: log, warn: log, error: log, debug: log }));
}
export function values(input, parameters = {}) {
  if (Array.isArray(input)) return input.map((v) => values(v, parameters));
  if (input && typeof input === "object") {
    if (
      Object.keys(input).length === 1 &&
      typeof input.parameter === "string"
    ) {
      if (!Object.hasOwn(parameters, input.parameter))
        throw new Error(`参数不存在 / missing parameter: ${input.parameter}`);
      return parameters[input.parameter];
    }
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, values(v, parameters)]),
    );
  }
  return input;
}
function placed(shape, spec) {
  if (spec.rotate) {
    direction(spec.rotate.axis);
    shape = shape.rotate(
      new cad.Axis([0, 0, 0], spec.rotate.axis),
      spec.rotate.angle,
    );
  }
  if (spec.center) shape = shape.translate(spec.center);
  return shape;
}
function profile(spec) {
  let sketch;
  switch (spec.shape) {
    case "circle":
      sketch = cad.Circle(spec.radius);
      break;
    case "rectangle":
      sketch = cad.Rectangle(...spec.size);
      break;
    case "polygon":
      sketch = cad.Polygon(...spec.points);
      break;
    default:
      throw new Error("不支持的轮廓 / unsupported profile");
  }
  if (spec.plane) sketch = sketch.on(cad.Plane[spec.plane]);
  return placed(sketch, spec);
}
function path(spec) {
  switch (spec.shape) {
    case "line":
      return cad.Line(spec.start, spec.end);
    case "polyline":
      return cad.Polyline(...spec.points, { close: spec.closed ?? false });
    case "spline":
      return cad.Spline(...spec.points);
    case "arc":
      return cad.ThreePointArc(spec.start, spec.through, spec.end);
    case "helix":
      if (spec.direction) direction(spec.direction);
      return cad.Helix(spec.pitch, spec.height, spec.radius, {
        center: spec.center,
        direction: spec.direction,
        leftHanded: spec.leftHanded,
      });
    default:
      throw new Error("不支持的路径 / unsupported path");
  }
}
function primitive(spec, context) {
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
    case "extrude":
      if (!spec.amount)
        throw new Error("拉伸量不能为零 / extrusion amount must be nonzero");
      shape = profile(spec.profile).extrude(spec.amount);
      break;
    case "revolve":
      direction(spec.axis);
      if (!spec.angle)
        throw new Error(
          "旋转成型角度不能为零 / revolution angle must be nonzero",
        );
      shape = profile(spec.profile).revolve(
        new cad.Axis(spec.origin || [0, 0, 0], spec.axis),
        spec.angle,
      );
      break;
    case "loft":
      shape = cad.loft(spec.sections.map(profile), {
        ruled: spec.ruled,
        smooth: spec.smooth,
        closed: spec.closed,
      });
      break;
    case "sweep":
      shape = cad.sweep(profile(spec.profile), path(spec.path), {
        orient: spec.orient,
        translational: spec.translational,
        twist: spec.twist,
      });
      break;
    case "import":
      if (!context.readModel)
        throw new Error(
          "资源导入需要任务工作目录 / import requires task context",
        );
      shape = context.readModel(spec.file);
      break;
    default:
      throw new Error("不支持的建模操作 / unsupported modeling operation");
  }
  if (!(shape instanceof cad.Part))
    throw new Error("操作必须生成实体 / operation must produce a solid Part");
  return placed(shape, spec);
}
const primitiveOps = new Set([
  "box",
  "cylinder",
  "sphere",
  "cone",
  "torus",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "import",
]);
function applyOperation(part, op, base, context) {
  if (primitiveOps.has(op.op)) {
    const next = primitive(op, context);
    return part ? part[op.mode || "fuse"](next) : next;
  }
  if (!part) throw new Error("请先创建实体 / create a solid first");
  switch (op.op) {
    case "cut":
    case "fuse":
    case "intersect":
      return part[op.op](primitive(op.tool, context));
    case "fillet":
      return part.fillet(select(part, "edges", op.edges, base), op.radius);
    case "chamfer":
      return part.chamfer(select(part, "edges", op.edges, base), op.distance);
    case "shell":
      return part.shell(
        op.thickness,
        op.faces ? select(part, "faces", op.faces, base) : undefined,
      );
    case "offset":
      return part.offset(op.distance);
    case "move_faces":
      return part.moveFaces(select(part, "faces", op.faces, base), op.by);
    case "offset_faces":
      return part.offsetFaces(
        select(part, "faces", op.faces, base),
        op.distance,
      );
    case "remove_faces":
      return part.removeFaces(select(part, "faces", op.faces, base));
    case "remove_fillets":
      return part.removeFillets(select(part, "faces", op.faces, base));
    case "translate":
      return part.translate(op.by);
    case "rotate":
      direction(op.axis);
      return part.rotate(
        new cad.Axis(op.origin || [0, 0, 0], op.axis),
        op.angle,
      );
    case "mirror":
      direction(op.normal);
      return part.mirror(
        new cad.Plane(op.origin || [0, 0, 0], null, op.normal),
      );
    case "linear_pattern":
    case "circular_pattern": {
      if (op.op === "linear_pattern") direction(op.step);
      else {
        direction(op.axis);
        if (!op.angle)
          throw new Error("阵列角度不能为零 / pattern angle must be nonzero");
      }
      const seed = op.tool ? primitive(op.tool, context) : part;
      let copies = seed;
      for (let i = 1; i < op.count; i++) {
        const copy =
          op.op === "linear_pattern"
            ? seed.translate(op.step.map((v) => v * i))
            : seed.rotate(
                new cad.Axis(op.origin || [0, 0, 0], op.axis),
                op.angle * i,
              );
        copies = copies.fuse(copy);
      }
      if (!op.tool && op.mode && op.mode !== "fuse")
        throw new Error(
          "切除或求交阵列需提供 tool / cut/intersect patterns require a tool",
        );
      return op.tool ? part[op.mode || "fuse"](copies) : copies;
    }
    default:
      throw new Error(`不支持的建模操作 / unsupported operation: ${op.op}`);
  }
}
function publicOperation(value) {
  if (Array.isArray(value)) return value.map(publicOperation);
  if (value && typeof value === "object") {
    if (value.$ref) return "resolved-reference";
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, publicOperation(v)]),
    );
  }
  return value;
}
export function editShape(part, operations, parameters = {}, context = {}) {
  const base = part;
  for (const [index, raw] of operations.entries()) {
    try {
      const op = values(raw, parameters);
      validate(publicOperation(op), operationSchema, `operations[${index}]`);
      if (op.target !== undefined) {
        if (!part) throw new Error("请先创建实体 / create a solid first");
        const solids = part.solids();
        const selected = select(part, "solids", op.target, base, solids).one();
        const rest = solids.filter((item) => item !== selected);
        const next = applyOperation(selected, op, base, context);
        part = rest.length ? next.fuse(rest) : next;
      } else part = applyOperation(part, op, base, context);
      // Structured solid operations publish valid solids; UDFs can choose their
      // own meaningful checkpoints instead of publishing open construction.
      if (context.checkpoint && part?.solids().length && part.isValid() && part.volume > 0)
        context.checkpoint(part, "", raw.op);
    } catch (cause) {
      throw Object.assign(
        new Error(
          `第 ${index + 1} 个操作 (${raw.op}) 失败 / operation ${index + 1} failed: ${cause.message}`,
          { cause },
        ),
        { operationIndex: index, operation: raw.op },
      );
    }
  }
  return part;
}
export function normalizeOperations(operations, shape, revision, scope) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 100
  )
    throw new Error("请提供 1 至 100 个建模操作 / provide 1 to 100 operations");
  return operations.map((input, index) => {
    try {
      validate(input, operationSchema, `operations[${index}]`);
      const op = structuredClone(input);
      for (const [field, kind] of [
        ["faces", "faces"],
        ["edges", "edges"],
        ["target", "solids"],
      ]) {
        const bind = (value) =>
          typeof value === "string"
            ? bindReference(value, kind, shape, scope, revision)
            : value;
        if (op[field] !== undefined)
          op[field] = Array.isArray(op[field])
            ? op[field].map(bind)
            : bind(op[field]);
      }
      return op;
    } catch (cause) {
      throw Object.assign(
        new Error(
          `第 ${index + 1} 个操作失败 / operation ${index + 1} failed: ${cause.message}`,
          { cause },
        ),
        { operationIndex: index, operation: input?.op },
      );
    }
  });
}
export function editSource(source, operations, revision) {
  const name = `build_before_v${revision + 1}`;
  return `${source || "function build(parameters, cad) { return null; }"}\n\nconst ${name} = build;\nbuild = async function(parameters, cad) {\n  return cad.edit(await ${name}(parameters, cad), ${JSON.stringify(operations, null, 2)}, parameters);\n};\n`;
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
  return {
    metrics,
    preview: previewShape(shape),
    previewVersion: 3,
    kernel: kernelName,
  };
}

export function previewShape(shape) {
  const size = vector(shape.bbox().size);
  // The public faceMeshes API returns meshes in shape.faces() order, keeping
  // ownership exact without guessing from triangle positions or normals.
  const meshes = cad.faceMeshes(
    shape,
    Math.max(0.01, Math.max(...size) * 0.0003),
    (0.15 * 180) / Math.PI,
  );
  const cornerCount = meshes.reduce(
    (sum, mesh) => sum + mesh.triangles.length,
    0,
  );
  if (cornerCount / 3 > 500000)
    throw new Error("预览网格超过 50 万三角形，请简化模型");
  const positions = new Float32Array(cornerCount * 3);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(cornerCount);
  const faceIndices = new Uint32Array(cornerCount / 3);
  let vertices = 0,
    cursor = 0;
  meshes.forEach((raw, faceIndex) => {
    const corners = new Map();
    for (let i = 0; i < raw.triangles.length; i += 3) {
      let fallback;
      if (!raw.normals) {
        const point = (corner, axis) =>
          raw.vertices[raw.triangles[i + corner] * 3 + axis];
        const a = [0, 1, 2].map((axis) => point(1, axis) - point(0, axis));
        const b = [0, 1, 2].map((axis) => point(2, axis) - point(0, axis));
        const cross = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const length = Math.hypot(...cross) || 1;
        fallback = cross.map((n) => n / length);
      }
      faceIndices[cursor / 3] = faceIndex;
      for (let corner = 0; corner < 3; corner++) {
        const sourceIndex = raw.triangles[i + corner];
        const n = raw.normals
          ? [0, 1, 2].map((axis) => raw.normals[(i + corner) * 3 + axis])
          : fallback;
        const key = `${sourceIndex}:${n.join(",")}`;
        if (!corners.has(key)) {
          corners.set(key, vertices);
          for (let axis = 0; axis < 3; axis++) {
            positions[vertices * 3 + axis] =
              raw.vertices[sourceIndex * 3 + axis];
            normals[vertices * 3 + axis] = n[axis];
          }
          vertices++;
        }
        indices[cursor++] = corners.get(key);
      }
    }
    raw.dispose();
  });
  const brepEdges = topologyItems(shape, "edges");
  const segments = brepEdges.reduce(
    (sum, edge) => sum + (edge.geomType === "line" ? 1 : 32),
    0,
  );
  const edges = new Float32Array(segments * 6);
  const edgeIndices = new Uint32Array(segments);
  let offset = 0;
  for (const [edgeIndex, edge] of brepEdges.entries()) {
    const count = edge.geomType === "line" ? 1 : 32;
    let previous = edge.pointAt(0);
    for (let i = 1; i <= count; i++) {
      const point = edge.pointAt(i / count);
      edges.set(
        [previous.x, previous.y, previous.z, point.x, point.y, point.z],
        offset,
      );
      edgeIndices[offset / 6] = edgeIndex;
      offset += 6;
      previous = point;
    }
  }
  return {
    positions: positions.subarray(0, vertices * 3),
    normals: normals.subarray(0, vertices * 3),
    indices,
    edges,
    faceIndices,
    edgeIndices,
  };
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
