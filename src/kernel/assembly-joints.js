import * as cad from "@classcad/smlibwasm";
import { Assembly, assembly } from "./assembly.js";
import { compareGeometry } from "./model.js";
import { solidNames, setSolidNames } from "./naming.js";
import { direction } from "./inspection.js";
import { localizedError } from "../shared/errors.js";

const partId = (joint, role) => joint.endpoints.find(endpoint => endpoint.role === role).entity.id;
const vector = value => [value.x, value.y, value.z];
const partMap = shape => new Map(shape instanceof Assembly ? shape.parts.map(part => [part.id, part.shape]) : []);
const jointError = (joint, code, zh, en, details) => Object.assign(localizedError(zh, en, ` (${joint.id})`), {
  code, details: { relationshipId: joint.id, ...details },
});

function checkAngle(joint, angle) {
  const { limits } = joint.parameters;
  if (limits && (angle < limits.min || angle > limits.max))
    throw jointError(joint, "JOINT_LIMIT", "转角超出关节限位", "angle is outside the joint limits", { angle, limits });
}

function define(shape, joint) {
  const parts = partMap(shape);
  const missing = joint.endpoints.filter(({ entity }) => !parts.has(entity.id)).map(({ entity }) => entity.id);
  if (missing.length) throw jointError(joint, "RELATIONSHIP_ENDPOINT_MISSING",
    "找不到关节连接的装配零件", "assembly member for this joint was not found", { partIds: missing });
  if (joint.kind === "assembly.fixed") return joint;
  const { angle, axis, limits } = joint.parameters;
  if (limits && limits.min > limits.max)
    throw jointError(joint, "JOINT_LIMITS_INVALID", "关节限位下限不能大于上限", "joint minimum angle exceeds its maximum", { limits });
  checkAngle(joint, angle);
  return { ...joint, parameters: { ...joint.parameters, axis: direction(axis) } };
}

function validateGraph(joints) {
  const incoming = new Map();
  for (const joint of joints) {
    const child = partId(joint, "child");
    if (incoming.has(child)) throw jointError(joint, "JOINT_MULTIPLE_PARENTS",
      "零件不能通过多个关节连接到上游", "an assembly member can only have one incoming joint", { partId: child });
    incoming.set(child, joint);
  }
  for (const joint of joints) {
    const seen = new Set([partId(joint, "child")]);
    let parent = partId(joint, "parent");
    while (incoming.has(parent)) {
      if (seen.has(parent)) throw jointError(joint, "JOINT_CYCLE",
        "关节连接形成闭环", "the assembly joints must not form a cycle", { partId: parent });
      seen.add(parent);
      parent = partId(incoming.get(parent), "parent");
    }
  }
}

function update(shape, joint, joints, { angle }) {
  checkAngle(joint, angle);
  const delta = angle - joint.parameters.angle;
  if (delta === 0) return { shape, relationships: joints };

  const moved = new Set([partId(joint, "child")]);
  const children = Map.groupBy(joints, item => partId(item, "parent"));
  for (const part of moved) {
    for (const childJoint of children.get(part) ?? []) {
      if (childJoint.issue) throw jointError(childJoint, "RELATIONSHIP_REBIND_REQUIRED",
        "请先复核下游关节", "rebind the downstream joint before changing this pose", { issue: childJoint.issue });
      moved.add(partId(childJoint, "child"));
    }
  }
  const location = cad.Location.about(new cad.Axis(joint.parameters.origin, joint.parameters.axis), delta);
  const posed = assembly(shape.parts.map(part => moved.has(part.id)
    ? { ...part, shape: setSolidNames(part.shape.moved(location), solidNames(part.shape)) } : part));
  return {
    shape: posed,
    relationships: joints.map(item => {
      if (item.id === joint.id) return { ...item, parameters: { ...item.parameters, angle } };
      if (item.kind !== "assembly.revolute" || !moved.has(partId(item, "parent"))) return item;
      return { ...item, parameters: { ...item.parameters, origin: vector(location.mul(item.parameters.origin)),
        axis: vector(location.rotateVector(item.parameters.axis)) } };
    }),
  };
}

function reconcile(before, after, joints) {
  const previous = partMap(before), current = partMap(after), changes = new Map();
  function partChange(id) {
    if (changes.has(id)) return changes.get(id);
    const base = previous.get(id), target = current.get(id);
    let change = null;
    if (!target) change = "ENDPOINT_MISSING";
    else if (base !== target) {
      const diff = base && compareGeometry(base, target);
      const tolerance = Math.max(1, base?.volume ?? 0, target.volume) * 1e-8;
      if (!diff || (diff.added?.volume ?? 0) > tolerance || (diff.removed?.volume ?? 0) > tolerance)
        change = "ENDPOINT_GEOMETRY_CHANGED";
    }
    changes.set(id, change);
    return change;
  }
  return joints.map(joint => {
    const endpoints = joint.endpoints.flatMap(({ role, entity }) => {
      const code = partChange(entity.id) ?? joint.issue?.endpoints.find(endpoint => endpoint.role === role)?.code;
      return code ? [{ role, entity, code }] : [];
    });
    return endpoints.length ? { ...joint, issue: { code: "REBIND_REQUIRED", endpoints } } : joint;
  });
}

export const assemblyJoints = {
  kinds: ["assembly.fixed", "assembly.revolute"],
  define, validateGraph, update, reconcile,
};
