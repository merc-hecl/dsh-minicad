const open = "<minicad-geometry-reference>";
const close = "</minicad-geometry-reference>";

export function serializeGeometryAnnotation(annotation) {
  return open + JSON.stringify(annotation).replace(/</g, "\\u003c") + close;
}

export function nextGeometryAnnotation(text, from = 0) {
  let start = text.indexOf(open, from);
  while (start !== -1) {
    const end = text.indexOf(close, start + open.length);
    if (end === -1) return;
    try {
      const data = JSON.parse(text.slice(start + open.length, end));
      if (
        typeof data.reference === "string" &&
        typeof data.label === "string" &&
        typeof data.sourceFile === "string" &&
        Number.isInteger(data.expectedRevision) &&
        typeof data.note === "string"
      )
        return { id: "minicad-geometry", start, end: end + close.length, data };
    } catch {
      /* Leave ordinary text to the host's text renderer. */
    }
    start = text.indexOf(open, end + close.length);
  }
}
