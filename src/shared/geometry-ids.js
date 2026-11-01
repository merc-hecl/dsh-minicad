export const defaultIdFormats = Object.freeze({
  faceFormat: "F-{n}",
  edgeFormat: "E-{n}",
});

export function validateIdFormats(input) {
  const result = {};
  for (const key of Object.keys(defaultIdFormats)) {
    const value = input[key];
    if (
      typeof value !== "string" ||
      value.split("{n}").length !== 2
    )
      throw new Error(
        "编号格式必须包含一个 {n} / ID format must contain one {n}",
      );
    result[key] = value;
  }
  return result;
}

export function geometryLabel(kind, index, formats = defaultIdFormats) {
  return formats[kind === "faces" ? "faceFormat" : "edgeFormat"].replace(
    "{n}",
    String(index + 1),
  );
}

export const geometryReference = (scope, revision, kind, index) =>
  `m${scope}:v${revision}:${kind}:${index}`;
