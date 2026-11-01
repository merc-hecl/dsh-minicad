import {
  defaultIdFormats,
  geometryLabel,
  geometryReference,
} from "../shared/geometry-ids.js";
import * as cad from "@classcad/smlibwasm";
import { createHash } from "node:crypto";
import {
  validate,
  measurementsSchema,
  checksSchema,
  selector as selectorSchema,
} from "../shared/cad-schema.js";

export const vector = (v) => [v.x, v.y, v.z];
// Keep existing edge indices stable; seam edges are appended to the query list.
export function topologyItems(shape, kind) {
  const items = shape[kind]();
  if (kind !== "edges") return items;
  return items.union(shape.edges({ seams: true }));
}
export function direction(input) {
  const length = Math.hypot(...input);
  if (!Number.isFinite(length) || length < 1e-12)
    throw new Error("方向向量不能为零 / direction must be nonzero");
  return input.map((n) => n / length);
}
export const modelScope = (projectId, sourceFile) =>
  createHash("sha256")
    .update(`${projectId}\0${sourceFile}`)
    .digest("hex")
    .slice(0, 24);
const round = (n) => Math.round(n * 1e6) / 1e6;
// Structural checks protect parameter replay; positional nearest-neighbour guessing is never used for IDs.
const topologyCache = new WeakMap();
export function topology(shape) {
  if (topologyCache.has(shape)) return topologyCache.get(shape);
  const signature = JSON.stringify([
    shape.solids().length,
    shape
      .faces()
      .map((f) => [
        f.geomType,
        ...(f.geomType === "plane" ? vector(f.normalAt()).map(round) : []),
      ]),
    shape
      .edges()
      .map((e) => [
        e.geomType,
        ...(e.geomType === "line" ? vector(e.direction).map(round) : []),
      ]),
  ]);
  const hash = createHash("sha256").update(signature).digest("hex");
  topologyCache.set(shape, hash);
  return hash;
}
export function parseReference(id, kind, scope, revision) {
  const match = /^m([a-f0-9]{24}):v(\d+):(faces|edges|solids):(\d+)$/.exec(id);
  if (
    !match ||
    match[1] !== scope ||
    Number(match[2]) !== revision ||
    (kind && match[3] !== kind)
  )
    throw new Error(
      "几何引用已过期或属于其他模型，请重新查询 / stale or foreign geometry reference",
    );
  return { kind: match[3], index: Number(match[4]) };
}
export function bindReference(id, kind, shape, scope, revision) {
  const parsed = parseReference(id, kind, scope, revision);
  if (!shape || !topologyItems(shape, parsed.kind)[parsed.index])
    throw new Error(
      "几何引用不存在，请重新查询 / geometry reference does not exist",
    );
  return { $ref: { ...parsed, topology: topology(shape) } };
}
export function select(part, kind, selector = {}, base = part, items, allowEmpty = false) {
  let list = items || topologyItems(part, kind);
  if (Array.isArray(selector)) {
    let found = new cad.ShapeList();
    for (const item of selector)
      found = found.union(select(part, kind, item, base, list));
    return found;
  }
  if (typeof selector === "string")
    throw new Error(
      "请使用当前模型的查询引用 / resolve query references before editing",
    );
  if (selector.$ref) {
    const ref = selector.$ref;
    if (!base || kind !== ref.kind || topology(base) !== ref.topology)
      throw new Error(
        "模型拓扑已变化，请重新查询 / model topology changed; query again",
      );
    if (kind === "solids" && part === base)
      return new cad.ShapeList(list[ref.index]);
    const original = topologyItems(base, kind)[ref.index];
    if (!original)
      throw new Error("几何引用不存在 / geometry reference does not exist");
    list =
      kind === "solids"
        ? list.filter(
            (solid) =>
              solid.equals(original) ||
              solid.faces().derivedFrom(original).length > 0,
          )
        : list
            .filter((item) => item.equals(original))
            .union(list.derivedFrom(original));
    if (list.length !== 1)
      throw new Error(
        "几何引用已被移除或拆分，请重新查询 / reference removed or split; query again",
      );
    return list;
  }
  if (selector.name) list = list.filter((item) => item.name === selector.name);
  if (selector.geomType) list = list.ofType(selector.geomType);
  if (selector.radius !== undefined) list = list.filter(item =>
    ["circle", "cylinder", "sphere", "torus", "cone"].includes(item.geomType) &&
    Math.abs(item.radius - selector.radius) <= (selector.tolerance ?? 1e-6));
  if (selector.axisDirection) {
    const wanted = direction(selector.axisDirection);
    list = list.filter(item => {
      const axis = naturalAxis(item);
      return axis && Math.abs(Math.abs(axis.direction.reduce((sum, v, i) => sum + v * wanted[i], 0)) - 1) < 1e-6;
    });
  }
  if (selector.through !== undefined || selector.closedWall !== undefined) list = list.filter(item => {
    const hole = cylindricalHole(part, item);
    return hole && (selector.through === undefined || hole.through === selector.through) &&
      (selector.closedWall === undefined || hole.closedWall === selector.closedWall);
  });
  if (selector.parallelTo) {
    direction(selector.parallelTo);
    list = list.parallelTo(new cad.Axis([0, 0, 0], selector.parallelTo));
  }
  if (selector.facing) {
    direction(selector.facing);
    list = list.facing(selector.facing);
  }
  if (selector.position) list = list[selector.position]();
  if (selector.nearest)
    list = list.minBy(
      (item) =>
        Math.hypot(
          ...vector(item.center()).map((v, i) => v - selector.nearest[i]),
        ),
      1e-7,
    );
  if (!list.length && !allowEmpty)
    throw new Error("没有找到匹配的几何，请重新查询 / no matching geometry");
  if (selector.one && list.length !== 1)
    throw new Error(
      "几何选择不唯一，请缩小查询范围 / ambiguous geometry selection",
    );
  return list;
}
export function queryShape(
  shape,
  revision,
  kind = "faces",
  selector = {},
  scope,
  idFormats = defaultIdFormats,
) {
  if (!["faces", "edges", "solids", "holes"].includes(kind))
    throw new Error("不支持的几何查询类型 / unsupported query kind");
  validate(selector, selectorSchema, "selector");
  const topologyKind = kind === "holes" ? "faces" : kind;
  const all = topologyItems(shape, topologyKind);
  const items = kind === "holes" ? all.filter(item => cylindricalHole(shape, item)) : all;
  return select(shape, topologyKind, selector, shape, items, kind === "holes").map((item) => {
    const index = all.findIndex((candidate) => candidate.equals(item));
    return { ...describeItem(item, index, topologyKind, scope, revision, idFormats),
      ...(kind === "holes" ? { hole: cylindricalHole(shape, item) } : {}) };
  });
}
export function describeReference(
  shape,
  id,
  scope,
  revision,
  idFormats = defaultIdFormats,
) {
  const { kind, index } = bindReference(id, null, shape, scope, revision).$ref;
  return {
    kind,
    geometry: describeItem(
      topologyItems(shape, kind)[index],
      index,
      kind,
      scope,
      revision,
      idFormats,
    ),
  };
}
function describeItem(item, index, kind, scope, revision, idFormats) {
  const box = item.bbox();
  const result = {
    id: geometryReference(scope, revision, kind, index),
    ...(kind !== "solids"
      ? { displayId: geometryLabel(kind, index, idFormats) }
      : {}),
    type: item.geomType || "solid",
    name: item.name || null,
    center: vector(item.center()),
    centerMeaning: kind === "faces" ? "area_centroid" : kind === "edges" ? "curve_centroid" : "volume_centroid",
    bounds: { min: vector(box.min), max: vector(box.max) },
  };
  if (kind === "faces") {
    result.area = item.area;
    if (item.geomType === "plane") result.normal = vector(item.normalAt());
  }
  if (kind === "edges") result.length = item.length;
  if (kind === "solids") result.volume = item.volume;
  if (["circle", "cylinder", "sphere", "torus", "cone"].includes(item.geomType))
    result.radius = item.radius;
  const axis = naturalAxis(item);
  if (axis) result.axis = axis;
  if (item.geomType === "circle" || item.geomType === "sphere") result.geometricCenter = naturalCenter(item);
  return result;
}
function naturalAxis(item) {
  if (item instanceof cad.Face && ["cylinder", "cone", "torus", "revolution"].includes(item.geomType))
    return { origin: vector(item.axis.origin), direction: direction(vector(item.axis.direction)) };
  if (item instanceof cad.Edge && item.geomType === "circle")
    return { origin: vector(item.arcCenter), direction: direction(vector(item.normal)) };
  if (item instanceof cad.Edge && item.geomType === "line")
    return { origin: vector(item.start), direction: direction(vector(item.direction)) };
  return null;
}
function naturalCenter(item) {
  if (item instanceof cad.Edge && item.geomType === "circle") return vector(item.arcCenter);
  if (item instanceof cad.Face && item.geomType === "sphere") return vector(item.axis.origin);
  if (item instanceof cad.Face && item.geomType === "cylinder") {
    const { origin, direction: unit } = naturalAxis(item), projections = item.vertices().map(point =>
      vector(point).reduce((sum, v, i) => sum + (v - origin[i]) * unit[i], 0));
    const midpoint = (Math.min(...projections) + Math.max(...projections)) / 2;
    return origin.map((v, i) => v + midpoint * unit[i]);
  }
  throw new Error("中心测量需使用圆边、球面、圆柱面或显式点 / center measurement requires a circle, sphere, cylinder or explicit point");
}
// Cylindrical bore segments, not semantic machining features. Open side cutouts
// stay distinguishable from complete cylindrical walls and through bores.
const boreCache = new WeakMap();
function cylindricalHole(shape, face) {
  if (!(face instanceof cad.Face) || face.geomType !== "cylinder") return null;
  let entries = boreCache.get(shape);
  if (!entries) { entries = []; boreCache.set(shape, entries); }
  const cached = entries.find(entry => entry.face.equals(face));
  if (cached) return cached.result;
  const result = inspectCylindricalHole(shape, face);
  entries.push({ face, result });
  return result;
}
function inspectCylindricalHole(shape, face) {
  const { origin, direction: unit } = naturalAxis(face), point = vector(face.interiorPoint());
  const projection = point.reduce((sum, v, i) => sum + (v - origin[i]) * unit[i], 0);
  const radial = point.map((v, i) => v - origin[i] - projection * unit[i]);
  if (vector(face.normalAt(point)).reduce((sum, v, i) => sum + v * radial[i], 0) >= 0) return null;
  const center = naturalCenter(face), span = face.vertices().map(vertex =>
    vector(vertex).reduce((sum, v, i) => sum + v * unit[i], 0));
  const axialSpan = Math.max(...span) - Math.min(...span);
  const closedWall = Math.abs(face.area - 2 * Math.PI * face.radius * axialSpan) <= Math.max(1e-5, face.area * 1e-6);
  const extent = Math.hypot(...vector(shape.bbox().size)) * 2 + 1;
  const start = center.map((v, i) => v - extent * unit[i]);
  let through = false;
  const clearanceTolerance = Math.max(1e-5, face.radius * 1e-6);
  if (closedWall && shape.raycast(start, unit).length === 0 && face.radius > clearanceTolerance) {
    // An unobstructed centerline alone would incorrectly mark a counterbore's
    // larger diameter as through. Intersect the entire bore cylinder instead.
    let probe = cad.Cylinder(face.radius - clearanceTolerance, extent * 2);
    const axis = [-unit[1], unit[0], 0];
    if (Math.hypot(...axis) > 1e-10)
      probe = probe.rotate(new cad.Axis([0, 0, 0], axis), Math.acos(Math.max(-1, Math.min(1, unit[2]))) * 180 / Math.PI);
    const overlap = shape.intersect(probe.translate(center));
    through = overlap.solids().length === 0;
    overlap.dispose(); probe.dispose();
  }
  return { diameter: face.radius * 2, axis: { origin, direction: unit }, center, axialSpan,
    closedWall, through, clearanceTolerance, meaning: "cylindrical_bore_segment" };
}
function entity(shape, input, scope, revision) {
  const spec =
    typeof input === "string"
      ? {
          kind: parseReference(input, null, scope, revision).kind,
          selector: input,
        }
      : input;
  const selector =
    typeof spec.selector === "string"
      ? bindReference(spec.selector, spec.kind, shape, scope, revision)
      : spec.selector;
  return select(shape, spec.kind, selector).one();
}
function solid(shape, target, scope, revision) {
  return target === undefined
    ? shape
    : entity(shape, { kind: "solids", selector: target }, scope, revision);
}
function orientation(shape, input, scope, revision) {
  if (input.direction) return direction(input.direction);
  const item = entity(shape, input, scope, revision);
  if (item instanceof cad.Face && item.geomType === "plane")
    return vector(item.normalAt());
  if (item instanceof cad.Edge && item.geomType === "line")
    return vector(item.direction);
  if (item instanceof cad.Edge && item.geomType === "circle")
    return vector(item.normal);
  if (["cylinder", "cone", "torus"].includes(item.geomType))
    return vector(item.axis.direction);
  throw new Error(
    "夹角需使用平面、直线、旋转轴或方向向量 / angle requires planes, lines, axes or vectors",
  );
}
function thickness(shape, request) {
  const unit = direction(request.direction),
    point = request.point;
  if (shape.classify(point)[0] === "outside")
    throw new Error(
      "测厚点必须位于实体内或表面 / thickness point must be in or on the solid",
    );
  const box = shape.bbox(),
    extent =
      Math.hypot(...vector(box.size)) * 2 +
      Math.hypot(...point.map((v, i) => v - vector(shape.center())[i])) +
      1;
  const start = point.map((v, i) => v - extent * unit[i]);
  const hits = shape.raycast(start, unit);
  const tolerance = Math.max(1e-7, extent * 1e-9);
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i],
      b = hits[i + 1];
    if (extent < a.distance - tolerance || extent > b.distance + tolerance)
      continue;
    const mid = vector(a.point).map((v, j) => (v + vector(b.point)[j]) / 2);
    if (shape.classify(mid)[0] !== "inside") continue;
    return {
      value: b.distance - a.distance,
      unit: "mm",
      entry: vector(a.point),
      exit: vector(b.point),
      direction: unit,
      method: "local_material_segment",
    };
  }
  throw new Error(
    "方向与表面相切或未找到有效壁厚 / tangent direction or no material segment",
  );
}
function distance(a, b) {
  if (Array.isArray(a))
    return Array.isArray(b)
      ? Math.hypot(...a.map((v, i) => v - b[i]))
      : b.distanceTo(a);
  if (Array.isArray(b)) return a.distanceTo(b);
  if (a instanceof cad.Face) {
    const surface = a.toShell();
    try {
      return surface.distanceTo(b);
    } finally {
      surface.dispose();
    }
  }
  if (b instanceof cad.Face) return distance(b, a);
  if (a instanceof cad.Part || a instanceof cad.Shell) return a.distanceTo(b);
  if (b instanceof cad.Part || b instanceof cad.Shell) return b.distanceTo(a);
  if (a.geomType === "line" && b.geomType === "line") {
    // Exact segment/segment minimum: endpoints plus the interior stationary point.
    const u = a.end.sub(a.start),
      v = b.end.sub(b.start),
      w = a.start.sub(b.start);
    const aa = u.dot(u),
      bb = u.dot(v),
      cc = v.dot(v),
      dd = u.dot(w),
      ee = v.dot(w),
      det = aa * cc - bb * bb;
    let best = Math.min(
      a.distanceTo(b.start),
      a.distanceTo(b.end),
      b.distanceTo(a.start),
      b.distanceTo(a.end),
    );
    if (det > 1e-14 * aa * cc) {
      const s = (bb * ee - cc * dd) / det,
        t = (aa * ee - bb * dd) / det;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
        best = Math.min(
          best,
          a.start.add(u.mul(s)).distanceTo(b.start.add(v.mul(t))),
        );
    }
    return best;
  }
  throw new Error(
    "当前内核 API 不支持两条曲边之间的精确距离；请选面或点 / curved edge pairs require a face or point endpoint",
  );
}
export function measureShape(shape, requests, scope, revision) {
  validate(requests, measurementsSchema, "measurements");
  return requests.map((request) => {
    let value, unit;
    switch (request.kind) {
      case "count": {
        const topologyKind = request.entityKind === "holes" ? "faces" : request.entityKind;
        const all = topologyItems(shape, topologyKind);
        const items = request.entityKind === "holes" ? all.filter(item => cylindricalHole(shape, item)) : all;
        value = select(shape, topologyKind, request.selector || {}, shape, items, true).length;
        unit = "count";
        break;
      }
      case "center_distance": {
        const center = input => input.point || naturalCenter(entity(shape, input, scope, revision));
        value = Math.hypot(...center(request.from).map((v, i) => v - center(request.to)[i]));
        unit = "mm";
        break;
      }
      case "axis_distance": {
        const a = naturalAxis(entity(shape, request.from, scope, revision)), b = naturalAxis(entity(shape, request.to, scope, revision));
        if (!a || !b) throw new Error("轴距测量需使用圆柱面、圆边或直线 / axis distance requires cylinders, circles or lines");
        const u = a.direction, v = b.direction, w = b.origin.map((n, i) => n - a.origin[i]);
        const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]], length = Math.hypot(...cross);
        value = length > 1e-10 ? Math.abs(w.reduce((sum, n, i) => sum + n * cross[i], 0)) / length
          : Math.sqrt(Math.max(0, w.reduce((sum, n) => sum + n*n, 0) - w.reduce((sum, n, i) => sum + n*u[i], 0) ** 2));
        unit = "mm";
        break;
      }
      case "coordinate":
        value = naturalCenter(entity(shape, request.entity, scope, revision))[["x", "y", "z"].indexOf(request.axis)];
        unit = "mm";
        break;
      case "span":
        value = vector(entity(shape, request.entity, scope, revision).bbox().size)[["x", "y", "z"].indexOf(request.axis)];
        unit = "mm";
        break;
      case "distance": {
        const endpoint = (input) =>
          input.point ? input.point : entity(shape, input, scope, revision);
        const a = endpoint(request.from),
          b = endpoint(request.to);
        value = distance(a, b);
        unit = "mm";
        break;
      }
      case "angle": {
        const a = orientation(shape, request.from, scope, revision),
          b = orientation(shape, request.to, scope, revision);
        value =
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                a.reduce((sum, v, i) => sum + v * b[i], 0),
              ),
            ),
          ) *
            180) /
          Math.PI;
        unit = "deg";
        break;
      }
      case "thickness":
        return {
          kind: request.kind,
          ...thickness(solid(shape, request.target, scope, revision), request),
        };
      case "size":
        value = vector(
          solid(shape, request.target, scope, revision).bbox().size,
        )[["x", "y", "z"].indexOf(request.axis)];
        unit = "mm";
        break;
      case "volume":
        value = solid(shape, request.target, scope, revision).volume;
        unit = "mm3";
        break;
      case "area":
        value = (
          request.entity
            ? entity(shape, request.entity, scope, revision)
            : shape
        ).area;
        unit = "mm2";
        break;
      default: {
        const item = entity(shape, request.entity, scope, revision);
        value =
          request.kind === "length"
            ? item.length
            : item.radius * (request.kind === "diameter" ? 2 : 1);
        unit = "mm";
      }
    }
    if (!Number.isFinite(value))
      throw new Error(
        `当前几何不支持此测量 / unsupported measurement: ${request.kind}`,
      );
    return { kind: request.kind, value, unit };
  });
}
export function checkShape(shape, checks, scope, revision) {
  validate(checks, checksSchema, "checks");
  const measured = measureShape(
    shape,
    checks.map((check) => check.measurement),
    scope,
    revision,
  );
  const results = checks.map((check, i) => {
    const { value, unit } = measured[i];
    const min =
      check.min ??
      (check.expected === undefined
        ? -Infinity
        : check.expected - (check.tolerance ?? 1e-6));
    const max =
      check.max ??
      (check.expected === undefined
        ? Infinity
        : check.expected + (check.tolerance ?? 1e-6));
    if (min > max)
      throw new Error("检查下限不能大于上限 / invalid check range");
    return {
      ...measured[i],
      ...(check.name ? { name: check.name } : {}),
      ...(check.basis ? { basis: check.basis } : {}),
      measurement: check.measurement,
      ...(check.expected !== undefined ? { expected: check.expected, tolerance: check.tolerance ?? 1e-6 } : {}),
      index: i,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      unit,
      passed: value >= min && value <= max,
    };
  });
  return { passed: results.every((item) => item.passed), results };
}
