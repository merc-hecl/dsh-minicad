// One contract for model-facing schemas and kernel validation. No UI dependency.
import { localizedError } from "./errors.js";

export const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const text = { type: "string", minLength: 1 };
export const revision = { type: "integer", minimum: 0 };
export const modelFile = {
  ...text,
  description:
    "Design-relative SMP model file returned by cad_read_project, e.g. model.smp. Does not change the UI selection.",
};
const parameter = object({ parameter: text });
const number = (rules = {}) => ({
  anyOf: [{ type: "number", ...rules }, parameter],
});
const positive = number({ exclusiveMinimum: 0 });
const scalar = number();
const array = (items, minItems = 1, maxItems = 100) => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const tuple = (length) => array(scalar, length, length);
const vector = tuple(3);
const rotation = object({ axis: vector, angle: scalar });
const placement = { center: vector, rotate: rotation };
const choices = (items) => ({ type: "string", enum: items });
const selector = object(
  {
    part: text,
    geomType: text,
    name: text,
    parallelTo: vector,
    facing: vector,
    position: choices(["top", "bottom", "front", "back", "left", "right"]),
    nearest: vector,
    radius: positive,
    tolerance: number({ minimum: 0 }),
    axisDirection: vector,
    through: { type: "boolean" },
    closedWall: { type: "boolean" },
    one: { type: "boolean" },
  },
  [],
);
export const reference = { anyOf: [text, selector] };
export const edgeParameters = array({ type: "number", minimum: 0, maximum: 1 });
const references = { anyOf: [text, selector, array(text)] };
const curveShape = (shape, fields, optional = {}) =>
  object({ shape: { const: shape }, ...fields, ...optional }, [
    "shape",
    ...Object.keys(fields),
  ]);
const point2 = tuple(2);
const segments = {
  ...array({
    anyOf: [
      curveShape("line", { start: point2, end: point2 }),
      curveShape("arc", { start: point2, through: point2, end: point2 }),
      curveShape("center_arc", {
        center: point2,
        radius: positive,
        startAngle: scalar,
        arcSize: number({ minimum: -360, maximum: 360 }),
      }),
    ],
  }, 1, 1000),
  description: "Ordered segments in the profile's local [x,y] plane. Consecutive endpoints must meet and the last segment must end at the first start. center_arc uses degrees from the local +X axis. A negative arcSize runs clockwise.",
};
const profileShape = (shape, fields) =>
  object(
    {
      shape: { const: shape },
      ...fields,
      plane: choices(["XY", "XZ", "YZ"]),
      ...placement,
    },
    ["shape", ...Object.keys(fields)],
  );
const profile = {
  anyOf: [
    profileShape("rectangle", { size: array(positive, 2, 2) }),
    profileShape("circle", { radius: positive }),
    profileShape("polygon", { points: array(point2, 3, 1000) }),
    profileShape("wire", { segments }),
  ],
};
const path = {
  anyOf: [
    curveShape("line", { start: vector, end: vector }),
    curveShape(
      "polyline",
      { points: array(vector, 2, 1000) },
      { closed: { type: "boolean" } },
    ),
    curveShape("spline", { points: array(vector, 2, 1000) }),
    curveShape("arc", { start: vector, through: vector, end: vector }),
    curveShape(
      "helix",
      { pitch: positive, height: positive, radius: positive },
      { center: vector, direction: vector, leftHanded: { type: "boolean" } },
    ),
  ],
};
const primitives = {
  box: { size: array(positive, 3, 3) },
  cylinder: { radius: positive, height: positive },
  sphere: { radius: positive },
  cone: {
    bottomRadius: number({ minimum: 0 }),
    topRadius: number({ minimum: 0 }),
    height: positive,
  },
  torus: { majorRadius: positive, minorRadius: positive },
  extrude: { profile, amount: scalar },
  revolve: {
    profile,
    axis: vector,
    angle: number({ minimum: -360, maximum: 360 }),
  },
  loft: { sections: array(profile, 2, 100) },
  sweep: { profile, path },
  import: { file: text },
};
const primitiveOptions = {
  revolve: { origin: vector },
  loft: {
    ruled: { type: "boolean" },
    smooth: { type: "boolean" },
    closed: { type: "boolean" },
  },
  sweep: {
    orient: { type: "boolean" },
    translational: { type: "boolean" },
    twist: scalar,
  },
};
const primitiveSchema = {
  anyOf: Object.entries(primitives).map(([shape, fields]) =>
    object(
      {
        shape: { const: shape },
        ...fields,
        ...primitiveOptions[shape],
        ...placement,
      },
      ["shape", ...Object.keys(fields)],
    ),
  ),
};
const mode = choices(["fuse", "cut", "intersect"]);
const color = {
  anyOf: [text, { type: "null" }],
  description: "For op:color, use an sRGB hex color #RRGGBB or null to clear it. Omit faces for the whole part. Do not use target.",
};
const common = { target: reference, part: text };
const operation = (op, fields, optional = {}) =>
  object({ op: { const: op }, ...fields, ...optional, ...common }, [
    "op",
    ...Object.keys(fields),
  ]);
const operationDescriptions = {
  add_part: "Create an independent member from tool in an empty model or existing assembly. For an existing standalone Part, copy_part first creates the assembly while preserving the source.",
  copy_part: "Keep the source and create an independent copy with new id and name. In an assembly, part is the existing source ID. For a standalone Part, part assigns the original its first stable ID and converts the model to an assembly. center is a translation vector; rotate runs before translation. Names, geometry and colors of the original are preserved.",
  remove_part: "Remove the assembly member selected by its stable part ID. At least one valid solid must remain for publication.",
  box: "Create a centered box with size [X,Y,Z]. Use center and rotate to place it, and mode to combine it with the current solid.",
  cylinder: "Create a centered Z-axis cylinder. Use radius and height for its dimensions, and mode cut for a cylindrical hole.",
  sphere: "Create a sphere of the given radius, with center and mode controlling placement and combination.",
  cone: "Create a centered Z-axis cone or frustum. bottomRadius is at negative Z and topRadius at positive Z. One radius may be zero.",
  torus: "Create a torus around the Z axis. majorRadius locates the tube's center circle and minorRadius sets the tube radius.",
  extrude: "Extend a closed profile along its plane normal by signed amount. Use a wire profile for joined lines and circular arcs.",
  revolve: "Rotate a closed profile about the world-space axis through origin, which defaults to [0,0,0]. angle is the signed total rotation in degrees.",
  loft: "Connect the profiles in sections in their listed order. Set ruled true for straight transitions between sections.",
  sweep: "Carry a closed profile along a line, polyline, spline, arc or helix path to form a solid.",
  import: "Read an exact model resource from the task-relative file path. Use center, rotate and mode to place and combine it.",
  cut: "Subtract the solid defined by tool from the current solid to make holes, pockets or cutouts.",
  fuse: "Union the solid defined by tool with the current solid to add material.",
  intersect: "Keep only the volume shared by the current solid and the solid defined by tool.",
  fillet: "Round the selected edges with the given radius.",
  chamfer: "Bevel the selected edges with the given distance.",
  shell: "Hollow the solid inward to the given wall thickness. faces selects openings. Omit faces for a closed internal cavity.",
  offset: "Offset the entire solid by distance. Positive values grow the material and negative values shrink it.",
  move_faces: "Translate selected faces by the world-space vector by, extending or trimming adjacent faces to meet them.",
  rotate_faces: "Rotate selected faces about the world-space axis through origin by angle degrees, rebuilding adjacent faces.",
  offset_faces: "Move selected faces along their outward normals by distance. Positive values add material and narrow holes. Tangent face chains move together.",
  remove_faces: "Remove selected feature faces, such as a hole, boss or pocket, and close the gap using the surrounding faces.",
  remove_fillets: "Remove the selected fillet faces and restore the sharp intersections of the neighboring faces.",
  translate: "Move the selected solid or part by the world-space vector by.",
  scale: "Scale by one positive factor or [X,Y,Z] factors about origin, which defaults to [0,0,0].",
  rotate: "Rotate the selected solid or part about the world-space axis through origin by angle degrees.",
  mirror: "Reflect the selected solid or part across the plane defined by normal and origin.",
  linear_pattern: "Repeat at multiples of step, with count including the original. Supply tool and mode for repeated cuts or additions. Omit tool to copy the selected solid.",
  circular_pattern: "Repeat about axis through origin. angle is the per-copy increment in degrees and count includes the original. Supply tool and mode to combine repeated tools.",
  color: "Set a whole-part color or selected face overrides using #RRGGBB. null clears the selected color. Clearing a face override restores its inherited part color.",
  rename: "Assign a mandatory, meaningful name to one solid. Use part for an assembly member or target for one solid in a multi-solid Part. Name every final solid before publishing. An assembly is only a collection and needs no overall name. Geometry and IDs are unchanged.",
};
const operationGroups = [
  {
    description: 'Manage independent parts without merging their geometry. Create an assembly with add_part or copy an existing standalone Part using {"op":"copy_part","part":"base","id":"copy","name":"Base copy","center":[0,25,0]}. part assigns the original its stable ID when first converting it to an assembly.',
    operations: [
      object({ op: { const: "add_part" }, id: text, name: text, tool: primitiveSchema }),
      object({ op: { const: "remove_part" }, part: text }),
      object({ op: { const: "copy_part" }, part: text, id: text, name: text, ...placement }, ["op", "part", "id", "name"]),
    ],
  },
  {
    description: 'Create and combine solids. Use a wire profile for a closed outline made of lines and circular arcs. For a round hole, use {"op":"cut","tool":{"shape":"cylinder","radius":2.5,"height":12}}.',
    operations: [
      ...Object.entries(primitives).map(([op, fields]) =>
        operation(op, fields, { ...primitiveOptions[op], ...placement, mode,
          name: { ...text, description: "Required meaningful name when creating a standalone final solid. Use rename for an existing solid." },
        }),
      ),
      ...["cut", "fuse", "intersect"].map((op) =>
        operation(op, { tool: primitiveSchema }),
      ),
    ],
  },
  {
    description: 'Edit local geometry using face or edge IDs from cad_query, or use a geometric selector. To bevel the top straight edges, use {"op":"chamfer","edges":{"position":"top","geomType":"line"},"distance":1}.',
    operations: [
      operation("fillet", { edges: references, radius: positive }),
      operation("chamfer", { edges: references, distance: positive }),
      operation("shell", { thickness: positive }, { faces: references }),
      operation("offset", { distance: scalar }),
      operation("move_faces", { faces: references, by: vector }),
      operation("rotate_faces", { faces: references, axis: vector, angle: scalar }, { origin: vector }),
      operation("offset_faces", { faces: references, distance: scalar }),
      operation("remove_faces", { faces: references }),
      operation("remove_fillets", { faces: references }),
    ],
  },
  {
    description: 'Transform or repeat geometry. Pattern count includes the first copy. For a row of holes, use {"op":"linear_pattern","step":[12,0,0],"count":4,"tool":{"shape":"cylinder","radius":2,"height":10},"mode":"cut"}.',
    operations: [
      operation("translate", { by: vector }),
      operation("scale", { factor: { anyOf: [positive, array(positive, 3, 3)] } }, { origin: vector }),
      operation("rotate", { axis: vector, angle: scalar }, { origin: vector }),
      operation("mirror", { normal: vector }, { origin: vector }),
      operation(
        "linear_pattern",
        {
          step: vector,
          count: {
            anyOf: [{ type: "integer", minimum: 2, maximum: 100 }, parameter],
          },
        },
        { tool: primitiveSchema, mode },
      ),
      operation(
        "circular_pattern",
        {
          axis: vector,
          angle: scalar,
          count: {
            anyOf: [{ type: "integer", minimum: 2, maximum: 100 }, parameter],
          },
        },
        { origin: vector, tool: primitiveSchema, mode },
      ),
    ],
  },
  {
    description: 'Name solids and change appearance. Every final solid must have a meaningful name. Use {"op":"rename","name":"Base plate"} after creating a solid. Use {"op":"color","color":"#CD7F32"} for the whole part or supply faces for a face override. Use null to clear the selected color.',
    operations: [
      operation("rename", { name: text }),
      object({ op: { const: "color" }, color, faces: references, part: text }, ["op", "color"]),
    ],
  },
];
export const operationSchema = {
  anyOf: operationGroups.flatMap(group => group.operations),
};
export const operationsSchema = array(operationSchema);
const entity = object({
  kind: choices(["faces", "edges", "solids"]),
  selector: reference,
});
entity.description = "Select exactly one face, edge or solid. For the distance between whole parts, use kind:solids with selector:{part:'id',one:true}; selecting all faces of a part is ambiguous.";
const endpoint = { anyOf: [text, entity, object({ point: vector })] };
const orientation = { anyOf: [text, entity, object({ direction: vector })] };
const measure = (kind, fields = {}, optional = {}) =>
  object({ kind: { const: kind }, ...fields, ...optional }, [
    "kind",
    ...Object.keys(fields),
  ]);
const measurementSchema = {
  anyOf: [
    measure("distance", { from: endpoint, to: endpoint }),
    measure("max_distance", { from: endpoint, to: endpoint }),
    measure("projected_distance", { from: endpoint, to: endpoint, axis: choices(["x", "y", "z"]) }),
    measure("center_distance", { from: endpoint, to: endpoint }),
    measure("axis_distance", { from: { anyOf: [text, entity] }, to: { anyOf: [text, entity] } }),
    measure("coordinate", { entity, axis: choices(["x", "y", "z"]) }),
    measure("span", { entity, axis: choices(["x", "y", "z"]) }),
    measure("count", { entityKind: choices(["faces", "edges", "solids", "holes"]) }, { selector }),
    measure("angle", { from: orientation, to: orientation }),
    measure(
      "thickness",
      { point: vector, direction: vector },
      { target: reference },
    ),
    measure("size", { axis: choices(["x", "y", "z"]) }, { target: reference }),
    measure("volume", {}, { target: reference }),
    measure("area", {}, { entity }),
    ...["length", "radius", "diameter"].map((kind) =>
      measure(kind, { entity }),
    ),
  ],
};
export const measurementsSchema = array(measurementSchema);
const checkNotes = { name: text, basis: text };
export const checksSchema = array({
  anyOf: [
    object(
      {
        measurement: measurementSchema,
        expected: scalar,
        tolerance: number({ minimum: 0 }),
        ...checkNotes,
      },
      ["measurement", "expected"],
    ),
    object({ measurement: measurementSchema, min: scalar, max: scalar, ...checkNotes }, ["measurement", "min", "max"]),
    object({ measurement: measurementSchema, min: scalar, ...checkNotes }, ["measurement", "min"]),
    object({ measurement: measurementSchema, max: scalar, ...checkNotes }, ["measurement", "max"]),
  ],
});

// DSH rc.5 enforces a deliberately smaller JSON Schema subset. Preserve disjoint
// alternatives as oneOf, and describe bounds that the kernel enforces at runtime.
export function toDshSchema(rule) {
  // DSH has no $ref/$defs. Group the operation names while sharing field
  // definitions. The kernel still validates each operation's exact fields.
  if (rule === operationSchema) {
    const properties = Object.assign(
      {},
      ...rule.anyOf.map((option) => option.properties),
    );
    properties.op = {
      anyOf: operationGroups.map(({ description, operations }) => ({
        ...choices(operations.map(option => option.properties.op.const)),
        description: [description, ...operations.map(option => {
          const op = option.properties.op.const;
          const required = option.required.filter(key => key !== "op").join(",");
          return `${op}(${required}). ${operationDescriptions[op]}`;
        })].join("\n"),
      })),
    };
    rule = {
      ...object(properties, ["op"]),
      description: "Pick an op by its purpose and supply the fields it uses. Use part for an assembly member. Numeric modeling fields can use {parameter:'name'} where the field allows it.",
    };
  } else if (rule === measurementSchema) {
    const properties = Object.assign({}, ...rule.anyOf.map(option => option.properties));
    properties.kind = choices(rule.anyOf.map(option => option.properties.kind.const));
    properties.from = properties.to = { anyOf: [text, entity, object({ point: vector }), object({ direction: vector })] };
    rule = { ...object(properties, ["kind"]),
      description: `Required fields by kind (kernel enforced): ${rule.anyOf.map(option => `${option.properties.kind.const}(${option.required.filter(key => key !== "kind").join(",")})`).join("; ")}. distance means minimum surface gap and returns point, otherPoint and projections:{x,y,z} for one shared nearest-point pair; max_distance is the farthest pair on the bounded geometry (curved geometry uses numerical approximation, see result method/accuracy); projected_distance is the absolute world-axis component of one minimum-distance pair (nonunique pairs can give different components; a batch shares the same pair as distance); Numerical accuracy is in mm and differs from check acceptance tolerance; center_distance uses geometric centers; axis_distance uses infinite axes. count counts matching items, including cylindrical bore segments for holes.`,
    };
  } else if (rule === selector) {
    const coordinates = {
      type: "array",
      items: { type: "number" },
      description: "Exactly [x,y,z]. Direction vectors must be nonzero.",
    };
    rule = object(
      {
        part: text,
        geomType: { type: "string" },
        name: { type: "string" },
        parallelTo: coordinates,
        facing: coordinates,
        nearest: coordinates,
        radius: positive,
        tolerance: number({ minimum: 0 }),
        axisDirection: coordinates,
        through: { type: "boolean" },
        closedWall: { type: "boolean" },
        position: choices(["top", "bottom", "front", "back", "left", "right"]),
        one: { type: "boolean" },
      },
      [],
    );
  } else if (rule === profile) {
    rule = {
      ...object(
        {
          shape: choices(["rectangle", "circle", "polygon", "wire"]),
          size: array(positive, 2, 2),
          radius: positive,
          points: array(point2, 3, 1000),
          segments,
          plane: choices(["XY", "XZ", "YZ"]),
          ...placement,
        },
        ["shape"],
      ),
      description:
        "Use rectangle(size), circle(radius), polygon(points), or wire(segments). For a D-shaped profile, use {\"shape\":\"wire\",\"segments\":[{\"shape\":\"line\",\"start\":[-5,0],\"end\":[5,0]},{\"shape\":\"arc\",\"start\":[5,0],\"through\":[0,5],\"end\":[-5,0]}]}.",
    };
  } else if (rule === primitiveSchema) {
    rule = {
      ...object(
        {
          shape: choices(Object.keys(primitives)),
          ...Object.assign({}, ...Object.values(primitives)),
          ...Object.assign({}, ...Object.values(primitiveOptions)),
          ...placement,
        },
        ["shape"],
      ),
      description:
        "Required fields: box(size:[x,y,z]); cylinder(radius,height); sphere(radius); cone(bottomRadius,topRadius,height); torus(majorRadius,minorRadius); extrude(profile,amount); revolve(profile,axis,angle); loft(sections); sweep(profile,path); import(file). Shape-specific fields are enforced by the kernel.",
    };
  } else if (rule === checksSchema.items) {
    rule = {
      ...object(
        {
          measurement: measurementSchema,
          expected: scalar,
          tolerance: number({ minimum: 0 }),
          min: scalar,
          max: scalar,
          ...checkNotes,
        },
        ["measurement"],
      ),
      description:
        "Provide expected with optional tolerance (default 1e-6), OR min and/or max. Do not mix the forms; enforced by the kernel.",
    };
  }
  const result = {};
  const notes = [];
  const bounds = {
    minimum: ">=",
    maximum: "<=",
    exclusiveMinimum: ">",
    minItems: "minimum items",
    maxItems: "maximum items",
    minLength: "minimum string length",
  };
  for (const [key, value] of Object.entries(rule)) {
    if (bounds[key]) notes.push(`${bounds[key]} ${value}`);
    else if (key === "anyOf") result.oneOf = value.map(toDshSchema);
    else if (key === "properties")
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [
          name,
          toDshSchema(schema),
        ]),
      );
    else if (key === "items") result.items = toDshSchema(value);
    else result[key] = value;
  }
  if (result.const !== undefined && !result.type)
    result.type = typeof result.const;
  if (notes.length)
    result.description = [result.description, notes.join(", ")]
      .filter(Boolean)
      .join(" ");
  return result;
}

// Validate this module's JSON Schema subset, also at the service boundary (not just in DSH).
export function validate(value, rule, path = "input") {
  if (rule.anyOf) {
    const errors = [];
    for (const option of rule.anyOf) {
      try {
        validate(value, option, path);
        return;
      } catch (error) {
        errors.push(error.message);
      }
    }
    // Discriminated unions should report the matching variant's field error.
    const matched = rule.anyOf.find((option) =>
      Object.entries(option.properties || {}).some(
        ([key, field]) =>
          field.const !== undefined && value?.[key] === field.const,
      ),
    );
    if (matched) return validate(value, matched, path);
    const structural = rule.anyOf.find(option => option.type === "object" && value && typeof value === "object" &&
      (option.required || []).every(key => Object.hasOwn(value, key)) &&
      Object.keys(value).every(key => Object.hasOwn(option.properties, key)));
    if (structural) return validate(value, structural, path);
    throw localizedError(`${path}: 参数格式不匹配`, `${path}: invalid value`, ` (${errors[0]})`);
  }
  if (rule.const !== undefined && value !== rule.const)
    throw localizedError(`${path}: 必须为`, `${path}: expected`, ` ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value))
    throw localizedError(`${path}: 不支持的值`, `${path}: unsupported value`);
  const bad = () => {
    throw localizedError(`${path}: 参数类型或范围错误`, `${path}: invalid type or range`);
  };
  switch (rule.type) {
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) bad();
      for (const key of rule.required || [])
        if (!Object.hasOwn(value, key))
          throw localizedError(`${path}.${key}: 缺少必填参数`, `${path}.${key}: required`);
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(rule.properties || {}, key))
          validate(item, rule.properties[key], `${path}.${key}`);
        else if (rule.additionalProperties === false)
          throw localizedError(`${path}.${key}: 未知参数`, `${path}.${key}: unknown field`);
      }
      break;
    case "array":
      if (
        !Array.isArray(value) ||
        value.length < (rule.minItems ?? 0) ||
        value.length > (rule.maxItems ?? Infinity)
      )
        bad();
      value.forEach((item, index) =>
        validate(item, rule.items, `${path}[${index}]`),
      );
      break;
    case "number":
    case "integer":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (rule.type === "integer" && !Number.isInteger(value)) ||
        value < (rule.minimum ?? -Infinity) ||
        value > (rule.maximum ?? Infinity) ||
        (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum)
      )
        bad();
      break;
    case "string":
      if (typeof value !== "string" || value.length < (rule.minLength ?? 0))
        bad();
      break;
    case "boolean":
      if (typeof value !== "boolean") bad();
      break;
    case "null":
      if (value !== null) bad();
      break;
  }
}
