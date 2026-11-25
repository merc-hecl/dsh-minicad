import { localizedError } from "../shared/errors.js";
import { object, text, validate } from "../shared/cad-schema.js";
import { relationshipDefinition, relationshipKinds, relationshipOperationsSchema } from "../shared/relationships.js";
import { assemblyJoints } from "./assembly-joints.js";

const handlers = new Map(assemblyJoints.kinds.map(kind => [kind, assemblyJoints]));
const issueSchema = object({ code: text, endpoints: { type: "array", items: object({
  role: text, entity: object({ kind: text, id: text }), code: text,
}) } });

function relationError(id, code, zh, en) {
  return Object.assign(localizedError(zh, en, ` (${id})`), { code, details: { relationshipId: id } });
}

function checkDefinition(relationship) {
  validate(relationship, relationshipDefinition, "relationship");
  const { id, kind, endpoints, parameters } = relationship;
  if (!handlers.has(kind)) throw relationError(id, "RELATIONSHIP_KIND_UNKNOWN", "未知的关系类型", "unknown relationship kind");
  const definition = relationshipKinds[kind];
  const roles = new Map(endpoints.map(endpoint => [endpoint.role, endpoint.entity.kind]));
  if (roles.size !== endpoints.length || roles.size !== Object.keys(definition.endpointKinds).length ||
      Object.entries(definition.endpointKinds).some(([role, kind]) => roles.get(role) !== kind))
    throw relationError(id, "RELATIONSHIP_ENDPOINTS_INVALID", "关系端点不符合该类型的定义", "endpoints do not match the relationship kind");
  validate(parameters, definition.parameters, "relationship.parameters");
  return handlers.get(kind);
}

function byHandler(relationships) {
  return Map.groupBy(relationships, relationship => handlers.get(relationship.kind));
}

export function importRelationships(shape, relationships) {
  validate(relationships, { type: "array", items: { type: "object" } }, "relationships");
  const ids = new Set();
  const imported = relationships.map(({ issue, ...relationship }) => {
    const handler = checkDefinition(relationship);
    const { id } = relationship;
    if (ids.has(id)) throw relationError(id, "RELATIONSHIP_ID_DUPLICATE", "关系 ID 重复", "duplicate relationship ID");
    ids.add(id);
    if (issue === undefined) return handler.define(shape, relationship);
    validate(issue, issueSchema, "relationship.issue");
    return { ...relationship, issue };
  });
  for (const [handler, group] of byHandler(imported)) handler.validateGraph(group);
  return imported;
}

export function reconcileRelationships(before, after, relationships) {
  const updated = new Map();
  for (const [handler, group] of byHandler(relationships))
    for (const relationship of handler.reconcile(before, after, group)) updated.set(relationship.id, relationship);
  return relationships.map(({ id }) => updated.get(id));
}

export function editRelationships(shape, previous, operations) {
  validate(operations, relationshipOperationsSchema, "operations");
  const relationships = new Map(previous.map(relationship => [relationship.id, relationship]));
  for (const operation of operations) {
    if (operation.op === "define") {
      const { relationship } = operation;
      const handler = checkDefinition(relationship);
      relationships.set(relationship.id, handler.define(shape, relationship));
      handler.validateGraph([...relationships.values()].filter(item => handlers.get(item.kind) === handler));
      continue;
    }
    const item = relationships.get(operation.id);
    if (!item) throw relationError(operation.id, "RELATIONSHIP_MISSING", "关系不存在", "relationship not found");
    if (operation.op === "remove") {
      relationships.delete(item.id);
      continue;
    }
    if (item.issue) throw Object.assign(relationError(item.id, "RELATIONSHIP_REBIND_REQUIRED",
      "请先重新绑定关系", "rebind this relationship before updating it"), { details: { relationshipId: item.id, issue: item.issue } });
    const contract = relationshipKinds[item.kind].values;
    if (!contract) throw relationError(item.id, "RELATIONSHIP_NOT_ADJUSTABLE", "此关系没有可调整值", "this relationship has no adjustable values");
    validate(operation.values, contract, "relationship.values");
    const handler = handlers.get(item.kind);
    const group = [...relationships.values()].filter(relationship => handlers.get(relationship.kind) === handler);
    const result = handler.update(shape, item, group, operation.values);
    for (const relationship of result.relationships) relationships.set(relationship.id, relationship);
    if (result.shape !== shape) {
      for (const [other, affected] of byHandler([...relationships.values()])) {
        if (other === handler) continue;
        for (const relationship of other.reconcile(shape, result.shape, affected)) relationships.set(relationship.id, relationship);
      }
    }
    shape = result.shape;
  }
  return { shape, relationships: [...relationships.values()] };
}
