import * as cad from "@classcad/smlibwasm";
import { isDeepStrictEqual } from "node:util";
import { assembly } from "./assembly.js";
import { validate } from "../shared/cad-schema.js";
import { localizedError } from "../shared/errors.js";
import { buildingOperationsSchema } from "../shared/building.js";

const tolerance = 1e-6;
const zAxis = new cad.Axis([0, 0, 0], [0, 0, 1]);
const isOpening = element => element?.kind === "opening";

function buildingError(code, zh, en, details) {
  return Object.assign(localizedError(zh, en), { code, details });
}

function wallFrame(wall, level) {
  const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dy);
  if (length <= tolerance)
    throw buildingError("WALL_LENGTH_INVALID", "墙的两个端点必须分开", "Wall endpoints must be distinct", { wallId: wall.id });
  return { length, angle: Math.atan2(dy, dx) * 180 / Math.PI, height: wall.height ?? level.height };
}

function planGeometry(elements, level) {
  const frames = new Map(), openings = new Map();
  for (const element of elements.values()) {
    if (element.kind === "wall") frames.set(element.id, wallFrame(element, level));
  }
  for (const opening of elements.values()) {
    if (!isOpening(opening)) continue;
    const frame = frames.get(opening.wallId);
    const details = { openingId: opening.id, wallId: opening.wallId };
    if (!frame)
      throw buildingError("OPENING_WALL_MISSING", "洞口找不到宿主墙", "Opening requires a host wall", details);
    if (opening.offset + opening.width > frame.length + tolerance || opening.sill + opening.height > frame.height + tolerance)
      throw buildingError("OPENING_OUTSIDE_WALL", "洞口超出宿主墙范围", "Opening extends past the host wall", details);
    const group = openings.get(opening.wallId) ?? [];
    const overlap = group.find(other =>
      Math.min(other.offset + other.width, opening.offset + opening.width) - Math.max(other.offset, opening.offset) > tolerance &&
      Math.min(other.sill + other.height, opening.sill + opening.height) - Math.max(other.sill, opening.sill) > tolerance);
    if (overlap)
      throw buildingError("OPENINGS_OVERLAP", "同一墙上的洞口重叠", "Openings on the same wall overlap", { ...details, otherOpeningId: overlap.id });
    group.push(opening);
    openings.set(opening.wallId, group);
  }
  return { frames, openings };
}

function positionAtWall(shape, wall, frame, level) {
  const oriented = frame.angle ? shape.rotate(zAxis, frame.angle) : shape;
  return oriented.translate(wall.start[0], wall.start[1], level.elevation);
}

function openingBox(opening, thickness) {
  return cad.Box(opening.width, thickness, opening.height)
    .translate(opening.offset + opening.width / 2, 0, opening.sill + opening.height / 2);
}

function buildPart(element, elements, plan, level) {
  const { id, name } = element;
  if (element.kind === "slab") {
    const shape = cad.Polygon(...element.outline).extrude(element.thickness)
      .translate(0, 0, level.elevation - element.thickness);
    return { id, name, shape };
  }
  if (element.kind === "wall") {
    const frame = plan.frames.get(id);
    let shape = cad.Box(frame.length, element.thickness, frame.height)
      .translate(frame.length / 2, 0, frame.height / 2);
    for (const opening of plan.openings.get(id) ?? []) shape = shape.cut(openingBox(opening, element.thickness + 2));
    return { id, name, shape: positionAtWall(shape, element, frame, level) };
  }
  const wall = elements.get(element.wallId), frame = plan.frames.get(wall.id);
  const window = element.filling === "window";
  const shape = openingBox(element, Math.min(wall.thickness, window ? 20 : 40));
  return { id, name, shape: positionAtWall(shape, wall, frame, level).colored(window ? "#7EB6CB" : "#A47F62") };
}

export function editBuilding(shape, previous, operations) {
  validate(operations, buildingOperationsSchema, "operations");
  if (shape && !previous)
    throw buildingError("BUILDING_TARGET_OCCUPIED", "请在空模型中开始建筑建模", "Start the building in an empty model");
  const oldElements = new Map((previous?.elements ?? []).map(element => [element.id, element]));
  const elements = new Map(oldElements);
  let level = previous?.level;
  for (const operation of operations) {
    if (operation.op === "set_level") level = operation.level;
    else if (operation.op === "upsert") elements.set(operation.element.id, operation.element);
    else if (!elements.delete(operation.id))
      throw buildingError("BUILDING_ELEMENT_MISSING", "找不到要删除的建筑构件", "Building element to remove was not found", { id: operation.id });
  }
  if (!level) throw buildingError("BUILDING_LEVEL_MISSING", "请先设置楼层标高和墙高", "Set the floor elevation and default wall height");
  const plan = planGeometry(elements, level);
  const oldParts = new Map((shape?.parts ?? []).map(part => [part.id, part]));
  const changed = new Set(), movedWalls = new Set();
  for (const id of new Set([...oldElements.keys(), ...elements.keys()])) {
    const before = oldElements.get(id), after = elements.get(id);
    if (isDeepStrictEqual(before, after)) continue;
    changed.add(id);
    if (isOpening(before)) changed.add(before.wallId);
    if (isOpening(after)) changed.add(after.wallId);
    if (after?.kind === "wall" && (!before || before.kind !== "wall" ||
      !isDeepStrictEqual([before.start, before.end, before.thickness], [after.start, after.end, after.thickness]))) movedWalls.add(id);
  }
  for (const element of elements.values()) {
    if (level.elevation !== previous?.level.elevation ||
      (element.kind === "wall" && element.height === undefined && level.height !== previous?.level.height) ||
      (isOpening(element) && movedWalls.has(element.wallId))) changed.add(element.id);
  }
  const solidElements = [...elements.values()].filter(element => !isOpening(element) || element.filling !== "none");
  const rebuiltPartIds = [], removedPartIds = [...oldParts.keys()].filter(id => !solidElements.some(element => element.id === id));
  const parts = solidElements.map(element => {
    if (!changed.has(element.id) && oldParts.has(element.id)) return oldParts.get(element.id);
    rebuiltPartIds.push(element.id);
    return buildPart(element, elements, plan, level);
  });
  return { shape: assembly(parts), building: { level, elements: [...elements.values()] }, changes: { rebuiltPartIds, removedPartIds } };
}
