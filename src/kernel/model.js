import { localizedError } from "../shared/errors.js";
import { Assembly, assembly, partInfo, inspectFit } from "./assembly.js";
export { Assembly, inspectFit };
import * as cad from "@classcad/smlibwasm";
import { Color } from "three/src/math/Color.js";
import { readFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { inside } from "./files.js";
import { validate, operationSchema } from "../shared/cad-schema.js";
import { PREVIEW_VERSION } from "../shared/preview.js";
import { solidNames, setSolidNames, validName, inheritNames, entityInfo, restoreNames } from "./naming.js";
export { requireNames } from "./naming.js";
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
export function readShape(bytes, name, parts, entities) {
  const shape = cad.fromFile(bytes, name);
  if (parts) {
    const bodies = shape instanceof cad.Part ? [shape] : [...shape];
    if (bodies.length !== parts.length) throw localizedError("零件存储不完整", "incomplete assembly storage");
    return restoreNames(assembly(parts.map((part, i) => ({ ...part, shape: bodies[i] }))), entities);
  }
  if (shape instanceof cad.ShapeList) return restoreNames(assembly(shape.map((body, i) => ({ id: `part-${i + 1}`, name: body.name || "", shape: body }))), entities);
  return restoreNames(shape, entities);
}
export const saveShape = (shape) =>
  Buffer.from(cad.toSmp(shape instanceof Assembly ? shape.parts.map(p => p.shape.named(p.id)) : shape, { ascii: false }));
export function readModel(root, name, assets, onRead) {
  const bytes = assets[name] || readFileSync(inside(root, name));
  onRead(name, bytes);
  assets[name] = bytes;
  return readShape(bytes, name);
}
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
    assembly,
    log,
    edit: (part, operations, parameters) =>
      editShape(part, operations, parameters, { readModel: api.readModel, checkpoint }),
    checkpoint: (part, label = "") => checkpoint ? checkpoint(part, label) : part,
    readModel: (name) => readModel(root, name, assets, onRead),
  };
  const missingBuild = {
    zh: "建模源码必须定义 build(parameters, cad) 函数",
    en: "Model source must define build(parameters, cad)",
  };
  const fn = new Script(
    `(function(parameters,cad,require,__filename,__dirname,console){\n${source}\nif(typeof build !== 'function') throw Object.assign(new Error(${JSON.stringify(missingBuild.zh)}), {localized: ${JSON.stringify(missingBuild)}});\nreturn build(parameters,cad);\n})`,
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
        throw localizedError("参数不存在", "missing parameter", `: ${input.parameter}`);
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
    case "wire":
      sketch = cad.scope(() => {
        const edges = spec.segments.map(segment => segment.shape === "center_arc"
          ? cad.CenterArc(segment.center, segment.radius, segment.startAngle, segment.arcSize)
          : path(segment));
        if (edges.some((edge, i) => !edge.end.isClose(edges[(i + 1) % edges.length].start, cad.TOLERANCE)))
          throw localizedError("轮廓各段必须按顺序首尾相接并闭合", "Profile segments must join in order and form a closed loop");
        return cad.makeFace(new cad.Wire(edges, { sort: false }));
      });
      break;
    default:
      throw localizedError("不支持的轮廓", "unsupported profile");
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
      throw localizedError("不支持的路径", "unsupported path");
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
        throw localizedError("拉伸量不能为零", "extrusion amount must be nonzero");
      shape = profile(spec.profile).extrude(spec.amount);
      break;
    case "revolve":
      direction(spec.axis);
      if (!spec.angle)
        throw localizedError(
          "旋转成型角度不能为零", "revolution angle must be nonzero",
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
        throw localizedError(
          "资源导入需要任务工作目录", "import requires task context",
        );
      shape = context.readModel(spec.file);
      break;
    default:
      throw localizedError("不支持的建模操作", "unsupported modeling operation");
  }
  if (!(shape instanceof cad.Part || shape instanceof Assembly))
    throw localizedError("操作必须生成实体", "operation must produce a solid Part");
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
    const shape = primitive(op, context);
    const next = op.name === undefined ? shape : shape.named(validName(op.name));
    if (!part) return next;
    const result = part[op.mode || "fuse"](next);
    if (op.name !== undefined && result.solids().length === 1) return result.named(validName(op.name));
    return inheritNames(result, op.name !== undefined && (!op.mode || op.mode === "fuse") ? [part, next] : [part]);
  }
  if (!part) throw localizedError("请先创建实体", "create a solid first");
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
    case "rotate_faces": {
      direction(op.axis);
      const location = cad.Location.about(new cad.Axis(op.origin || [0, 0, 0], op.axis), op.angle);
      return part.moveFaces(select(part, "faces", op.faces, base), location);
    }
    case "offset_faces":
      return part.offsetFaces(
        select(part, "faces", op.faces, base),
        op.distance,
      );
    case "remove_faces":
      return part.removeFaces(select(part, "faces", op.faces, base));
    case "remove_fillets":
      return part.removeFillets(select(part, "faces", op.faces, base));
    case "color":
      if (op.color !== null && !/^#[0-9a-f]{6}$/i.test(op.color))
        throw localizedError("颜色必须为 #RRGGBB 或 null", "Color must be #RRGGBB or null");
      return part.colored(op.color, {
        faces: op.faces === undefined ? undefined : select(part, "faces", op.faces, base),
      });
    case "translate":
      return part.translate(op.by);
    case "scale":
      return part.scale(op.factor, op.origin || [0, 0, 0]);
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
          throw localizedError("阵列角度不能为零", "pattern angle must be nonzero");
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
        throw localizedError(
          "切除或求交阵列需提供 tool", "cut/intersect patterns require a tool",
        );
      return op.tool ? part[op.mode || "fuse"](copies) : copies;
    }
    default:
      throw localizedError("不支持的建模操作", "unsupported operation", `: ${op.op}`);
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
function nameEditedShape(previous, next, operation) {
  return ["translate", "rotate", "scale", "mirror", "color"].includes(operation)
    ? setSolidNames(next, solidNames(previous)) : inheritNames(next, [previous]);
}
export function editShape(part, operations, parameters = {}, context = {}) {
  const base = context.referenceBase || part;
  for (const [index, raw] of operations.entries()) {
    try {
      const op = values(raw, parameters);
      validate(publicOperation(op), operationSchema, `operations[${index}]`);
      if (part instanceof Assembly) {
        const selected = part.part(op.part);
        const { part: partId, ...local } = op;
        const next = editShape(selected.shape, [local], {}, { ...context, checkpoint: undefined, referenceBase: base });
        part = assembly(part.parts.map(item => item.id === partId ? { ...item, shape: next,
          ...(op.op === "rename" && next.solids().length === 1 ? { name: validName(op.name) } : {}),
        } : item));
      } else if (op.part !== undefined) {
        throw localizedError("此模型不是多零件模型", "part requires an assembly");
      } else if (op.op === "rename") {
        if (!part) throw localizedError("请先创建实体", "create a solid first");
        const name = validName(op.name), solids = topologyItems(part, "solids"), values = solidNames(part);
        if (op.target === undefined && solids.length !== 1)
          throw localizedError("多个独立实体需用 target 指定待命名实体", "Use target to name one solid in a multi-solid Part");
        const selected = op.target === undefined ? solids[0] : select(part, "solids", op.target, base, solids).one();
        values[solids.indexOf(selected)] = name;
        part = setSolidNames(solids.length === 1 ? part.named(name) : part, values);
      } else if (op.target !== undefined) {
        if (!part) throw localizedError("请先创建实体", "create a solid first");
        const solids = topologyItems(part, "solids");
        const selected = select(part, "solids", op.target, base, solids).one();
        const values = solidNames(part);
        solids.forEach((solid, i) => setSolidNames(solid, [values[i]]));
        const rest = solids.filter((item) => item !== selected);
        const next = nameEditedShape(selected, applyOperation(selected, op, base, context), op.op);
        part = rest.length ? inheritNames(next.fuse(rest), [next, ...rest]) : next;
      } else {
        const previous = part;
        part = applyOperation(part, op, base, context);
        if (previous && !primitiveOps.has(op.op)) nameEditedShape(previous, part, op.op);
      }
      // Structured solid operations publish valid solids; UDFs can choose their
      // own meaningful checkpoints instead of publishing open construction.
      if (context.checkpoint && part?.solids().length && part.isValid() && part.volume > 0)
        context.checkpoint(part, "", raw.op);
    } catch (cause) {
      throw Object.assign(
        localizedError(
          `第 ${index + 1} 个操作 (${raw.op}) 失败：${cause.localized?.zh ?? cause.message}`,
          `Operation ${index + 1} (${raw.op}) failed: ${cause.localized?.en ?? cause.message}`,
        ),
        { cause, operationIndex: index, operation: raw.op },
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
    throw localizedError("请提供 1 至 100 个建模操作", "provide 1 to 100 operations");
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
        localizedError(
          `第 ${index + 1} 个操作失败：${cause.localized?.zh ?? cause.message}`,
          `Operation ${index + 1} failed: ${cause.localized?.en ?? cause.message}`,
        ),
        { cause, operationIndex: index, operation: input?.op },
      );
    }
  });
}
export function editSource(source, operations, revision) {
  const prefix = `build_before_v${revision + 1}`;
  let name = prefix, index = 1;
  while (source?.includes(`const ${name} = build;`)) name = `${prefix}_${++index}`;
  return `${source?.trim() ? source : "function build(parameters, cad) { return null; }"}\n\nconst ${name} = build;\nbuild = async function(parameters, cad) {\n  return cad.edit(await ${name}(parameters, cad), ${JSON.stringify(operations, null, 2)}, parameters);\n};\n`;
}
export function describeShape(shape) {
  if (
    !(shape instanceof cad.Part || shape instanceof Assembly) ||
    !shape.isValid() ||
    !shape.solids().length ||
    !Number.isFinite(shape.volume) ||
    shape.volume <= 0
  )
    throw localizedError("模型必须包含有效的封闭实体；当前版本未被覆盖", "The model must contain valid closed solids. The previous version is preserved.");
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
    parts: partInfo(shape),
    entities: entityInfo(shape),
    preview: previewShape(shape),
    previewVersion: PREVIEW_VERSION,
    kernel: kernelName,
  };
}

// Compare exact saved solids, independent of revision-local face IDs or meshing.
// Added/removed regions describe the base revision relative to the target.
export function compareShapes(base, target) {
  if (base instanceof Assembly || target instanceof Assembly) {
    const a = base instanceof Assembly ? base.material() : base;
    const b = target instanceof Assembly ? target.material() : target;
    try { return compareShapes(a, b); }
    finally { if (a !== base) a.dispose(); if (b !== target) b.dispose(); }
  }
  const describe = operation => {
    const part = operation();
    try {
      return part.solids().length ? describeShape(part) : null;
    } finally {
      part.dispose();
    }
  };
  return {
    added: describe(() => base.cut(target)),
    removed: describe(() => target.cut(base)),
    unchanged: describe(() => base.intersect(target)),
  };
}

// Encode sRGB as packed RGB + 1 so zero means the viewport's default color.
function previewColor(color) {
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

export function previewShape(shape) {
  if (shape instanceof Assembly) {
    const previews = shape.parts.map(p => previewShape(p.shape));
    const lists = { positions: [], normals: [], indices: [], edges: [], faceIndices: [], edgeIndices: [], faceColors: [] };
    let vertex = 0, face = 0, edge = 0;
    previews.forEach((p, i) => {
      for (const name of ["positions", "normals", "edges", "faceColors"]) lists[name].push(p[name]);
      lists.indices.push(p.indices.map(n => n + vertex));
      lists.faceIndices.push(p.faceIndices.map(n => n + face));
      lists.edgeIndices.push(p.edgeIndices.map(n => n + edge));
      vertex += p.positions.length / 3;
      face += p.faceColors.length;
      edge += topologyItems(shape.parts[i].shape, "edges").length;
    });
    if (lists.faceIndices.reduce((n, a) => n + a.length, 0) > 500000) throw localizedError("预览网格超过 50 万三角形", "preview exceeds 500,000 triangles");
    return Object.fromEntries(Object.entries(lists).map(([name, blocks]) => {
      const Type = ["positions", "normals", "edges"].includes(name) ? Float32Array : Uint32Array;
      const array = new Type(blocks.reduce((n, a) => n + a.length, 0));
      let offset = 0;
      for (const block of blocks) { array.set(block, offset); offset += block.length; }
      return [name, array];
    }));
  }
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
    throw localizedError("预览网格超过 50 万三角形，请简化模型", "The preview exceeds 500,000 triangles. Simplify the model.");
  const positions = new Float32Array(cornerCount * 3);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(cornerCount);
  const faceIndices = new Uint32Array(cornerCount / 3);
  const bodyColor = previewColor(shape.color);
  const faceColors = Uint32Array.from(shape.faces(), face => previewColor(face.color) || bodyColor);
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
    faceColors,
  };
}
export function exportShape(shape, format) {
  const parts = shape instanceof Assembly ? shape.parts.map(p => p.shape) : [shape];
  const solids = parts.flatMap(part => {
    const names = solidNames(part);
    return part.solids().map((solid, i) => solid.named(names[i]));
  });
  if (format === "smp") return Buffer.from(cad.toSmp(solids, { ascii: false }));
  if (format === "step") {
    const text = cad.toStep(solids), back = cad.fromStep(text);
    const bodies = back instanceof cad.Part ? [back] : [...back];
    try {
      if (bodies.length !== solids.length || bodies.some((body, i) => !body.isValid() ||
        Math.abs(body.volume - solids[i].volume) > Math.max(0.001, solids[i].volume * 1e-6) ||
        ["min", "max"].some(corner => vector(body.bbox()[corner]).some((v, axis) => Math.abs(v - vector(solids[i].bbox()[corner])[axis]) > 0.001))))
        throw localizedError("STEP 回读校验失败", "STEP round-trip failed");
    } finally { bodies.forEach(body => body.dispose()); }
    return Buffer.from(text);
  }
  if (format === "smb") {
    if (parts.length !== 1) throw localizedError("多零件请导出 SMP 或 STEP", "export an assembly as SMP or STEP");
    return Buffer.from(cad.toSmb(parts[0], { ascii: false }));
  }
  if (format === "stl") return Buffer.from(cad.toStl(parts));
  throw localizedError("不支持的导出格式", "Unsupported export format");
}
