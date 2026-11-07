// One contract for model-facing schemas and kernel validation. No UI dependency.
export const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const text = { type: "string", minLength: 1 };
export const revision = { type: "integer", minimum: 0 };
export const sourceFile = {
  ...text,
  description:
    "Task-relative JavaScript model file returned by cad_read_project. Does not change the UI selection.",
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
export const vector = tuple(3);
const rotation = object({ axis: vector, angle: scalar });
const placement = { center: vector, rotate: rotation };
const choices = (items) => ({ type: "string", enum: items });
export const selector = object(
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
export const profile = {
  anyOf: [
    profileShape("rectangle", { size: array(positive, 2, 2) }),
    profileShape("circle", { radius: positive }),
    profileShape("polygon", { points: array(tuple(2), 3, 1000) }),
  ],
};
const pathShape = (shape, fields, optional = {}) =>
  object({ shape: { const: shape }, ...fields, ...optional }, [
    "shape",
    ...Object.keys(fields),
  ]);
const path = {
  anyOf: [
    pathShape("line", { start: vector, end: vector }),
    pathShape(
      "polyline",
      { points: array(vector, 2, 1000) },
      { closed: { type: "boolean" } },
    ),
    pathShape("spline", { points: array(vector, 2, 1000) }),
    pathShape("arc", { start: vector, through: vector, end: vector }),
    pathShape(
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
export const primitiveSchema = {
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
const common = { target: reference, part: text };
const operation = (op, fields, optional = {}) =>
  object({ op: { const: op }, ...fields, ...optional, ...common }, [
    "op",
    ...Object.keys(fields),
  ]);
export const operationSchema = {
  anyOf: [
    ...Object.entries(primitives).map(([op, fields]) =>
      operation(op, fields, { ...primitiveOptions[op], ...placement, mode }),
    ),
    ...["cut", "fuse", "intersect"].map((op) =>
      operation(op, { tool: primitiveSchema }),
    ),
    operation("fillet", { edges: references, radius: positive }),
    operation("chamfer", { edges: references, distance: positive }),
    operation("shell", { thickness: positive }, { faces: references }),
    operation("offset", { distance: scalar }),
    operation("move_faces", { faces: references, by: vector }),
    operation("rotate_faces", { faces: references, axis: vector, angle: scalar }, { origin: vector }),
    operation("offset_faces", { faces: references, distance: scalar }),
    operation("remove_faces", { faces: references }),
    operation("remove_fillets", { faces: references }),
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
};
export const operationsSchema = array(operationSchema);
export const entity = object({
  kind: choices(["faces", "edges", "solids"]),
  selector: reference,
});
const endpoint = { anyOf: [text, entity, object({ point: vector })] };
const orientation = { anyOf: [text, entity, object({ direction: vector })] };
const measure = (kind, fields = {}, optional = {}) =>
  object({ kind: { const: kind }, ...fields, ...optional }, [
    "kind",
    ...Object.keys(fields),
  ]);
export const measurementSchema = {
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
  // DSH has no $ref/$defs. Expose typed fields and a required-field matrix,
  // keeping full conditional validation in the kernel instead of duplicating
  // the same nested schemas hundreds of times in the agent context.
  if (rule === operationSchema) {
    const properties = Object.assign(
      {},
      ...rule.anyOf.map((option) => option.properties),
    );
    properties.op = choices(
      rule.anyOf.map((option) => option.properties.op.const),
    );
    rule = {
      ...object(properties, ["op"]),
      description: `Required fields by op (kernel enforced): ${rule.anyOf.map((option) => `${option.properties.op.const}(${option.required.filter((key) => key !== "op").join(",")})`).join("; ")}. Other operation-specific fields are rejected. Numeric values can use {parameter:'name'}.`,
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
          shape: choices(["rectangle", "circle", "polygon"]),
          size: array(positive, 2, 2),
          radius: positive,
          points: array(tuple(2), 3, 1000),
          plane: choices(["XY", "XZ", "YZ"]),
          ...placement,
        },
        ["shape"],
      ),
      description:
        "Required fields: rectangle(size:[width,height]); circle(radius); polygon(points:[[x,y],...], at least 3). Shape-specific fields are enforced by the kernel.",
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
    throw new Error(`${path}: 参数格式不匹配 / invalid value (${errors[0]})`);
  }
  if (rule.const !== undefined && value !== rule.const)
    throw new Error(`${path}: 必须为 / expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value))
    throw new Error(`${path}: 不支持的值 / unsupported value`);
  const bad = () => {
    throw new Error(`${path}: 参数类型或范围错误 / invalid type or range`);
  };
  switch (rule.type) {
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) bad();
      for (const key of rule.required || [])
        if (!Object.hasOwn(value, key))
          throw new Error(`${path}.${key}: 缺少必填参数 / required`);
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(rule.properties || {}, key))
          validate(item, rule.properties[key], `${path}.${key}`);
        else if (rule.additionalProperties === false)
          throw new Error(`${path}.${key}: 未知参数 / unknown field`);
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
  }
}
