import { object, text } from "./cad-schema.js";

const jsonObject = { type: "object", additionalProperties: true };
const scalar = { type: "number" };
const vector = { type: "array", items: scalar, minItems: 3, maxItems: 3 };
const entity = object({ kind: text, id: text });
const endpoint = object({ role: text, entity });

export const relationshipDefinition = object({
  id: text,
  kind: text,
  endpoints: { type: "array", items: endpoint, minItems: 1, maxItems: 100 },
  parameters: jsonObject,
});

const relationshipUpdate = object({ op: { const: "update" }, id: text, values: jsonObject });
export const relationshipUpdatesSchema = { type: "array", minItems: 1, maxItems: 100, items: relationshipUpdate };

export const relationshipOperationsSchema = {
  type: "array", minItems: 1, maxItems: 100,
  items: { anyOf: [
    object({ op: { const: "define" }, relationship: relationshipDefinition }),
    relationshipUpdate,
    object({ op: { const: "remove" }, id: text }),
  ] },
};

const jointRoles = { parent: "part", child: "part" };
export const relationshipKinds = {
  "assembly.fixed": {
    description: "Bind two existing assembly members in their current relative placement. The child follows the parent when a joint upstream moves.",
    endpointKinds: jointRoles,
    parameters: object({}),
  },
  "assembly.revolute": {
    description: "Bind a child to rotate about an axis attached to its parent. Define at the current pose with origin and direction in world coordinates. An update sets an absolute angle, in degrees. A moved parent carries the axis and its child chain.",
    endpointKinds: jointRoles,
    parameters: object({ origin: vector, axis: vector, angle: scalar,
      limits: object({ min: scalar, max: scalar }) }, ["origin", "axis", "angle"]),
    values: object({ angle: scalar }),
  },
};
