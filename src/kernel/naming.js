import * as cad from "@classcad/smlibwasm";
import { localizedError } from "../shared/errors.js";

// A SMLib Part has one body name, even when it contains disconnected solids.
// Keep independent solid names in revision state rather than overloading face names.
const names = new WeakMap();
export function solidNames(shape) {
  return names.has(shape) ? [...names.get(shape)] : (shape.solids().length === 1 ? [shape.name || ""] : shape.solids().map(() => ""));
}
export function setSolidNames(shape, values) {
  names.set(shape, [...values]);
  return shape;
}
export function namedShape(shape, name, bodyName = name) {
  const result = shape.named(bodyName);
  return setSolidNames(result, shape.solids().length === 1 ? [name] : solidNames(shape));
}
export function validName(name) {
  if (typeof name !== "string" || !name.trim())
    throw localizedError("实体名称不能为空，请按用途命名", "Entity names must be nonempty and describe their purpose");
  return name.trim();
}
export function inheritNames(result, sources) {
  const solids = result.solids();
  const origins = sources.flatMap(shape => {
    const values = solidNames(shape);
    return shape.solids().map((solid, i) => ({ solid, name: values[i] }));
  });
  if (origins.length === 1 && solids.length === 1)
    return setSolidNames(result, [origins[0].name]);
  const matches = solids.map(solid => origins.filter(origin => solid.faces().derivedFrom(origin.solid).length));
  // Split or merged entities require an explicit name; never guess by location.
  return setSolidNames(result, matches.map(found => found.length === 1 &&
    matches.filter(other => other.includes(found[0])).length === 1 ? found[0].name : ""));
}
export function entityInfo(shape) {
  let faceOffset = 0, edgeOffset = 0, index = 0;
  const members = shape instanceof cad.Part ? [{ shape }] : shape.parts || [];
  return members.flatMap(member => {
    const body = member.shape, values = solidNames(body);
    const faces = body.faces(), edges = body.edges().union(body.edges({ seams: true }));
    const result = body.solids().map((solid, i) => {
      const ownedFaces = faces.derivedFrom(solid), ownedEdges = edges.derivedFrom(solid);
      return { index: index++, name: values[i] || "",
        ...(member.id ? { part: member.id, partName: member.name } : {}),
        faces: faces.flatMap((face, j) => ownedFaces.some(item => item.equals(face)) ? [faceOffset + j] : []),
        edges: edges.flatMap((edge, j) => ownedEdges.some(item => item.equals(edge)) ? [edgeOffset + j] : []),
      };
    });
    faceOffset += faces.length; edgeOffset += edges.length;
    return result;
  });
}
export function restoreNames(shape, entities) {
  if (!entities) return shape;
  let index = 0;
  for (const member of shape instanceof cad.Part ? [{ shape }] : shape.parts) {
    const count = member.shape.solids().length;
    setSolidNames(member.shape, entities.slice(index, index + count).map(entity => entity.name));
    index += count;
  }
  return shape;
}
export function requireNames(shape) {
  const missing = entityInfo(shape).filter(entity => !entity.name.trim());
  if (missing.length) throw localizedError(
    `实体必须命名，当前版本未被覆盖。请使用 rename 操作命名实体：${missing.map(entity => entity.index).join(", ")}`,
    `Every solid must be named; the saved revision is preserved. Use rename for solid indices: ${missing.map(entity => entity.index).join(", ")}`,
  );
}
