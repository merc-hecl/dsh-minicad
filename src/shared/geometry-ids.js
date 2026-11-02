export const defaultIdFormats = Object.freeze({
  faceFormat: "F-{n}",
  edgeFormat: "E-{n}",
});

export function geometryLabel(kind, index, formats = defaultIdFormats) {
  return formats[kind === "faces" ? "faceFormat" : "edgeFormat"].replace(
    "{n}",
    String(index + 1),
  );
}

export const geometryReference = (scope, revision, kind, index) =>
  `m${scope}:v${revision}:${kind}:${index}`;
