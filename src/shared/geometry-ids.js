import { localizedError } from "./errors.js";
export const defaultIdFormats = Object.freeze({
  faceFormat: "F-{n}",
  edgeFormat: "E-{n}",
});

const numberingToken = /\{n(?::([1-9]))?\}/;

export function validateIdFormat(template) {
  if (typeof template !== "string" || !numberingToken.test(template) ||
      /[{}\r\n]/.test(template.replace(numberingToken, ""))) {
    throw localizedError("编号格式必须包含一个 {n} 或 {n:1} 至 {n:9}", "ID format must contain one numbering placeholder: {n} or {n:1} to {n:9}");
  }
}

export function geometryLabel(kind, index, formats = defaultIdFormats) {
  const template = formats[kind === "faces" ? "faceFormat" : "edgeFormat"];
  const number = String(index + 1);
  return template.replace(numberingToken, (_token, width) => width ? number.padStart(Number(width), "0") : number);
}

export const geometryReference = (scope, revision, kind, index) =>
  `m${scope}:v${revision}:${kind}:${index}`;
