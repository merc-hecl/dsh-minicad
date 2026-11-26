import { object, text } from "./cad-schema.js";

const length = { type: "number", exclusiveMinimum: 0 };
const coordinate = { type: "number" };
const elementId = { ...text, description: "Stable ID for this building element. The same ID identifies its 3D part when it has one." };
const common = { id: elementId, name: text };
const parameter = object({ parameter: text });

function buildingWrites(number) {
  const planPoint = { type: "array", items: number(coordinate), minItems: 2, maxItems: 2 };
  const level = object({ elevation: number(coordinate), height: number(length) });
  const wall = object({ ...common, kind: { const: "wall" }, start: planPoint, end: planPoint, thickness: number(length),
    height: number({ ...length, description: "Omit to use the level height." }) }, ["id", "name", "kind", "start", "end", "thickness"]);
  const slab = object({ ...common, kind: { const: "slab" }, outline: { type: "array", items: planPoint, minItems: 3, maxItems: 100 }, thickness: number(length) });
  const opening = object({ ...common, kind: { const: "opening" }, wallId: elementId,
    offset: number({ type: "number", minimum: 0, description: "Distance along the wall from its start to the near jamb, in mm." }),
    width: number(length), height: number(length), sill: number({ type: "number", minimum: 0, description: "Opening bottom above the floor, in mm." }),
    filling: { type: "string", enum: ["none", "door", "window"] } });
  return [object({ op: { const: "set_level" }, level }), object({ op: { const: "upsert" }, element: { anyOf: [wall, slab, opening] } })];
}

export const buildingElementKinds = ["wall", "slab", "opening"];
const operations = items => ({
  type: "array", minItems: 1, maxItems: 100,
  items: { anyOf: items },
});
export const buildingOperationsSchema = operations([...buildingWrites(rule => rule), object({ op: { const: "remove" }, id: elementId })]);
export const buildingPanelOperationsSchema = operations(buildingWrites(rule => ({ anyOf: [rule, parameter], description: rule.description })));
